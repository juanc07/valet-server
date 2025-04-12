import { connectToDatabase } from "./dbService";
import { TwitterApi } from "twitter-api-v2";
import TelegramBot from "node-telegram-bot-api";
import { Task } from "../types/task";
import { Agent } from "../types/agent";
import { TWITTER_INTEGRATION, TWITTER_APP_KEY, TWITTER_APP_SECRET } from "../config";
import { getTelegramBot } from "./telegramService";
import axios from "axios";

export class TaskMonitor {
  private static pollingInterval: NodeJS.Timeout | null = null;
  private static twitterClients = new Map<string, TwitterApi>();
  private static telegramBots = new Map<string, TelegramBot>();

  static async startMonitoring() {
    if (this.pollingInterval) {
      console.log("Task monitoring already running");
      return;
    }

    const db = await connectToDatabase();
    this.pollingInterval = setInterval(async () => {
      try {
        const tasks = await db
          .collection("tasks")
          .find({
            $or: [
              { status: { $in: ["pending", "in_progress", "awaiting_external"] } },
              { status: "completed", notified: { $ne: true } }, // Include completed tasks that haven't been notified
              { status: "failed", notified: { $ne: true } }, // Include failed tasks that haven't been notified
            ],
            created_at: {
              $gte: new Date(Date.now() - 60 * 1000), // 60s timeout for all tasks
            },
          })
          .toArray() as Task[];

        console.log(`Monitoring ${tasks.length} tasks`);

        for (const task of tasks) {
          console.log(`Checking task ${task.task_id}: type=${task.task_type}, status=${task.status}, created_at=${task.created_at}, notified=${task.notified}`);
          const elapsed = (Date.now() - new Date(task.created_at).getTime()) / 1000;
          if (elapsed > 60) {
            await db.collection("tasks").updateOne(
              { task_id: task.task_id },
              { $set: { status: "failed", result: "Task timed out", completed_at: new Date(), notified: false } }
            );
            console.log(`Task ${task.task_id} timed out after ${elapsed}s`);
            await this.notifyUser(task, "Task timed out. Please try again.");
            await db.collection("tasks").updateOne(
              { task_id: task.task_id },
              { $set: { notified: true } }
            );
            continue;
          }

          const updatedTask = await db.collection("tasks").findOne({ task_id: task.task_id }) as Task;
          console.log(`Updated task ${updatedTask.task_id} status: ${updatedTask.status}, notified=${updatedTask.notified}`);
          if ((updatedTask.status === "completed" || updatedTask.status === "failed") && !updatedTask.notified) {
            const message =
              updatedTask.status === "completed"
                ? updatedTask.task_type === "api_call" && updatedTask.external_service?.service_name === "image_generation"
                  ? `Image generated successfully!`
                  : `Task completed: ${updatedTask.result || "Done"}`
                : `Task failed: ${updatedTask.result || "Unknown error"}`;
            console.log(`Notifying user for task ${updatedTask.task_id}: ${message}`);
            await this.notifyUser(updatedTask, message);
            await db.collection("tasks").updateOne(
              { task_id: updatedTask.task_id },
              { $set: { notified: true } }
            );
            console.log(`Marked task ${updatedTask.task_id} as notified`);
          }
        }
      } catch (error) {
        console.error("Task monitoring error:", error);
      }
    }, 5000); // Poll every 5 seconds
  }

