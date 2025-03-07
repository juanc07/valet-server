import express, { Request, Response, Express, RequestHandler } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
import { TwitterApi, TwitterApiTokens } from "twitter-api-v2";
import OpenAI from "openai";
import { connectToDatabase } from "./db";
import { Agent } from "./types/agent";
import { User } from "./types/user";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

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
  id: string;
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

    // Start Twitter listeners for all valid agents
    await setupTwitterListeners(db);

    app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

// Agent Route Handlers
const createAgent: RequestHandler = async (req: Request, res: Response) => {
  console.log("1st createAgent");
  try {
    const db = await connectToDatabase();
    const agent: Omit<Agent, "id"> & { id?: string } = req.body;

    // Define required fields with expected types
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

    // Validate required fields
    const missingFields: string[] = [];
    const invalidFields: string[] = [];

    for (const field of requiredFields) {
      const [parent, child] = field.key.split(".");
      let value: any;

      if (child) {
        // Nested field (e.g., personality.tone)
        value = (agent as any)[parent]?.[child];
      } else {
        // Top-level field
        value = (agent as any)[field.key];
      }

      // Check if field is missing or empty
      if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
        missingFields.push(field.key);
      } else if (typeof value !== field.type) {
        // Validate type
        invalidFields.push(`${field.key} must be a ${field.type}`);
      }
    }

    // Validate agentType specifically
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
      return; // No explicit return of Response, just return void
    }

    console.log("2nd createAgent no missing fields");

    const generatedId = uuidv4();
    const newAgent: Agent = {
      ...agent,
      id: generatedId,
      isActive: true,
    };

    const result = await db.collection("agents").insertOne(newAgent);

    console.log("3rd createAgent created");

    // Twitter listener setup
    if (
      typeof newAgent.twitterHandle === "string" &&
      newAgent.twitterHandle.trim() !== "" &&
      typeof newAgent.twitterAppKey === "string" &&
      newAgent.twitterAppKey.trim() !== "" &&
      typeof newAgent.twitterAppSecret === "string" &&
      newAgent.twitterAppSecret.trim() !== "" &&
      typeof newAgent.twitterAccessToken === "string" &&
      newAgent.twitterAccessToken.trim() !== "" &&
      typeof newAgent.twitterAccessSecret === "string" &&
      newAgent.twitterAccessSecret.trim() !== ""
    ) {
      try {
        await setupTwitterListener(newAgent);
        console.log("4th createAgent twitter listener setup");
      } catch (error) {
        console.error(`Failed to start Twitter listener for new agent ${newAgent.id}:`, error);
        console.log("5th createAgent twitter listener failed");
      }
    } else {
      console.log(`Skipping Twitter listener for agent ${newAgent.id}: Missing or invalid Twitter credentials`);
      console.log("6th createAgent twitter listener skipped");
    }

    console.log("7th createAgent resnpose call!");
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
    console.error(error);
    res.status(500).json({ error: "Failed to fetch agents" });
  }
};

const getActiveAgents: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agents = await db.collection("agents").find({ isActive: true }).toArray();
    res.status(200).json(agents);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch active agents" });
  }
};

const updateAgent: RequestHandler<AgentParams> = async (
  req: Request<AgentParams>,
  res: Response
) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.id;
    const updatedAgent: Partial<Agent> = req.body;
    if ("userId" in updatedAgent && !updatedAgent.userId) {
      res.status(400).json({ error: "userId cannot be empty" });
    } else {
      const result = await db.collection("agents").updateOne(
        { id: agentId },
        { $set: updatedAgent }
      );
      if (result.matchedCount === 0) {
        res.status(404).json({ error: "Agent not found" });
      } else {
        res.status(200).json({ message: "Agent updated" });
      }
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to update agent" });
  }
};

const deleteAgent: RequestHandler<AgentParams> = async (
  req: Request<AgentParams>,
  res: Response
) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.id;
    const result = await db.collection("agents").deleteOne({ id: agentId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: "Agent not found" });
    } else {
      res.status(200).json({ message: "Agent deleted" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to delete agent" });
  }
};

const deleteAllAgents: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    await db.collection("agents").deleteMany({});
    res.status(200).json({ message: "All agents deleted" });
  } catch (error) {
    console.error(error);
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
    console.error(error);
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
    console.error(error);
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
    console.error(error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
};

const getAllUsers: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const users = await db.collection("users").find().toArray();
    res.status(200).json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch users" });
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
    console.error(error);
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
    console.error(error);
    res.status(500).json({ error: "Failed to delete user" });
  }
};

const deleteAllUsers: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    await db.collection("users").deleteMany({});
    res.status(200).json({ message: "All users deleted" });
  } catch (error) {
    console.error(error);
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

    const agent = await db.collection("agents").findOne({ id: agentId });
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

    const agent = await db.collection("agents").findOne({ id: agentId });
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    if (!agent.openaiApiKey) {
      res.status(400).json({ error: "Agent lacks OpenAI API key" });
      return;
    }

    const openai = new OpenAI({ apiKey: agent.openaiApiKey });

    // Set headers for streaming
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
      twitterHandle: { $exists: true, $ne: "" },
      twitterAppKey: { $exists: true, $ne: "" },
      twitterAppSecret: { $exists: true, $ne: "" },
      twitterAccessToken: { $exists: true, $ne: "" },
      twitterAccessSecret: { $exists: true, $ne: "" },
      openaiApiKey: { $exists: true, $ne: "" }
    }).toArray();

    agents.forEach((agent: Agent) => {
      if (
        typeof agent.twitterHandle === "string" &&
        agent.twitterHandle.trim() !== "" &&
        typeof agent.twitterAppKey === "string" &&
        agent.twitterAppKey.trim() !== "" &&
        typeof agent.twitterAppSecret === "string" &&
        agent.twitterAppSecret.trim() !== "" &&
        typeof agent.twitterAccessToken === "string" &&
        agent.twitterAccessToken.trim() !== "" &&
        typeof agent.twitterAccessSecret === "string" &&
        agent.twitterAccessSecret.trim() !== ""
      ) {
        setupTwitterListener(agent);
      } else {
        console.log(`Skipping Twitter listener for agent ${agent.id}: Missing or invalid Twitter credentials`);
      }
    });
  } catch (error) {
    console.error("Error setting up Twitter listeners:", error);
  }
}

async function setupTwitterListener(agent: Agent) {
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
      add: [{ value: `@${agent.twitterHandle}`, tag: agent.id }],
    });

    const stream = await twitterClient.v2.searchStream({
      "tweet.fields": ["author_id", "text", "in_reply_to_user_id"],
    });

    stream.on('data', async (tweet) => {
      try {
        if (tweet.data.text.includes(`@${agent.twitterHandle}`)) {
          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: tweet.data.text }],
          });
          const replyText = `@${tweet.data.author_id} ${response.choices[0].message.content}`.slice(0, 280);

          await twitterClient.v1.tweet(replyText);
          console.log(`Agent ${agent.id} replied to tweet: ${replyText}`);
        }
      } catch (error) {
        console.error(`Error processing tweet for agent ${agent.id}:`, error);
      }
    });

    stream.on('error', (error) => {
      console.error(`Twitter stream error for agent ${agent.id}:`, error);
    });

    stream.autoReconnect = true;
  } catch (error) {
    console.error(`Failed to setup Twitter listener for agent ${agent.id}:`, error);
  }
}

// Register routes
app.post("/agents", createAgent);
app.get("/agents", getAllAgents);
app.get("/agents/active", getActiveAgents);
app.put("/agents/:id", updateAgent);
app.delete("/agents/:id", deleteAgent);
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