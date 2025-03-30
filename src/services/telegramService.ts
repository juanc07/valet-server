import TelegramBot from 'node-telegram-bot-api';
import { connectToDatabase } from './dbService';
import { Agent } from '../types/agent';
import { AgentPromptGenerator } from '../agentPromptGenerator';
import OpenAI from 'openai';
import { TelegramMessage } from '../types/telegram';

const telegramBots = new Map<string, [TelegramBot, string]>();
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY_MS = 5000;

export async function setupTelegramListener(agent: Agent) {
  // Early return if token is missing or other conditions aren't met
  if (!agent.telegramBotToken || !agent.enableTelegramReplies || !agent.settings?.platforms?.includes('telegram')) {
    console.log(`Skipping Telegram setup for agent ${agent.agentId}: Missing token, replies disabled, or Telegram not in platforms`);
    return;
  }

  // At this point, agent.telegramBotToken is guaranteed to be non-undefined due to the !agent.telegramBotToken check
  const token: string = agent.telegramBotToken; // Type guard ensures this is string

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
      const botUsername = `@${me.username}`;
      console.log(`Telegram bot initialized for agent ${agent.agentId}: ${botUsername}`);

      bot.on('message', async (msg: TelegramMessage) => {
        const db = await connectToDatabase();
        const chatId = msg.chat.id.toString();
        const text = msg.text || '';
        console.log(`Message received: chatId=${chatId}, text="${text}", expectedGroup=${agent.telegramGroupId}`);

        const isMentioned = text.includes(botUsername);
        const isTargetGroup = agent.telegramGroupId && chatId === agent.telegramGroupId;
        console.log(`isMentioned=${isMentioned}, isTargetGroup=${isTargetGroup}`);

        if (!isMentioned && !isTargetGroup) {
          console.log(`Skipping reply: Not mentioned and not target group`);
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

        try {
          console.log(`Generating OpenAI response for agent ${agent.agentId}`);
          const openai = new OpenAI({ apiKey: agent.openaiApiKey });
          const promptGenerator = new AgentPromptGenerator(agent);
          const prompt = isMentioned
            ? promptGenerator.generatePrompt(`Reply to this Telegram mention: "${text}"`)
            : promptGenerator.generatePrompt(`Reply to this group message: "${text}"`);
          console.log(`Generated prompt: ${prompt}`);

          const response = await openai.chat.completions.create({
            model: 'gpt-3.5-turbo',
            messages: [{ role: 'user', content: prompt }],
          });
          const replyText = response.choices[0]?.message?.content || 'Sorry, I couldn’t generate a response.';
          await bot.sendMessage(chatId, replyText);
          console.log(`Reply sent: ${replyText}`);
        } catch (error) {
          console.error(`Error generating reply for agent ${agent.agentId}:`, error);
          await bot.sendMessage(chatId, 'Oops, something went wrong while generating a reply.');
        }

        await saveTelegramReply(agent.agentId, msg.message_id, db);
        await incrementAgentTelegramReplyCount(agent.agentId, db);
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
    return agents;
  } catch (error) {
    console.error('Error fetching active Telegram agents:', error);
    return [];
  }
}

export async function hasRepliedToTelegramMessage(agentId: string, messageId: number, db: any): Promise<boolean> {
  try {
    const reply = await db.collection('telegramReplies').findOne({ agentId, messageId });
    return !!reply;
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
        return true;
      }
    }

    const replyCount = limitDoc?.telegramReplyCount || 0;
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