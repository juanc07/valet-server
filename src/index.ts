import app from "./app";
import { connectToDatabase } from "./services/dbService";
import { setupTwitterListeners } from "./services/twitterService";
import { PORT } from "./config";

// Handle uncaught exceptions (synchronous errors)
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1); // Exit to trigger PM2 restart
});

// Handle unhandled promise rejections (async errors)
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1); // Exit to trigger PM2 restart
});

async function startServer() {
  try {
    const db = await connectToDatabase();
    await setupTwitterListeners(db);
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1); // Already here—good for startup errors
  }
}

startServer();