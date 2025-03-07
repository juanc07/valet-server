import express, { Request, Response, Express, RequestHandler } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { TwitterApi, TwitterApiTokens, TweetStream } from "twitter-api-v2";
import OpenAI from "openai";
import { connectToDatabase } from "./db";
import { Agent } from "./types/agent";
import { User } from "./types/user";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

// Map to track active Twitter streams
const twitterStreams = new Map<string, TweetStream>();
// Map to track posting intervals
const postingIntervals = new Map<string, NodeJS.Timeout>();

app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      "http://localhost:3001",
      "http://localhost:5173",
      undefined,
    ];
    if (allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type"],
}));
app.use(express.json());

interface AgentParams {
  agentId: string;
}

interface UserParams {
  userId: string;
}

interface ChatParams {
  agentId: string;
}

async function startServer() {
  try {
    const db = await connectToDatabase();
    await setupTwitterListeners(db);
    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

// Helper function to check if agent has valid Twitter credentials
function hasValidTwitterCredentials(agent: Agent): boolean {
  return (
    typeof agent.twitterHandle === "string" && agent.twitterHandle.trim() !== "" &&
    typeof agent.twitterAppKey === "string" && agent.twitterAppKey.trim() !== "" &&
    typeof agent.twitterAppSecret === "string" && agent.twitterAppSecret.trim() !== "" &&
    typeof agent.twitterAccessToken === "string" && agent.twitterAccessToken.trim() !== "" &&
    typeof agent.twitterAccessSecret === "string" && agent.twitterAccessSecret.trim() !== ""
  );
}

// Helper function to stop Twitter listener
async function stopTwitterListener(agentId: string) {
  try {
    const stream = twitterStreams.get(agentId);
    if (stream) {
      stream.destroy();
      twitterStreams.delete(agentId);
      console.log(`Twitter listener stopped for agent ${agentId}`);
    }
  } catch (error) {
    console.error(`Error stopping Twitter listener for agent ${agentId}:`, error);
  }
}

// Helper function to stop posting interval
function stopPostingInterval(agentId: string) {
  try {
    const interval = postingIntervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      postingIntervals.delete(agentId);
      console.log(`Posting interval stopped for agent ${agentId}`);
    }
  } catch (error) {
    console.error(`Error stopping posting interval for agent ${agentId}:`, error);
  }
}

// Helper function to post random tweet
async function postRandomTweet(agent: Agent) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot post tweet for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };

  const twitterClient = new TwitterApi(twitterTokens);

  const randomMessages = [
    `Hello from ${agent.name}! Just a basic agent checking in.`,
    `${agent.name} here: What's happening on X today?`,
    `Agent ${agent.name} says: ${agent.personality.catchphrase}`,
  ];
  const randomMessage = randomMessages[Math.floor(Math.random() * randomMessages.length)];

  try {
    await twitterClient.v1.tweet(randomMessage);
    console.log(`Agent ${agent.agentId} posted: ${randomMessage}`);
  } catch (error) {
    console.error(`Failed to post tweet for agent ${agent.agentId}:`, error);
  }
}

// Helper function to start posting interval
function startPostingInterval(agent: Agent) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot start posting interval for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  try {
    stopPostingInterval(agent.agentId); // Clear any existing interval
    const intervalSeconds = agent.postTweetInterval ?? 3600; // Default to 1 hour if not set
    const interval = setInterval(() => postRandomTweet(agent), intervalSeconds * 1000); // Convert to milliseconds
    postingIntervals.set(agent.agentId, interval);
    console.log(`Started posting interval for agent ${agent.agentId} every ${intervalSeconds} seconds`);
  } catch (error) {
    console.error(`Error starting posting interval for agent ${agent.agentId}:`, error);
  }
}