  static async notifyUser(task: Task, message: string) {
    const db = await connectToDatabase();
    const agent = await db.collection("agents").findOne({ agentId: task.agent_id }) as Agent | null;
    if (!agent) {
      console.error(`No agent found for task ${task.task_id}, agentId=${task.agent_id}`);
      return;
    }

    console.log(`Notifying for task ${task.task_id}, channel=${task.channel_id}, agent=${agent.agentId}`);

    if (task.channel_id.startsWith("twitter_")) {
      let twitterClient = this.twitterClients.get(task.agent_id);
      if (!twitterClient && agent.twitterAccessToken && agent.twitterAccessSecret) {
        twitterClient = new TwitterApi({
          appKey: TWITTER_INTEGRATION === "advance" ? agent.twitterAppKey! : TWITTER_APP_KEY!,
          appSecret: TWITTER_INTEGRATION === "advance" ? agent.twitterAppSecret! : TWITTER_APP_SECRET!,
          accessToken: agent.twitterAccessToken,
          accessSecret: agent.twitterAccessSecret,
        });
        this.twitterClients.set(task.agent_id, twitterClient);
        console.log(`Initialized Twitter client for agent ${task.agent_id}`);
      }

      if (twitterClient && task.channel_user_id) {
        const username = await this.getTwitterUsername(task.channel_user_id, twitterClient);
        if (username) {
          try {
            const tweetOptions: any = {
              text: `@${username} ${message.slice(0, 280 - username.length - 2)}`,
              reply: { in_reply_to_tweet_id: task.channel_id.replace("twitter_", "") },
            };

            // Handle image generation tasks
            if (
              task.task_type === "api_call" &&
              task.status === "completed" &&
              task.result &&
              task.external_service?.service_name === "image_generation"
            ) {
              if (this.isValidImageUrl(task.result)) {
                // Download the image
                const response = await axios.get(task.result, { responseType: "arraybuffer" });
                const imageBuffer = Buffer.from(response.data, "binary");
                console.log(`Downloaded image for task ${task.task_id}: ${task.result}`);

                // Upload the image to Twitter
                const mediaId = await twitterClient.v1.uploadMedia(imageBuffer, { mimeType: "image/png" });
                console.log(`Uploaded image to Twitter for task ${task.task_id}, mediaId: ${mediaId}`);

                // Attach the media to the tweet
                tweetOptions.media = { media_ids: [mediaId] };
              } else {
                await twitterClient.v2.tweet({
                  text: `@${username} Error: Invalid image generated. Please try again.`,
                  reply: { in_reply_to_tweet_id: task.channel_id.replace("twitter_", "") },
                });
                await db.collection("tasks").updateOne(
                  { task_id: task.task_id },
                  { $set: { status: "failed", result: "Invalid image URL", completed_at: new Date(), notified: false } }
                );
                console.error(`Invalid image URL for task ${task.task_id}: ${task.result}`);
                return;
              }
            }

            await twitterClient.v2.tweet(tweetOptions);
            console.log(`Notified Twitter user ${username} for task ${task.task_id}: ${message}`);
            if (tweetOptions.media) {
              console.log(`Attached image to tweet for task ${task.task_id}, mediaId: ${tweetOptions.media.media_ids[0]}`);
            }
          } catch (error) {
            console.error(`Error notifying Twitter user for task ${task.task_id}:`, error);
            try {
              await twitterClient.v2.tweet({
                text: `@${username} Failed to process your request. Please try again.`,
                reply: { in_reply_to_tweet_id: task.channel_id.replace("twitter_", "") },
              });
              await db.collection("tasks").updateOne(
                { task_id: task.task_id },
                { $set: { status: "failed", result: "Notification error", completed_at: new Date(), notified: false } }
              );
              console.log(`Marked task ${task.task_id} as failed due to notification error`);
            } catch (sendError) {
              console.error(`Error sending fallback message for task ${task.task_id}:`, sendError);
            }
          }
        } else {
          console.error(`No Twitter username found for user ${task.channel_user_id}, task ${task.task_id}`);
        }
      }
    } else if (task.channel_id.match(/^-?\d+$/)) {
      let bot = this.telegramBots.get(task.agent_id) || getTelegramBot(task.agent_id);
      if (!bot && agent.telegramBotToken) {
        bot = new TelegramBot(agent.telegramBotToken, { polling: true });
        this.telegramBots.set(task.agent_id, bot);
        console.log(`Initialized Telegram bot for agent ${task.agent_id}`);
      }

      if (bot) {
        try {
          await bot.sendMessage(task.channel_id, message);
          console.log(`Sent message to Telegram user for task ${task.task_id}: ${message}`);
          if (
            task.task_type === "api_call" &&
            task.status === "completed" &&
            task.result &&
            task.external_service?.service_name === "image_generation"
          ) {
            if (this.isValidImageUrl(task.result)) {
              await bot.sendPhoto(task.channel_id, task.result);
              console.log(`Sent image to Telegram user for task ${task.task_id}: ${task.result}`);
            } else {
              await bot.sendMessage(task.channel_id, "Error: Invalid image generated. Please try again.");
              await db.collection("tasks").updateOne(
                { task_id: task.task_id },
                { $set: { status: "failed", result: "Invalid image URL", completed_at: new Date(), notified: false } }
              );
              console.error(`Invalid image URL for task ${task.task_id}: ${task.result}`);
            }
          }
        } catch (error) {
          console.error(`Error notifying Telegram user for task ${task.task_id}:`, error);
          try {
            await bot.sendMessage(task.channel_id, "Failed to process your request. Please try again.");
            await db.collection("tasks").updateOne(
              { task_id: task.task_id },
              { $set: { status: "failed", result: "Notification error", completed_at: new Date(), notified: false } }
            );
            console.log(`Marked task ${task.task_id} as failed due to notification error`);
          } catch (sendError) {
            console.error(`Error sending fallback message for task ${task.task_id}:`, sendError);
          }
        }
      } else {
        console.error(`No Telegram bot available for task ${task.task_id}, agent ${task.agent_id}`);
      }
    }
  }

  static async getTwitterUsername(userId: string, client: TwitterApi): Promise<string | undefined> {
    try {
      const user = await client.v2.user(userId, { "user.fields": ["username"] });
      console.log(`Fetched Twitter username for user ${userId}: ${user.data?.username}`);
      return user.data?.username;
    } catch (error) {
      console.error(`Error fetching Twitter username for ${userId}:`, error);
      return undefined;
    }
  }

  static stopMonitoring() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log("Task monitoring stopped");
    }
  }

  static isValidImageUrl(url: string): boolean {
    try {
      const urlObj = new URL(url);
      // Split the pathname to ignore query parameters
      const pathname = urlObj.pathname;
      const isValid = /\.(jpg|jpeg|png|gif|bmp)$/i.test(pathname);
      console.log(`Validated image URL ${url}: isValid=${isValid}, pathname=${pathname}`);
      return isValid;
    } catch (error) {
      console.error(`Invalid image URL ${url}:`, error);
      return false;
    }
  }
}