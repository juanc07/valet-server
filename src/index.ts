import express, { Request, Response, Express, RequestHandler } from "express";
import dotenv from "dotenv";
import cors from "cors"; // Import cors
import { connectToDatabase } from "./db";
import { Agent } from "./types/agent";

dotenv.config();

const app: Express = express();
const port = process.env.PORT || 3000;

// less secure
//app.use(cors()); // Allows all origins, all methods, all headers

// more flexible with different origin
app.use(cors({
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.FRONTEND_URL,
      "http://localhost:3001",
      "http://localhost:5173",
      undefined, // Allows requests with no origin (e.g., Postman)
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

// Define params interface for routes with :id
interface AgentParams {
  id: string;
}

// Connect to MongoDB and start server
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

// Route handlers
const createAgent: RequestHandler = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agent: Agent = req.body;
    agent.isActive = true;
    const result = await db.collection("agents").insertOne(agent);
    res.status(201).json({ _id: result.insertedId, ...agent });
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
    const updatedAgent: Agent = req.body;
    const result = await db.collection("agents").updateOne(
      { id: agentId },
      { $set: updatedAgent }
    );
    if (result.matchedCount === 0) {
      res.status(404).json({ error: "Agent not found" });
    } else {
      res.status(200).json({ message: "Agent updated" });
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

// Register routes
app.post("/agents", createAgent);
app.get("/agents", getAllAgents);
app.get("/agents/active", getActiveAgents);
app.put("/agents/:id", updateAgent);
app.delete("/agents/:id", deleteAgent);
app.delete("/agents", deleteAllAgents);

// Start the server
startServer();