// Agent Route Handlers
const createAgent: RequestHandler = async (req: Request, res: Response) => {
  console.log("1st createAgent");
  try {
    const db = await connectToDatabase();
    const agent: Omit<Agent, "id"> & { id?: string } = req.body;

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

    console.log("2nd createAgent no missing fields");

    const generatedId = uuidv4();
    const newAgent: Agent = {
      ...agent,
      agentId: generatedId,
      isActive: true,
    };

    const result = await db.collection("agents").insertOne(newAgent);

    console.log("3rd createAgent created");

    if (newAgent.isActive && hasValidTwitterCredentials(newAgent)) {
      await setupTwitterListener(newAgent);
      console.log("4th createAgent twitter listener setup");

      if (newAgent.enablePostTweet === true && newAgent.agentType === "basic") {
        startPostingInterval(newAgent);
      }
    } else {
      console.log(`Skipping Twitter features for agent ${newAgent.agentId}: Missing or invalid Twitter credentials or not active`);
    }

    console.log("7th createAgent response call!");
    res.status(201).json({ _id: result.insertedId, ...newAgent });
  } catch (error) {
    console.error("Error creating agent:", error);
    res.status(500).json({ error: "Failed to create agent" });
  }
};

const getAllAgents: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agents = await db.collection("agents").find().toArray();
    res.status(200).json(agents);
  } catch (error) {
    console.error("Error fetching all agents:", error);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
};

const getActiveAgents: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agents = await db.collection("agents").find({ isActive: true }).toArray();
    res.status(200).json(agents);
  } catch (error) {
    console.error("Error fetching active agents:", error);
    res.status(500).json({ error: "Failed to fetch active agents" });
  }
};

