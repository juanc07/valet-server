import { Request, Response } from "express";
import { v4 as uuidv4 } from "uuid";
import { connectToDatabase } from "../services/dbService";
import { verifySolPayment } from "../services/solanaService";
import { setupTwitterListener, startPostingInterval, stopPostingInterval, stopTwitterListener, postTweet } from "../services/twitterService";
import { hasValidTwitterCredentials } from "../utils/twitterUtils";
import { Agent } from "../types/agent";
import { User } from "../types/user";
import { TweetStream } from "twitter-api-v2";
import { AGENT_REPLY_LIMIT, AGENT_REPLY_COOLDOWN_HOURS } from "../config";

interface AgentParams {
  agentId: string;
}

interface UserParams {
  userId: string;
}

interface TweetReply {
  agentId: string;
  tweetId: string;
  targetAgentId?: string; // Added for agent-to-agent tracking
  authorUsername?: string; // Added to track the mention author
  repliedAt: Date;
}

export const createAgent = async (req: Request, res: Response) => {
  console.log("1st createAgent");
  try {
    const db = await connectToDatabase();
    const { txSignature, ...agentData }: { txSignature: string } & Omit<Agent, "agentId" | "isActive"> = req.body;
    const agent: Omit<Agent, "agentId" | "isActive"> = agentData;

    console.log("txSignature: ", txSignature);
    console.log("agent: ", agent);

    const requiredFields = [
      { key: "name", type: "string" as const },
      { key: "description", type: "string" as const },
      { key: "bio", type: "string" as const },
      { key: "mission", type: "string" as const },
      { key: "vision", type: "string" as const },
      { key: "createdBy", type: "string" as const },
      { key: "personality.tone", type: "string" as const },
      { key: "personality.humor", type: "boolean" as const },
      { key: "personality.formality", type: "string" as const },
      { key: "personality.catchphrase", type: "string" as const },
      { key: "agentType", type: "string" as const },
    ];

    const missingFields: string[] = [];
    const invalidFields: string[] = [];

    for (const field of requiredFields) {
      const [parent, child] = field.key.split(".");
      let value: any;

      if (child) {
        value = (agent as any)[parent]?.[child];
      } else {
        value = (agent as any)[field.key];
      }

      if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
        missingFields.push(field.key);
      } else if (typeof value !== field.type) {
        invalidFields.push(`${field.key} must be a ${field.type}`);
      }
    }

    if (agent.agentType && !["basic", "puppetos", "thirdparty"].includes(agent.agentType)) {
      invalidFields.push("agentType must be 'basic', 'puppetos', or 'thirdparty'");
    }

    if (!txSignature || typeof txSignature !== "string" || txSignature.trim() === "") {
      missingFields.push("txSignature");
    }

    if (missingFields.length > 0 || invalidFields.length > 0) {
      const errorMessage = [
        missingFields.length > 0 ? `Missing required fields: ${missingFields.join(", ")}` : "",
        invalidFields.length > 0 ? `Invalid fields: ${invalidFields.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join("; ");
      res.status(400).json({ error: errorMessage });
      return;
    }

    const user = (await db.collection("users").findOne({ userId: agent.createdBy })) as User | null;
    if (!user || !user.solanaWalletAddress) {
      res.status(400).json({ error: "User not found or no Solana wallet address associated" });
      return;
    }

    const paymentValid = await verifySolPayment(txSignature, user.solanaWalletAddress);
    if (!paymentValid) {
      res.status(400).json({ error: "Transaction does not contain valid SOL transfer of 0.01 SOL" });
      return;
    }

    const generatedId = uuidv4();
    const newAgent: Agent = {
      ...agent,
      agentId: generatedId,
      isActive: true,
    };

    const result = await db.collection("agents").insertOne(newAgent);

    const hasTwitterPlatform = Array.isArray(newAgent.settings?.platforms) && newAgent.settings.platforms.includes("twitter");
    if (newAgent.isActive && hasValidTwitterCredentials(newAgent) && hasTwitterPlatform) {
      await setupTwitterListener(newAgent, db); // Pass db
      if (newAgent.enablePostTweet === true && newAgent.agentType === "basic") {
        startPostingInterval(newAgent);
      }
    } else {
      console.log(`Skipping Twitter features for agent ${newAgent.agentId}: Missing credentials, inactive, or Twitter not in platforms`);
    }

    res.status(201).json({ _id: result.insertedId, ...newAgent });
  } catch (error) {
    console.error("Error creating agent:", error);
    res.status(500).json({ error: "Failed to create agent" });
  }
};

export const getAllAgents = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agents = await db.collection("agents").find().toArray();
    res.status(200).json(agents);
  } catch (error) {
    console.error("Error fetching all agents:", error);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
};

export const getActiveAgents = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agents = await db.collection("agents").find({ isActive: true }).toArray();
    res.status(200).json(agents);
  } catch (error) {
    console.error("Error fetching active agents:", error);
    res.status(500).json({ error: "Failed to fetch active agents" });
  }
};

export const getAgentsByUserId = async (req: Request<UserParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const isActive = req.query.isActive ? req.query.isActive === "true" : undefined;

    console.log(`Fetching agents for userId: ${userId}, isActive: ${isActive}`);

    const query: any = { createdBy: userId };
    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    const agents = await db.collection("agents").find(query).toArray();

    console.log(`Found ${agents.length} agents for userId ${userId}`);
    res.status(200).json(agents);
  } catch (error) {
    console.error("Error fetching agents by userId:", error);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
};

export const getActiveAgentCount = async (req: Request<UserParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const isActive = req.query.isActive === "true";

    console.log(`Fetching active agent count for userId: ${userId}, isActive: ${isActive}`);

    const count = await db.collection("agents").countDocuments({
      createdBy: userId,
      isActive: isActive,
    });

    console.log(`Active agent count for userId ${userId}: ${count}`);
    res.status(200).json({ count });
  } catch (error) {
    console.error("Error fetching active agent count:", error);
    res.status(500).json({ error: "Failed to fetch active agent count" });
  }
};

export const updateAgent = async (req: Request<AgentParams>, res: Response) => {
  console.log("1st updateAgent");
  try {
    const db = await connectToDatabase();
    const agentId: string = req.params.agentId;
    const updatedAgent: Partial<Agent> = req.body;
    console.log("Update payload:", updatedAgent);

    const currentAgent = (await db.collection("agents").findOne({ agentId })) as Agent | null;
    if (!currentAgent) {
      console.log("2nd updateAgent agent not found");
      res.status(404).json({ error: "Agent not found" });
      return;
    }
    console.log("Current agent:", currentAgent);

    const result = await db.collection("agents").updateOne({ agentId: agentId }, { $set: updatedAgent });

    if (result.matchedCount === 0) {
      console.log("3rd updateAgent agent not found");
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const newAgentData = (await db.collection("agents").findOne({ agentId })) as Agent | null;
    if (!newAgentData) {
      console.log("4th updateAgent Failed to retrieve updated agent");
      res.status(500).json({ error: "Failed to retrieve updated agent" });
      return;
    }
    console.log("Updated agent:", newAgentData);

    const wasActive = currentAgent.isActive ?? false;
    const isActiveNow = newAgentData.isActive ?? wasActive;
    const hadCredentials = hasValidTwitterCredentials(currentAgent);
    const hasCredentialsNow = hasValidTwitterCredentials(newAgentData);
    const wasPostingEnabled = currentAgent.enablePostTweet ?? false;
    const isPostingEnabledNow = newAgentData.enablePostTweet ?? wasPostingEnabled;
    const wasBasic = currentAgent.agentType === "basic";
    const isBasicNow = newAgentData.agentType === "basic";
    const hadTwitterPlatform = Array.isArray(currentAgent.settings?.platforms) && currentAgent.settings.platforms.includes("twitter");
    const hasTwitterPlatformNow = Array.isArray(newAgentData.settings?.platforms) && newAgentData.settings.platforms.includes("twitter");

    console.log("State check:", {
      wasActive,
      isActiveNow,
      hadCredentials,
      hasCredentialsNow,
      wasPostingEnabled,
      isPostingEnabledNow,
      wasBasic,
      isBasicNow,
      hadTwitterPlatform,
      hasTwitterPlatformNow,
    });

    await stopTwitterListener(agentId);
    stopPostingInterval(agentId);

    if (isActiveNow && hasCredentialsNow && hasTwitterPlatformNow) {
      console.log("Setting up Twitter listener for agent after update");
      try {
        await setupTwitterListener(newAgentData, db); // Pass db
      } catch (twitterError) {
        console.error("Failed to setup Twitter listener in updateAgent:", twitterError);
      }
    } else {
      console.log("Skipping Twitter listener setup: Conditions not met");
    }

    if (isActiveNow && isBasicNow && isPostingEnabledNow && hasCredentialsNow && hasTwitterPlatformNow) {
      console.log("Restarting posting interval for agent after update");
      startPostingInterval(newAgentData);
    } else {
      console.log("Skipping posting interval setup: Conditions not met");
    }

    res.status(200).json({ message: "Agent updated" });
  } catch (error) {
    console.error("Error updating agent:", error);
    res.status(500).json({ error: "Failed to update agent" });
  }
};

export const deleteAgent = async (req: Request<AgentParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;

    await stopTwitterListener(agentId);
    stopPostingInterval(agentId);

    const result = await db.collection("agents").deleteOne({ agentId: agentId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "Agent not found" });
    } else {
      res.status(200).json({ message: "Agent deleted" });
    }
  } catch (error) {
    console.error("Error deleting agent:", error);
    res.status(500).json({ error: "Failed to delete agent" });
  }
};

export const deleteAllAgents = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();

    for (const agentId of twitterStreams.keys()) {
      await stopTwitterListener(agentId);
    }
    for (const agentId of postingIntervals.keys()) {
      stopPostingInterval(agentId);
    }

    await db.collection("agents").deleteMany({});
    res.status(200).json({ message: "All agents deleted" });
  } catch (error) {
    console.error("Error deleting all agents:", error);
    res.status(500).json({ error: "Failed to delete all agents" });
  }
};

export const getAgentById = async (req: Request<AgentParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;
    const agent = await db.collection("agents").findOne({ agentId: agentId });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
    } else {
      res.status(200).json(agent);
    }
  } catch (error) {
    console.error("Error fetching agent by ID:", error);
    res.status(500).json({ error: "Failed to fetch agent" });
  }
};

// Updated method to save tweet tweetReplies to MongoDB with additional fields
export const saveTweetReply = async (agentId: string, tweetId: string, db: any, targetAgentId?: string, authorUsername?: string): Promise<void> => {
  try {
    const tweetReply: TweetReply = {
      agentId,
      tweetId,
      targetAgentId, // Optional, set if replying to another agent
      authorUsername, // Store the mention author's username
      repliedAt: new Date(),
    };
    const result = await db.collection("tweetReplies").updateOne(
      { agentId, tweetId },
      { $set: tweetReply },
      { upsert: true }
    );
    console.log(`Saved tweet reply for agent ${agentId}, tweet ${tweetId}. Upserted: ${result.upsertedCount > 0}`);
  } catch (error) {
    console.error(`Error saving tweet reply for agent ${agentId}, tweet ${tweetId}:`, error);
    throw error;
  }
};

// Updated method to check if a tweet has been replied to, with agent-to-agent limit check
export const hasRepliedToTweet = async (agentId: string, tweetId: string, db: any, authorUsername?: string): Promise<boolean> => {
  try {
    const reply = await db.collection("tweetReplies").findOne({ agentId, tweetId });
    if (reply) return true;

    // If authorUsername is provided, check if it's an agent and enforce reply limit
    if (authorUsername) {
      const targetAgent = await db.collection("agents").findOne({ twitterHandle: authorUsername });
      if (targetAgent) {
        const coolDownHour = parseInt(AGENT_REPLY_COOLDOWN_HOURS || "2", 10);
        const replyLimitCount = parseInt(AGENT_REPLY_LIMIT || "3", 10);
        const targetAgentId = targetAgent.agentId;
        const recentReplies = await db.collection("tweetReplies").find({
          agentId,
          targetAgentId,
          repliedAt: { $gt: new Date(Date.now() - coolDownHour * 60 * 60 * 1000) } // Last 2 hours
        }).sort({ repliedAt: -1 }).limit(3).toArray();

        if (recentReplies.length >= replyLimitCount) {
          console.log(`Agent ${agentId} has replied to ${targetAgentId} 3 times in last 2 hours; cooldown active`);
          return true; // Treat as replied to enforce cooldown
        }
      }
    }
    return false;
  } catch (error) {
    console.error(`Error checking tweet reply for agent ${agentId}, tweet ${tweetId}:`, error);
    return false; // Assume not replied if there's an error
  }
};

export const twitterStreams = new Map<string, TweetStream>();
export const postingIntervals = new Map<string, NodeJS.Timeout>();