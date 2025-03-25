import express, { Express } from "express";
import rateLimit from "express-rate-limit";
import corsMiddleware from "./middleware/cors";
import agentRoutes from "./routes/agentRoutes";
import userRoutes from "./routes/userRoutes";
import chatRoutes from "./routes/chatRoutes";
import twitterRoutes from "./routes/twitterRoutes";
import imageRoutes from "./routes/imageRoutes";
import utilityRoutes from "./routes/utilityRoutes";
import dotenv from "dotenv";

dotenv.config();

const app: Express = express();
const API_KEY = process.env.API_KEY || "your-secure-api-key-here";

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.headers["X-From-Vercel"] === "true",
});

const apiKeyMiddleware = (req: express.Request, res: express.Response, next: express.NextFunction) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey === API_KEY) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
  }
};

app.use(limiter);
app.use(corsMiddleware);
app.use(apiKeyMiddleware);

// Middleware Strategy:
// - express.json() is applied only to routes expecting JSON payloads.
// - Routes like /images use multer for multipart/form-data and skip JSON parsing.

// Apply express.json() only to routes that need it
app.use("/agents", express.json(), agentRoutes);
app.use("/twitter", express.json(), twitterRoutes);
app.use("/users", express.json(), userRoutes);
app.use("/chat", express.json(), chatRoutes);
app.use("/utility", express.json(), utilityRoutes);

// Image routes use multer, no JSON parsing needed
app.use("/images", imageRoutes);

app.get("/", (req, res) => {
  res.send("Valet Server is live!");
});

app.get("/status", (req, res) => {
  const isLive = true; // Add any additional health checks here if needed
  res.status(200).json({ isLive });
});

// Error handling middleware (catch route errors)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error("Route Error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

export default app;