const updateAgent: RequestHandler<AgentParams> = async (
  req: Request<AgentParams>,
  res: Response
) => {
  try {
    const db = await connectToDatabase();
    const agentId: string = req.params.agentId;
    const updatedAgent: Partial<Agent> = req.body;

    const currentAgent = await db.collection("agents").findOne({ agentId }) as Agent | null;
    if (!currentAgent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const result = await db.collection("agents").updateOne(
      { agentId: agentId },
      { $set: updatedAgent }
    );

    if (result.matchedCount === 0) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const newAgentData = await db.collection("agents").findOne({ agentId }) as Agent | null;
    if (!newAgentData) {
      res.status(500).json({ error: "Failed to retrieve updated agent" });
      return;
    }

    const wasActive = currentAgent.isActive ?? false;
    const isActiveNow = newAgentData.isActive ?? wasActive;
    const hadCredentials = hasValidTwitterCredentials(currentAgent);
    const hasCredentialsNow = hasValidTwitterCredentials(newAgentData);
    const wasPostingEnabled = currentAgent.enablePostTweet ?? false;
    const isPostingEnabledNow = newAgentData.enablePostTweet ?? wasPostingEnabled;
    const wasBasic = currentAgent.agentType === "basic";
    const isBasicNow = newAgentData.agentType === "basic";

    // Twitter listener logic
    if (!hasCredentialsNow) {
      await stopTwitterListener(agentId);
      stopPostingInterval(agentId);
    } else if (wasActive && !isActiveNow) {
      await stopTwitterListener(agentId);
      stopPostingInterval(agentId);
    } else if (!wasActive && isActiveNow) {
      await setupTwitterListener(newAgentData);
    } else if (isActiveNow && !hadCredentials && hasCredentialsNow) {
      await stopTwitterListener(agentId);
      await setupTwitterListener(newAgentData);
    }

    // Posting interval logic
    if (!hasCredentialsNow) {
      stopPostingInterval(agentId);
    } else if (isActiveNow && isBasicNow && isPostingEnabledNow) {
      if (!wasPostingEnabled || (!hadCredentials && hasCredentialsNow) || (!wasBasic && isBasicNow)) {
        startPostingInterval(newAgentData);
      }
    } else if (wasPostingEnabled && (wasActive || wasBasic || wasPostingEnabled)) {
      stopPostingInterval(agentId);
    }

    res.status(200).json({ message: "Agent updated" });
  } catch (error) {
    console.error("Error updating agent:", error);
    res.status(500).json({ error: "Failed to update agent" });
  }
};

const deleteAgent: RequestHandler<AgentParams> = async (
  req: Request<AgentParams>,
  res: Response
) => {
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

const deleteAllAgents: RequestHandler = async (req: Request, res: Response) => {
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

// User Route Handlers
const createUser: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const user: Omit<User, "userId"> & { userId?: string } = req.body;
    if (!user.username || !user.email || !user.password) {
      res.status(400).json({ error: "username, email, and password are required" });
    } else {
      const generatedUserId = uuidv4();
      const newUser: User = {
        ...user,
        userId: generatedUserId,
      };
      const result = await db.collection("users").insertOne(newUser);
      res.status(201).json({ _id: result.insertedId, ...newUser });
    }
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
};

const getUser: RequestHandler<UserParams> = async (req: Request<UserParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const user = await db.collection("users").findOne({ userId });
    if (!user) {
      res.status(404).json({ error: "User not found" });
    } else {
      res.status(200).json(user);
    }
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

const getUserByWallet: RequestHandler<{ solanaWalletAddress: string }> = async (
  req: Request<{ solanaWalletAddress: string }>,
  res: Response
) => {
  console.log("1st getUserByWallet");
  try {
    const db = await connectToDatabase();
    const { solanaWalletAddress } = req.params;
    console.log("getUserByWallet solanaWalletAddress: ", solanaWalletAddress);
    const user = await db.collection("users").findOne({ solanaWalletAddress });
    console.log("getUserByWallet found user: ", user);
    if (!user) {
      res.status(404).json({ error: "User not found" });
    } else {
      res.status(200).json(user);
    }
  } catch (error) {
    console.error("Error fetching user by wallet:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

const getAllUsers: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const users = await db.collection("users").find().toArray();
    res.status(200).json(users);
  } catch (error) {
    console.error("Error fetching all users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
};

const getAgentById: RequestHandler<AgentParams> = async (req: Request<AgentParams>, res: Response) => {
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

const updateUser: RequestHandler<UserParams> = async (
  req: Request<UserParams>,
  res: Response
) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const updatedUser: Partial<User> = req.body;
    if ("username" in updatedUser && !updatedUser.username) {
      res.status(400).json({ error: "username cannot be empty" });
    } else if ("email" in updatedUser && !updatedUser.email) {
      res.status(400).json({ error: "email cannot be empty" });
    } else if ("password" in updatedUser && !updatedUser.password) {
      res.status(400).json({ error: "password cannot be empty" });
    } else {
      const result = await db.collection("users").updateOne(
        { userId },
        { $set: updatedUser }
      );
      if (result.matchedCount === 0) {
        res.status(404).json({ error: "User not found" });
      } else {
        res.status(200).json({ message: "User updated" });
      }
    }
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
};

const deleteUser: RequestHandler<UserParams> = async (
  req: Request<UserParams>,
  res: Response
) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const result = await db.collection("users").deleteOne({ userId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "User not found" });
    } else {
      res.status(200).json({ message: "User deleted" });
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};

const deleteAllUsers: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    await db.collection("users").deleteMany({});
    res.status(200).json({ message: "All users deleted" });
  } catch (error) {
    console.error("Error deleting all users:", error);
    res.status(500).json({ error: "Failed to delete all users" });
  }
};

const getAgentCount: RequestHandler = async (req: Request, res: Response) => {
  try {
    console.log("1st getAgentCount");
    const db = await connectToDatabase();
    const userId = req.params.userId;
    console.log("getAgentCount userId: ", userId);
    const count = await db.collection("agents").countDocuments({ createdBy: userId });
    console.log("2nd getAgentCount count: ", count);
    res.status(200).json({ count });
  } catch (error) {
    console.error("Error fetching agent count:", error);
    res.status(500).json({ error: "Failed to fetch agent count" });
  }
};

// Chat Endpoint (Non-Streaming)
const chatWithAgent: RequestHandler<ChatParams> = async (req: Request<ChatParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const agent = await db.collection("agents").findOne({ agentId: agentId });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    if (!agent.openaiApiKey) {
      res.status(400).json({ error: "Agent lacks OpenAI API key" });
      return;
    }

    const openai = new OpenAI({ apiKey: agent.openaiApiKey });
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: message }],
    });

    const reply = response.choices[0].message.content;
    res.status(200).json({ agentId, reply });
  } catch (error) {
    console.error("Chat error:", error);
    res.status(500).json({ error: "Failed to get response from agent" });
  }
};

