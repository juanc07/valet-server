import express, { Request, Response, Express, RequestHandler } from "express";
import dotenv from "dotenv";
import cors from "cors";
import { v4 as uuidv4 } from "uuid";
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

async function startServer() {
  try {
    await connectToDatabase();
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
  try {
    const db = await connectToDatabase();
    const agent: Omit<Agent, "id"> & { id?: string } = req.body;
    if (!agent.userId) {
      res.status(400).json({ error: "userId is required" });
    } else {
      const generatedId = uuidv4();
      const newAgent: Agent = {
        ...agent,
        id: generatedId,
        isActive: true,
      };
      const result = await db.collection("agents").insertOne(newAgent);
      res.status(201).json({ _id: result.insertedId, ...newAgent });
    }
  } catch (error) {
    console.error(error);
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

// Register routes
app.post("/agents", createAgent);
app.get("/agents", getAllAgents);
app.get("/agents/active", getActiveAgents);
app.put("/agents/:id", updateAgent);
app.delete("/agents/:id", deleteAgent);
app.delete("/agents", deleteAllAgents);

app.post("/users", createUser);
app.get("/users/:userId", getUser);
app.get("/users", getAllUsers);
app.put("/users/:userId", updateUser);
app.delete("/users/:userId", deleteUser);
app.delete("/users", deleteAllUsers);

// Start the server
startServer();