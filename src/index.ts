import app from "./app";
import { connectToDatabase } from "./services/dbService";
import { setupTwitterListeners } from "./services/twitterService";
import { PORT } from "./config";

async function startServer() {
  try {
    const db = await connectToDatabase();
    await setupTwitterListeners(db);
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

startServer();