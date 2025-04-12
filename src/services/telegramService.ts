import TelegramBot from 'node-telegram-bot-api';
import { connectToDatabase } from './dbService';
import { Agent } from '../types/agent';
import { Task } from '../types/task';
import { AgentPromptGenerator } from '../utils/agentPromptGenerator';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import { TelegramMessage } from '../types/telegram';
import { FRONTEND_URL } from '../config';
import { saveTask, getRecentTasks, updateTask } from '../controllers/taskController';
import { shouldSaveAsTask } from '../utils/criteriaUtils';
import { TaskClassifier } from "../utils/TaskClassifier";

const telegramBots = new Map<string, [TelegramBot, string]>();
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY_MS = 5000;

export async function setupTelegramListener(agent: Agent) {
  if (!agent.telegramBotToken || !agent.enableTelegramReplies || !agent.settings?.platforms?.includes('telegram')) {
    console.log(`Skipping Telegram setup for agent ${agent.agentId}: Missing token, replies disabled, or Telegram not in platforms`);
    return;
  }

  const token: string = agent.telegramBotToken;
  stopTelegramListener(agent.agentId);

  for (const [existingAgentId, [, existingToken]] of telegramBots) {
    if (existingToken === token && existingAgentId !== agent.agentId) {
      console.log(`Token ${token} already in use by agent ${existingAgentId}, skipping setup for ${agent.agentId}`);
      return;
    }
  }

  let restartAttempts = 0;

  async function initializeBot() {
    try {
      const bot = new TelegramBot(token, { polling: true });
      telegramBots.set(agent.agentId, [bot, token]);

      const me = await bot.getMe();
      const botUsername = me.username ? `@${me.username}` : `@Bot_${agent.agentId}`;
      console.log(`Telegram bot initialized for agent ${agent.agentId}: ${botUsername}`);

      bot.on('message', async (msg: TelegramMessage) => {
        const db = await connectToDatabase();
        let task_id: string | undefined;
        let chatId: string | undefined;

        try {
          chatId = msg.chat.id.toString();
          const userId = msg.from?.id?.toString();
          if (!userId) {
            console.error(`No user ID found in message for agent ${agent.agentId}:`, msg);
            return;
          }
          const username = msg.from?.username || `user_${userId}`;
          const text = msg.text || '';
          console.log(`Message received for agent ${agent.agentId}: chatId=${chatId}, userId=${userId}, username=${username}, text="${text}", expectedGroup=${agent.telegramGroupId}`);

          const isMentioned = text.includes(botUsername);
          const isTargetGroup = agent.telegramGroupId && chatId === agent.telegramGroupId;
          console.log(`Processing message: isMentioned=${isMentioned}, isTargetGroup=${isTargetGroup}`);

          if (!isMentioned && !isTargetGroup) {
            console.log(`Skipping reply for agent ${agent.agentId}: Not mentioned and not target group`);
            return;
          }

          if (!(await canReplyToTelegramMessage(agent.agentId, db))) {
            console.log(`Agent ${agent.agentId} hit reply limit for Telegram`);
            return;
          }

          if (await hasRepliedToTelegramMessage(agent.agentId, msg.message_id, db)) {
            console.log(`Agent ${agent.agentId} already replied to message ${msg.message_id}`);
            return;
          }

          console.log(`Processing reply for agent ${agent.agentId}, hasOpenAIKey=${!!agent.openaiApiKey}`);
          if (!agent.openaiApiKey) {
            console.log(`No OpenAI API key for agent ${agent.agentId}, sending default response`);
            await bot.sendMessage(chatId, "I can't generate a smart reply without an OpenAI API key. Please configure one!");
            await saveTelegramReply(agent.agentId, msg.message_id, db);
            await incrementAgentTelegramReplyCount(agent.agentId, db);
            return;
          }

          // Identify user (registered only)
          const user = await db.collection("users").findOne({
            $or: [
              { "linked_channels.telegram_user_id": userId },
              { "telegramId": { $in: [username, `@${username}`] } }, // Match both username and @username
            ],
          });
          let unified_user_id: string | undefined;

          if (user) {
            unified_user_id = user.userId;
            console.log(`User ${unified_user_id} found for Telegram user ${userId}`);
          }

          // Handle unregistered users
          if (!unified_user_id) {
            const replyText = `Please visit ${FRONTEND_URL || 'valetapp.xyz'} to connect your wallet and register!`;
            await bot.sendMessage(chatId, replyText);
            console.log(`Agent ${agent.agentId} replied to unregistered user message ${msg.message_id}: ${replyText}`);
            await saveTelegramReply(agent.agentId, msg.message_id, db);
            await incrementAgentTelegramReplyCount(agent.agentId, db);
            return;
          }

          // Retrieve recent tasks
          const recentTasks = await getRecentTasks(
            {
              unified_user_id,
              channel_user_id: userId,
            },
            agent.settings?.max_memory_context || 5
          );
          const hasRecentTasks = recentTasks.length > 0;
          const context = recentTasks.map(t => `Command: ${t.command}, Result: ${t.result || "Pending"}`).join("\n");
          console.log(`Recent tasks for user ${unified_user_id}: ${context || "None"}`);

          // Classify and handle task
          const classification = await TaskClassifier.classifyTask(text, agent, recentTasks);
          console.log(`Task classification for message "${text}": type=${classification.task_type}, service=${classification.service_name}`);
          const shouldSaveTask = shouldSaveAsTask(text, hasRecentTasks);

          if (classification.task_type !== "chat" || shouldSaveTask) {
            // Validate image generation tasks
            if (classification.task_type === "api_call" && classification.service_name === "image_generation") {
              if (!classification.request_data?.prompt) {
                console.error(`Invalid image generation task for agent ${agent.agentId}: Missing prompt`);
                await bot.sendMessage(chatId, "Error: Please provide a valid prompt for image generation.");
                await saveTelegramReply(agent.agentId, msg.message_id, db);
                await incrementAgentTelegramReplyCount(agent.agentId, db);
                return;
              }
              // Clean the prompt by removing the bot's username
              classification.request_data.prompt = classification.request_data.prompt.replace(botUsername, '').trim();
              console.log(`Cleaned prompt for image generation: "${classification.request_data.prompt}"`);
            }

            task_id = uuidv4();
            const task: Task = {
              task_id,
              channel_id: chatId,
              channel_user_id: userId,
              unified_user_id,
              command: text,
              status: "pending",
              created_at: new Date(),
              completed_at: null,
              agent_id: agent.agentId,
              task_type: classification.task_type,
              external_service:
                classification.task_type !== "chat"
                  ? {
                      service_name: classification.service_name || "third_party_api",
                      request_data: classification.request_data,
                      status: "pending",
                      api_key: classification.api_key,
                    }
                  : undefined,
              max_retries: classification.task_type !== "chat" ? 3 : undefined,
              notified: false, // Initialize as not notified
            };
            await saveTask(task);
            console.log(`Saved task ${task_id} for agent ${agent.agentId}, message ${msg.message_id}: command="${text}", type=${classification.task_type}`);

            const replyText = `Your request has been queued for processing (Task ID: ${task_id}).`;
            await bot.sendMessage(chatId, replyText);
            console.log(`Agent ${agent.agentId} replied to message ${msg.message_id}: ${replyText}`);
            await saveTelegramReply(agent.agentId, msg.message_id, db);
            await incrementAgentTelegramReplyCount(agent.agentId, db);
            return;
          }

          // Handle chat messages
          const openai = new OpenAI({ apiKey: agent.openaiApiKey });
          const promptGenerator = new AgentPromptGenerator(agent);
          const prompt = isMentioned
            ? promptGenerator.generatePrompt(
                `Reply to this Telegram mention from @${username}: "${text}"\nPersonalize your response by addressing @${username} directly.\nPrevious interactions:\n${context || "None"}`
              )
            : promptGenerator.generatePrompt(
                `Reply to this group message from @${username}: "${text}"\nPersonalize your response by addressing @${username} directly.\nPrevious interactions:\n${context || "None"}`
              );
          console.log(`Generated prompt for agent ${agent.agentId}: ${prompt}`);

          const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
          });
          let replyText = response.choices[0]?.message?.content || `Sorry, @${username}, I couldn’t generate a response.`;
          replyText = replyText.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/#\w+/g, '');

          await bot.sendMessage(chatId, replyText);
          console.log(`Reply sent for agent ${agent.agentId}, message ${msg.message_id}: ${replyText}`);

          await saveTelegramReply(agent.agentId, msg.message_id, db);
          await incrementAgentTelegramReplyCount(agent.agentId, db);
        } catch (error) {
          console.error(`Error generating reply for agent ${agent.agentId}, message ${msg.message_id}:`, error);
          if (chatId) {
            await bot.sendMessage(chatId, 'Oops, something went wrong while generating a reply.');
          }
          if (task_id) {
            await updateTask(task_id, {
              status: "failed",
              result: "Error processing request",
              completed_at: new Date(),
              notified: false, // Ensure failed tasks can be notified
            });
            console.log(`Marked task ${task_id} as failed for agent ${agent.agentId}`);
          }
        }
      });

      bot.on('polling_error', async (error: Error) => {
        console.error(`Polling error for agent ${agent.agentId}:`, error);
        if (error.message.includes('409 Conflict')) {
          console.log(`Conflict detected for agent ${agent.agentId}, attempt ${restartAttempts + 1} of ${MAX_RESTART_ATTEMPTS}`);
          stopTelegramListener(agent.agentId);
          if (restartAttempts < MAX_RESTART_ATTEMPTS) {
            restartAttempts++;
            setTimeout(() => {
              console.log(`Restarting Telegram listener for agent ${agent.agentId} after conflict`);
              initializeBot();
            }, RESTART_DELAY_MS);
          } else {
            console.error(`Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached for agent ${agent.agentId}, giving up`);
          }
        }
      });

      console.log(`Telegram listener started for agent ${agent.agentId}`);
    } catch (error) {
      console.error(`Error setting up Telegram for agent ${agent.agentId}:`, error);
      stopTelegramListener(agent.agentId);
    }
  }

  await initializeBot();
}