// Chat Endpoint (Streaming)
const chatWithAgentStream: RequestHandler<ChatParams> = async (req: Request<ChatParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;
    const { message } = req.body;

    if (!message) {
      res.status(400).json({ error: "Message is required" });
      return;
    }

    const agent = await db.collection("agents").findOne({ agentId: agentId });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    if (!agent.openaiApiKey) {
      res.status(400).json({ error: "Agent lacks OpenAI API key" });
      return;
    }

    const openai = new OpenAI({ apiKey: agent.openaiApiKey });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const stream = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: message }],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || "";
      if (content) {
        res.write(`data: ${JSON.stringify({ agentId, content })}\n\n`);
      }
    }

    res.write("data: [DONE]\n\n");
    res.end();
  } catch (error) {
    console.error("Streaming chat error:", error);
    res.status(500).send("Error streaming response from agent");
  }
};

// Twitter Listener Setup
async function setupTwitterListeners(db: any) {
  try {
    const agents = await db.collection("agents").find({
      isActive: true,
      twitterHandle: { $exists: true, $ne: "" },
      twitterAppKey: { $exists: true, $ne: "" },
      twitterAppSecret: { $exists: true, $ne: "" },
      twitterAccessToken: { $exists: true, $ne: "" },
      twitterAccessSecret: { $exists: true, $ne: "" },
      openaiApiKey: { $exists: true, $ne: "" }
    }).toArray();

    for (const agent of agents) {
      if (hasValidTwitterCredentials(agent)) {
        await setupTwitterListener(agent);
        if (agent.enablePostTweet === true && agent.agentType === "basic") {
          startPostingInterval(agent);
        }
      } else {
        console.log(`Skipping Twitter features for agent ${agent.agentId}: Missing or invalid Twitter credentials`);
      }
    }
  } catch (error) {
    console.error("Error setting up Twitter listeners:", error);
  }
}

async function setupTwitterListener(agent: Agent) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup Twitter listener for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };

  const twitterClient = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });

  try {
    const currentRules = await twitterClient.v2.streamRules();
    if (currentRules.data && currentRules.data.length > 0) {
      await twitterClient.v2.updateStreamRules({
        delete: { ids: currentRules.data.map(rule => rule.id) }
      });
    }

    await twitterClient.v2.updateStreamRules({
      add: [{ value: `@${agent.twitterHandle}`, tag: agent.agentId }],
    });

    const stream = await twitterClient.v2.searchStream({
      "tweet.fields": ["author_id", "text", "in_reply_to_user_id"],
    });

    twitterStreams.set(agent.agentId, stream);

    stream.on('data', async (tweet) => {
      try {
        if (tweet.data.text.includes(`@${agent.twitterHandle}`)) {
          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: tweet.data.text }],
          });
          const replyText = `@${tweet.data.author_id} ${response.choices[0].message.content}`.slice(0, 280);

          await twitterClient.v1.tweet(replyText);
          console.log(`Agent ${agent.agentId} replied to tweet: ${replyText}`);
        }
      } catch (error) {
        console.error(`Error processing tweet for agent ${agent.agentId}:`, error);
      }
    });

    stream.on('error', (error) => {
      console.error(`Twitter stream error for agent ${agent.agentId}:`, error);
    });

    stream.autoReconnect = true;
    console.log(`Twitter listener started for agent ${agent.agentId}`);
  } catch (error) {
    console.error(`Failed to setup Twitter listener for agent ${agent.agentId}:`, error);
  }
}

// Register routes
app.post("/agents", createAgent);
app.get("/agents", getAllAgents);
app.get("/agents/active", getActiveAgents);
app.get("/agents/:agentId", getAgentById);
app.put("/agents/:agentId", updateAgent);
app.delete("/agents/:agentId", deleteAgent);
app.delete("/agents", deleteAllAgents);

app.post("/users", createUser);
app.get("/users/:userId", getUser);
app.get("/users/by-wallet/:solanaWalletAddress", getUserByWallet);
app.get("/users", getAllUsers);
app.get("/users/:userId/agents/count", getAgentCount);
app.put("/users/:userId", updateUser);
app.delete("/users/:userId", deleteUser);
app.delete("/users", deleteAllUsers);

app.post("/chat/:agentId", chatWithAgent);
app.post("/chat/stream/:agentId", chatWithAgentStream);

startServer();