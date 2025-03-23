import express, { Express } from "express";
import session from "express-session";
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
  skip: (req) => {
    return req.headers['X-From-Vercel'] === 'true';
  },
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
app.use(express.json());

/*
app.use(
  session({
    secret: process.env.SESSION_SECRET || "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);*/

app.use("/agents", agentRoutes);
app.use("/twitter", twitterRoutes);
app.use("/users", userRoutes);
app.use("/chat", chatRoutes);
app.use("/images", imageRoutes);
app.use("/utility", utilityRoutes);

app.get("/", (req, res) => {
  res.send("Valet Server is live!");
});

// New status endpoint
app.get("/status", (req, res) => {
  // Add any additional health checks here if needed
  const isLive = true; // You can modify this based on actual service status
  res.status(200).json({ isLive });
});

// Error handling middleware (catch route errors)
app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('Route Error:', err);
  res.status(500).json({ error: "Internal Server Error" });
});

export default app;