export function getTelegramBot(agentId: string): TelegramBot | undefined {
  const botEntry = telegramBots.get(agentId);
  return botEntry ? botEntry[0] : undefined;
}

export async function setupTelegramListeners(db: any) {
  try {
    const agents = await getActiveTelegramAgents(db);
    console.log(`Found ${agents.length} active Telegram agents`);
    for (const agent of agents) {
      await setupTelegramListener(agent);
    }
  } catch (error) {
    console.error('Error setting up Telegram listeners:', error);
  }
}

export function stopTelegramListener(agentId: string) {
  const botEntry = telegramBots.get(agentId);
  if (botEntry) {
    const [bot] = botEntry;
    try {
      bot.stopPolling();
      telegramBots.delete(agentId);
      console.log(`Telegram listener stopped and removed for agent ${agentId}`);
    } catch (error) {
      console.error(`Error stopping Telegram listener for agent ${agentId}:`, error);
    }
  } else {
    console.log(`No Telegram listener found to stop for agent ${agentId}`);
  }
}

export async function getActiveTelegramAgents(db: any): Promise<Agent[]> {
  try {
    const agents = await db.collection('agents').find({
      isActive: true,
      'settings.platforms': { $in: ['telegram'] },
      telegramBotToken: { $exists: true, $ne: '' },
      openaiApiKey: { $exists: true, $ne: '' },
    }).toArray();
    console.log(`Fetched ${agents.length} active Telegram agents`);
    return agents;
  } catch (error) {
    console.error('Error fetching active Telegram agents:', error);
    return [];
  }
}

