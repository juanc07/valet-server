import express, { Express } from "express";
import session from "express-session";
import corsMiddleware from "./middleware/cors";
import agentRoutes from "./routes/agentRoutes";
import userRoutes from "./routes/userRoutes";
import chatRoutes from "./routes/chatRoutes";
import twitterRoutes from "./routes/twitterRoutes";

const app: Express = express();

app.use(corsMiddleware);
app.use(express.json());

app.use(
    session({
        secret: "your-secret-key", // Replace with a secure, unique secret (e.g., from .env)
        resave: false,            // Don’t resave session if unmodified
        saveUninitialized: false, // Don’t save uninitialized sessions
        cookie: {
            secure: process.env.NODE_ENV === "production", // Secure cookies in production (HTTPS)
            maxAge: 24 * 60 * 60 * 1000,                   // Session expires in 24 hours
        },
    })
);

app.use("/agents", agentRoutes);
app.use("/twitter", twitterRoutes);
app.use("/users", userRoutes);
app.use("/chat", chatRoutes);

export default app;