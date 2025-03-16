// app.ts
import express, { Express } from "express";
import session from "express-session";
import corsMiddleware from "./middleware/cors";
import agentRoutes from "./routes/agentRoutes";
import userRoutes from "./routes/userRoutes";
import chatRoutes from "./routes/chatRoutes";
import twitterRoutes from "./routes/twitterRoutes";
import imageRoutes from "./routes/imageRoutes";

const app: Express = express();

app.use(corsMiddleware);
app.use(express.json());

app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: process.env.NODE_ENV === "production",
      maxAge: 24 * 60 * 60 * 1000,
    },
  })
);

app.use("/agents", agentRoutes);
app.use("/twitter", twitterRoutes);
app.use("/users", userRoutes);
app.use("/chat", chatRoutes);
app.use("/images", imageRoutes);


// Add at the end, before export
app.get('/', (req, res) => {
    res.send('Valet Server is live!');
});


export default app;