export async function hasRepliedToTelegramMessage(agentId: string, messageId: number, db: any): Promise<boolean> {
  try {
    const reply = await db.collection('telegramReplies').findOne({ agentId, messageId });
    const hasReplied = !!reply;
    console.log(`Checked reply status for agent ${agentId}, message ${messageId}: ${hasReplied}`);
    return hasReplied;
  } catch (error) {
    console.error(`Error checking Telegram reply for agent ${agentId}:`, error);
    return true; // Fail-safe
  }
}

export async function saveTelegramReply(agentId: string, messageId: number, db: any): Promise<void> {
  try {
    await db.collection('telegramReplies').insertOne({
      agentId,
      messageId,
      repliedAt: new Date(),
    });
    console.log(`Saved Telegram reply for agent ${agentId}, message ${messageId}`);
  } catch (error) {
    console.error(`Error saving Telegram reply for agent ${agentId}:`, error);
  }
}

export async function canReplyToTelegramMessage(agentId: string, db: any): Promise<boolean> {
  try {
    const limitDoc = await db.collection('agentDailyLimits').findOne({ agentId });
    const now = new Date();
    const maxRepliesPerDay = parseInt(process.env.MAX_TELEGRAM_REPLIES_PER_DAY || '12', 10);

    if (limitDoc?.telegramReplyCount && limitDoc.lastTelegramReplyLimitHit) {
      const timeSinceLimit = now.getTime() - new Date(limitDoc.lastTelegramReplyLimitHit).getTime();
      if (timeSinceLimit >= 24 * 60 * 60 * 1000) {
        await db.collection('agentDailyLimits').updateOne(
          { agentId },
          { $set: { telegramReplyCount: 0, lastTelegramReplyLimitHit: null } },
          { upsert: true }
        );
        console.log(`Reset Telegram reply limit for agent ${agentId}`);
        return true;
      }
    }

    const replyCount = limitDoc?.telegramReplyCount || 0;
    console.log(`Telegram reply limit check for agent ${agentId}: ${replyCount}/${maxRepliesPerDay}`);
    return replyCount < maxRepliesPerDay;
  } catch (error) {
    console.error(`Error checking Telegram reply limit for agent ${agentId}:`, error);
    return false;
  }
}

export async function incrementAgentTelegramReplyCount(agentId: string, db: any): Promise<void> {
  try {
    const limitDoc = await db.collection('agentDailyLimits').findOne({ agentId });
    const replyCount = (limitDoc?.telegramReplyCount || 0) + 1;
    const update: any = { $set: { telegramReplyCount: replyCount } };

    if (replyCount === parseInt(process.env.MAX_TELEGRAM_REPLIES_PER_DAY || '12', 10)) {
      update.$set.lastTelegramReplyLimitHit = new Date();
    }

    if (limitDoc?.postCount) update.$set.postCount = limitDoc.postCount;
    if (limitDoc?.replyCount) update.$set.replyCount = limitDoc.replyCount;
    if (limitDoc?.lastPostLimitHit) update.$set.lastPostLimitHit = limitDoc.lastPostLimitHit;
    if (limitDoc?.lastReplyLimitHit) update.$set.lastReplyLimitHit = limitDoc.lastReplyLimitHit;

    await db.collection('agentDailyLimits').updateOne({ agentId }, update, { upsert: true });
    console.log(`Incremented Telegram reply count for agent ${agentId} to ${replyCount}`);
  } catch (error) {
    console.error(`Error incrementing Telegram reply count for agent ${agentId}:`, error);
  }
}