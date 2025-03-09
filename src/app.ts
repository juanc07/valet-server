import express, { Express } from "express";
import corsMiddleware from "./middleware/cors";
import agentRoutes from "./routes/agentRoutes";
import userRoutes from "./routes/userRoutes";
import chatRoutes from "./routes/chatRoutes";

const app: Express = express();

app.use(corsMiddleware);
app.use(express.json());

app.use("/agents", agentRoutes);
app.use("/users", userRoutes);
app.use("/chat", chatRoutes);

export default app;