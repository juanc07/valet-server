import { Request, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { connectToDatabase } from '../services/dbService';
import { verifyTokenPayment } from '../services/solanaService';
import { setupTwitterListener, startPostingInterval, stopPostingInterval, stopTwitterListener } from '../services/twitterService';
import { setupTelegramListener, stopTelegramListener } from '../services/telegramService';
import { hasValidTwitterCredentials } from '../utils/twitterUtils';
import { Agent } from '../types/agent';
import { User } from '../types/user';
import { TweetStream } from 'twitter-api-v2';
import { AGENT_REPLY_LIMIT, AGENT_REPLY_COOLDOWN_HOURS, MAX_POSTS_PER_DAY, MAX_REPLIES_PER_DAY, TWITTER_INTEGRATION } from '../config';
import { runTwitterServiceTests } from '../services/twitterServiceTest';
import { runTwitterServiceApiTests } from '../services/twitterServiceApiTest';
import TelegramBot from 'node-telegram-bot-api';

interface AgentParams {
  agentId: string;
}

interface UserParams {
  userId: string;
}

interface TweetReply {
  agentId: string;
  tweetId: string;
  targetAgentId?: string;
  authorUsername?: string;
  repliedAt: Date;
}

// too strict one day to become stale data
//const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

// 6 months before become stale data
const CACHE_TTL_MS = 6 * 30 * 24 * 60 * 60 * 1000;

const maxPostPerDay = parseInt(MAX_POSTS_PER_DAY || '10', 10);
const maxTweetReplyPerDay = parseInt(MAX_REPLIES_PER_DAY || '12', 10);

interface AgentDailyLimit {
  agentId: string;
  postCount: number;
  replyCount: number;
  telegramReplyCount?: number;
  lastPostLimitHit?: Date;
  lastReplyLimitHit?: Date;
  lastTelegramReplyLimitHit?: Date;
}

export const saveUsernameToCache = async (userId: string, username: string, db: any): Promise<void> => {
  try {
    const now = Date.now();
    await db.collection('usernameCache').updateOne(
      { userId },
      { $set: { username, timestamp: now } },
      { upsert: true }
    );
    console.log(`Saved username ${username} for user ID ${userId} to MongoDB cache`);
  } catch (error) {
    console.error(`Error saving username for user ID ${userId} to cache:`, error);
  }
};

export const getUsernameFromCache = async (userId: string, db: any): Promise<string | null> => {
  try {
    const cached = await db.collection('usernameCache').findOne({ userId });
    const now = Date.now();
    if (cached && now - cached.timestamp < CACHE_TTL_MS) {
      console.log(`MongoDB cache hit for user ID ${userId}: ${cached.username}`);
      return cached.username;
    }
    return null;
  } catch (error) {
    console.error(`Error fetching username from cache for user ID ${userId}:`, error);
    return null;
  }
};

export const getAgentByTwitterHandle = async (twitterHandle: string, db: any): Promise<Agent | null> => {
  try {
    const normalizedHandle = twitterHandle.trim().toLowerCase();
    const agent = await db.collection('agents').findOne({
      twitterHandle: { $regex: new RegExp(`^${normalizedHandle}$`, 'i') }
    });
    console.log(`Agent lookup for ${twitterHandle}: ${agent ? 'Found' : 'Not found'}`);
    return agent;
  } catch (error) {
    console.error(`Error fetching agent by Twitter handle ${twitterHandle}:`, error);
    return null;
  }
};

export const getActiveTwitterAgents = async (db: any): Promise<Agent[]> => {
  try {
    if (TWITTER_INTEGRATION === 'advance') {
      const agents = await db.collection('agents').find({
        isActive: true,
        'settings.platforms': { $in: ['twitter'] },
        twitterHandle: { $exists: true, $ne: '' },
        twitterAppKey: { $exists: true, $ne: '' },
        twitterAppSecret: { $exists: true, $ne: '' },
        twitterAccessToken: { $exists: true, $ne: '' },
        twitterAccessSecret: { $exists: true, $ne: '' },
        openaiApiKey: { $exists: true, $ne: '' },
      }).toArray();
      console.log(`Found ${agents.length} active Twitter agents`);
      return agents;
    } else {
      const agents = await db.collection('agents').find({
        isActive: true,
        'settings.platforms': { $in: ['twitter'] },
        twitterHandle: { $exists: true, $ne: '' },
        twitterAccessToken: { $exists: true, $ne: '' },
        twitterAccessSecret: { $exists: true, $ne: '' },
        openaiApiKey: { $exists: true, $ne: '' },
      }).toArray();
      console.log(`Found ${agents.length} active Twitter agents`);
      return agents;
    }
  } catch (error) {
    console.error('Error fetching active Twitter agents:', error);
    return [];
  }
};

export const canPostTweetForAgent = async (agentId: string, db: any): Promise<boolean> => {
  try {
    const limitDoc: AgentDailyLimit | null = await db.collection('agentDailyLimits').findOne({ agentId });
    const now = new Date();

    if (limitDoc && limitDoc.lastPostLimitHit) {
      const timeSinceLimit = now.getTime() - new Date(limitDoc.lastPostLimitHit).getTime();
      if (timeSinceLimit >= 24 * 60 * 60 * 1000) {
        await db.collection('agentDailyLimits').updateOne(
          { agentId },
          { $set: { postCount: 0, lastPostLimitHit: null } },
          { upsert: true }
        );
        console.log(`Reset post count for agent ${agentId} after 24 hours`);
        return true;
      }
    }

    const postCount = limitDoc?.postCount || 0;
    const canPost = postCount < maxPostPerDay;
    console.log(`Agent ${agentId} post count: ${postCount}/${maxPostPerDay}, can post: ${canPost}`);
    return canPost;
  } catch (error) {
    console.error(`Error checking post limit for agent ${agentId}:`, error);
    return false;
  }
};

export const canReplyToMentionForAgent = async (agentId: string, db: any): Promise<boolean> => {
  try {
    const limitDoc: AgentDailyLimit | null = await db.collection('agentDailyLimits').findOne({ agentId });
    const now = new Date();

    if (limitDoc && limitDoc.lastReplyLimitHit) {
      const timeSinceLimit = now.getTime() - new Date(limitDoc.lastReplyLimitHit).getTime();
      if (timeSinceLimit >= 24 * 60 * 60 * 1000) {
        await db.collection('agentDailyLimits').updateOne(
          { agentId },
          { $set: { replyCount: 0, lastReplyLimitHit: null } },
          { upsert: true }
        );
        console.log(`Reset reply count for agent ${agentId} after 24 hours`);
        return true;
      }
    }

    const replyCount = limitDoc?.replyCount || 0;
    const canReply = replyCount < maxTweetReplyPerDay;
    console.log(`Agent ${agentId} reply count: ${replyCount}/${maxTweetReplyPerDay}, can reply: ${canReply}`);
    return canReply;
  } catch (error) {
    console.error(`Error checking reply limit for agent ${agentId}:`, error);
    return false;
  }
};

export const incrementAgentPostCount = async (agentId: string, db: any): Promise<void> => {
  try {
    const limitDoc: AgentDailyLimit | null = await db.collection('agentDailyLimits').findOne({ agentId });
    const postCount = (limitDoc?.postCount || 0) + 1;
    const update: any = { $set: { postCount } };

    if (postCount === maxPostPerDay) {
      update.$set.lastPostLimitHit = new Date();
      console.log(`Agent ${agentId} hit post limit (${maxPostPerDay}); setting timestamp`);
    }

    if (!limitDoc || !limitDoc.replyCount) update.$set.replyCount = limitDoc?.replyCount || 0;
    if (limitDoc?.telegramReplyCount) update.$set.telegramReplyCount = limitDoc.telegramReplyCount;
    if (limitDoc?.lastReplyLimitHit) update.$set.lastReplyLimitHit = limitDoc.lastReplyLimitHit;
    if (limitDoc?.lastTelegramReplyLimitHit) update.$set.lastTelegramReplyLimitHit = limitDoc.lastTelegramReplyLimitHit;

    await db.collection('agentDailyLimits').updateOne(
      { agentId },
      update,
      { upsert: true }
    );
    console.log(`Incremented post count for agent ${agentId} to ${postCount}`);
  } catch (error) {
    console.error(`Error incrementing post count for agent ${agentId}:`, error);
  }
};

export const incrementAgentReplyCount = async (agentId: string, db: any): Promise<void> => {
  try {
    const limitDoc: AgentDailyLimit | null = await db.collection('agentDailyLimits').findOne({ agentId });
    const replyCount = (limitDoc?.replyCount || 0) + 1;
    const update: any = { $set: { replyCount } };

    if (replyCount === maxTweetReplyPerDay) {
      update.$set.lastReplyLimitHit = new Date();
      console.log(`Agent ${agentId} hit reply limit (${maxTweetReplyPerDay}); setting timestamp`);
    }

    if (!limitDoc || !limitDoc.postCount) update.$set.postCount = limitDoc?.postCount || 0;
    if (limitDoc?.telegramReplyCount) update.$set.telegramReplyCount = limitDoc.telegramReplyCount;
    if (limitDoc?.lastPostLimitHit) update.$set.lastPostLimitHit = limitDoc.lastPostLimitHit;
    if (limitDoc?.lastTelegramReplyLimitHit) update.$set.lastTelegramReplyLimitHit = limitDoc.lastTelegramReplyLimitHit;

    await db.collection('agentDailyLimits').updateOne(
      { agentId },
      update,
      { upsert: true }
    );
    console.log(`Incremented reply count for agent ${agentId} to ${replyCount}`);
  } catch (error) {
    console.error(`Error incrementing reply count for agent ${agentId}:`, error);
  }
};

export const createAgent = async (req: Request, res: Response) => {
  console.log('1st createAgent');
  try {
    const db = await connectToDatabase();
    const { txSignature, ...agentData }: { txSignature: string } & Omit<Agent, 'agentId' | 'isActive'> = req.body;
    const agent: Omit<Agent, 'agentId' | 'isActive'> = agentData;

    console.log('txSignature: ', txSignature);
    console.log('agent: ', agent);

    const requiredFields = [
      { key: 'name', type: 'string' as const },
      { key: 'description', type: 'string' as const },
      { key: 'bio', type: 'string' as const },
      { key: 'mission', type: 'string' as const },
      { key: 'vision', type: 'string' as const },
      { key: 'createdBy', type: 'string' as const },
      { key: 'personality.tone', type: 'string' as const },
      { key: 'personality.humor', type: 'boolean' as const },
      { key: 'personality.formality', type: 'string' as const },
      { key: 'personality.catchphrase', type: 'string' as const },
      { key: 'agentType', type: 'string' as const },
    ];

    const missingFields: string[] = [];
    const invalidFields: string[] = [];

    for (const field of requiredFields) {
      const [parent, child] = field.key.split('.');
      let value: any;

      if (child) {
        value = (agent as any)[parent]?.[child];
      } else {
        value = (agent as any)[field.key];
      }

      if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
        missingFields.push(field.key);
      } else if (typeof value !== field.type) {
        invalidFields.push(`${field.key} must be a ${field.type}`);
      }
    }

    if (agent.agentType && !['basic', 'puppetos', 'thirdparty'].includes(agent.agentType)) {
      invalidFields.push("agentType must be 'basic', 'puppetos', or 'thirdparty'");
    }

    if (!txSignature || typeof txSignature !== 'string' || txSignature.trim() === '') {
      missingFields.push('txSignature');
    }

    if (missingFields.length > 0 || invalidFields.length > 0) {
      const errorMessage = [
        missingFields.length > 0 ? `Missing required fields: ${missingFields.join(', ')}` : '',
        invalidFields.length > 0 ? `Invalid fields: ${invalidFields.join(', ')}` : '',
      ]
        .filter(Boolean)
        .join('; ');
      res.status(400).json({ error: errorMessage });
      return;
    }

    const user = (await db.collection('users').findOne({ userId: agent.createdBy })) as User | null;
    if (!user || !user.solanaWalletAddress) {
      res.status(400).json({ error: 'User not found or no Solana wallet address associated' });
      return;
    }

    const paymentValid = await verifyTokenPayment(txSignature, user.solanaWalletAddress);
    if (!paymentValid) {
      res.status(400).json({ error: 'Transaction does not contain valid transfer of 1000 tokens' });
      return;
    }

    const generatedId = uuidv4();
    const newAgent: Agent = {
      ...agent,
      agentId: generatedId,
      isActive: true,
      isTwitterPaid: agent.isTwitterPaid ?? false,
    };

    const result = await db.collection('agents').insertOne(newAgent);

    const hasTwitterPlatform = Array.isArray(newAgent.settings?.platforms) && newAgent.settings.platforms.includes('twitter');
    const hasTelegramPlatform = Array.isArray(newAgent.settings?.platforms) && newAgent.settings.platforms.includes('telegram');

    if (newAgent.isActive) {
      if (hasTwitterPlatform) {
        if (newAgent.isTwitterPaid && !hasValidTwitterCredentials(newAgent)) {
          console.warn(`Agent ${newAgent.agentId} marked as Twitter paid but lacks valid credentials. Falling back to free mode.`);
        }
        await canPostTweetForAgent(newAgent.agentId, db);
        await canReplyToMentionForAgent(newAgent.agentId, db);
        await setupTwitterListener(newAgent, db);
        if (newAgent.enablePostTweet === true && newAgent.agentType === 'basic') {
          startPostingInterval(newAgent, db);
        }
      }
      if (hasTelegramPlatform && newAgent.telegramBotToken) {
        await setupTelegramListener(newAgent);
      }
    } else {
      console.log(`Skipping Twitter and Telegram features for agent ${newAgent.agentId}: Agent inactive`);
    }

    res.status(201).json({ _id: result.insertedId, ...newAgent });
  } catch (error) {
    console.error('Error creating agent:', error);
    res.status(500).json({ error: 'Failed to create agent' });
  }
};

export const getAllAgents = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agents = await db.collection('agents').find().toArray();
    res.status(200).json(agents);
  } catch (error) {
    console.error('Error fetching all agents:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
};

export const getActiveAgents = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agents = await db.collection('agents').find({ isActive: true }).toArray();
    res.status(200).json(agents);
  } catch (error) {
    console.error('Error fetching active agents:', error);
    res.status(500).json({ error: 'Failed to fetch active agents' });
  }
};

export const getAgentsByUserId = async (req: Request<UserParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const isActive = req.query.isActive ? req.query.isActive === 'true' : undefined;

    console.log(`Fetching agents for userId: ${userId}, isActive: ${isActive}`);

    const query: any = { createdBy: userId };
    if (isActive !== undefined) {
      query.isActive = isActive;
    }

    const agents = await db.collection('agents').find(query).toArray();

    console.log(`Found ${agents.length} agents for userId ${userId}`);
    res.status(200).json(agents);
  } catch (error) {
    console.error('Error fetching agents by userId:', error);
    res.status(500).json({ error: 'Failed to fetch agents' });
  }
};

export const getActiveAgentCount = async (req: Request<UserParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const userId = req.params.userId;
    const isActive = req.query.isActive === 'true';

    console.log(`Fetching active agent count for userId: ${userId}, isActive: ${isActive}`);

    const count = await db.collection('agents').countDocuments({
      createdBy: userId,
      isActive: isActive,
    });

    console.log(`Active agent count for userId ${userId}: ${count}`);
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error fetching active agent count:', error);
    res.status(500).json({ error: 'Failed to fetch active agent count' });
  }
};

export const updateAgent = async (req: Request<AgentParams>, res: Response) => {
  console.log('1st updateAgent');
  try {
    const db = await connectToDatabase();
    const agentId: string = req.params.agentId;
    const updatedAgent: Partial<Agent> & { _id?: string } = req.body;
    console.log('Update payload:', updatedAgent);

    const currentAgent = (await db.collection('agents').findOne({ agentId })) as Agent | null;
    if (!currentAgent) {
      console.log('2nd updateAgent agent not found');
      res.status(404).json({ error: 'Agent not found' });
      return;
    }
    console.log('Current agent:', currentAgent);

    const { _id, ...updateData } = updatedAgent;

    const result = await db.collection('agents').updateOne(
      { agentId: agentId },
      { $set: updateData }
    );

    if (result.matchedCount === 0) {
      console.log('3rd updateAgent agent not found');
      res.status(404).json({ error: 'Agent not found' });
      return;
    }

    const newAgentData = (await db.collection('agents').findOne({ agentId })) as Agent | null;
    if (!newAgentData) {
      console.log('4th updateAgent Failed to retrieve updated agent');
      res.status(500).json({ error: 'Failed to retrieve updated agent' });
      return;
    }
    console.log('Updated agent:', newAgentData);

    const wasActive = currentAgent.isActive ?? false;
    const isActiveNow = newAgentData.isActive ?? wasActive;
    const hadCredentials = hasValidTwitterCredentials(currentAgent);
    const hasCredentialsNow = hasValidTwitterCredentials(newAgentData);
    const wasPostingEnabled = currentAgent.enablePostTweet ?? false;
    const isPostingEnabledNow = newAgentData.enablePostTweet ?? wasPostingEnabled;
    const wasBasic = currentAgent.agentType === 'basic';
    const isBasicNow = newAgentData.agentType === 'basic';
    const hadTwitterPlatform = Array.isArray(currentAgent.settings?.platforms) && currentAgent.settings.platforms.includes('twitter');
    const hasTwitterPlatformNow = Array.isArray(newAgentData.settings?.platforms) && newAgentData.settings.platforms.includes('twitter');
    const hadTelegramPlatform = Array.isArray(currentAgent.settings?.platforms) && currentAgent.settings.platforms.includes('telegram');
    const hasTelegramPlatformNow = Array.isArray(newAgentData.settings?.platforms) && newAgentData.settings.platforms.includes('telegram');
    const wasTwitterPaid = currentAgent.isTwitterPaid ?? false;
    const isTwitterPaidNow = newAgentData.isTwitterPaid ?? wasTwitterPaid;

    console.log('State check:', {
      wasActive,
      isActiveNow,
      hadCredentials,
      hasCredentialsNow,
      wasPostingEnabled,
      isPostingEnabledNow,
      wasBasic,
      isBasicNow,
      hadTwitterPlatform,
      hasTwitterPlatformNow,
      hadTelegramPlatform,
      hasTelegramPlatformNow,
      wasTwitterPaid,
      isTwitterPaidNow,
    });

    if (hadTwitterPlatform && (!hasTwitterPlatformNow || !isActiveNow)) {
      await stopTwitterListener(agentId);
      stopPostingInterval(agentId);
    } else if (hasTwitterPlatformNow && isActiveNow) {
      if (wasTwitterPaid && !isTwitterPaidNow && !hasCredentialsNow) {
        console.warn(`Agent ${agentId} marked as Twitter paid but lacks valid credentials. Falling back to free mode.`);
      }
      await canPostTweetForAgent(agentId, db);
      await canReplyToMentionForAgent(agentId, db);
      try {
        await setupTwitterListener(newAgentData, db);
      } catch (twitterError) {
        console.error('Failed to setup Twitter listener in updateAgent:', twitterError);
      }
      if (isPostingEnabledNow && isBasicNow && hasCredentialsNow && (!wasPostingEnabled || !hadTwitterPlatform)) {
        console.log('Starting posting interval for agent after update');
        startPostingInterval(newAgentData, db);
      }
    }

    if (hadTelegramPlatform && (!hasTelegramPlatformNow || !isActiveNow)) {
      stopTelegramListener(agentId);
      console.log(`Stopped Telegram listener for agent ${agentId} due to deactivation or platform removal`);
    }
    if (hasTelegramPlatformNow && newAgentData.telegramBotToken) {
      if (isActiveNow) {
        if (!wasActive || !hadTelegramPlatform) {
          await setupTelegramListener(newAgentData);
          console.log(`Started Telegram listener for agent ${agentId} due to activation`);
        } else {
          console.log(`Telegram listener already active for agent ${agentId}, no restart needed`);
        }
      } else {
        stopTelegramListener(agentId);
        console.log(`Ensured Telegram listener stopped for agent ${agentId} due to deactivation`);
      }
    }

    res.status(200).json({ message: 'Agent updated' });
  } catch (error) {
    console.error('Error updating agent:', error);
    res.status(500).json({ error: 'Failed to update agent' });
  }
};

export const deleteAgent = async (req: Request<AgentParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;

    await stopTwitterListener(agentId);
    stopPostingInterval(agentId);
    stopTelegramListener(agentId);

    const result = await db.collection('agents').deleteOne({ agentId: agentId });
    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Agent not found' });
    } else {
      res.status(200).json({ message: 'Agent deleted' });
    }
  } catch (error) {
    console.error('Error deleting agent:', error);
    res.status(500).json({ error: 'Failed to delete agent' });
  }
};

export const deleteAllAgents = async (req: Request, res: Response) => {
  try {
    const db = await connectToDatabase();

    for (const agentId of twitterStreams.keys()) {
      await stopTwitterListener(agentId);
    }
    for (const agentId of postingIntervals.keys()) {
      stopPostingInterval(agentId);
    }
    for (const agentId of telegramBots.keys()) {
      stopTelegramListener(agentId);
    }

    await db.collection('agents').deleteMany({});
    res.status(200).json({ message: 'All agents deleted' });
  } catch (error) {
    console.error('Error deleting all agents:', error);
    res.status(500).json({ error: 'Failed to delete all agents' });
  }
};

export const getAgentById = async (req: Request<AgentParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;
    const agent = await db.collection('agents').findOne({ agentId: agentId });
    if (!agent) {
      res.status(404).json({ error: 'Agent not found' });
    } else {
      res.status(200).json(agent);
    }
  } catch (error) {
    console.error('Error fetching agent by ID:', error);
    res.status(500).json({ error: 'Failed to fetch agent' });
  }
};

export const saveTweetReply = async (agentId: string, tweetId: string, db: any, targetAgentId?: string, authorUsername?: string): Promise<void> => {
  const tweetReply: TweetReply = {
    agentId,
    tweetId,
    targetAgentId,
    authorUsername,
    repliedAt: new Date(),
  };
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await db.collection('tweetReplies').updateOne(
        { agentId, tweetId },
        { $set: tweetReply },
        { upsert: true }
      );
      console.log(`Saved tweet reply for agent ${agentId}, tweet ${tweetId}. Attempt ${attempt}, Upserted: ${result.upsertedCount > 0}`);
      await incrementAgentReplyCount(agentId, db);
      return;
    } catch (error) {
      console.error(`Attempt ${attempt} failed to save tweet reply for agent ${agentId}, tweet ${tweetId}:`, error);
      if (attempt === 3) throw new Error(`Failed to save tweet reply after 3 attempts: ${error instanceof Error ? error.message : 'Unknown error'}`);
      await new Promise(resolve => setTimeout(resolve, 1000 * attempt));
    }
  }
};

export const hasRepliedToTweet = async (agentId: string, tweetId: string, db: any, authorUsername?: string): Promise<boolean> => {
  try {
    const reply = await db.collection('tweetReplies').findOne({ agentId, tweetId });
    if (reply) {
      console.log(`Tweet ${tweetId} already replied by agent ${agentId}`);
      return true;
    }

    const coolDownHour = parseInt(AGENT_REPLY_COOLDOWN_HOURS || '2', 10);
    const replyLimitCount = parseInt(AGENT_REPLY_LIMIT || '3', 10);

    const recentReplies = await db.collection('tweetReplies').find({
      agentId,
      repliedAt: { $gt: new Date(Date.now() - coolDownHour * 60 * 60 * 1000) }
    }).sort({ repliedAt: -1 }).limit(replyLimitCount).toArray();

    if (recentReplies.length >= replyLimitCount) {
      console.log(`Agent ${agentId} hit general reply limit (${replyLimitCount}) in last ${coolDownHour} hours`);
      return true;
    }

    if (authorUsername) {
      const targetAgent = await getAgentByTwitterHandle(authorUsername, db);
      if (targetAgent) {
        const targetAgentId = targetAgent.agentId;
        const agentReplies = await db.collection('tweetReplies').find({
          agentId,
          targetAgentId,
          repliedAt: { $gt: new Date(Date.now() - coolDownHour * 60 * 60 * 1000) }
        }).sort({ repliedAt: -1 }).limit(replyLimitCount).toArray();

        if (agentReplies.length >= replyLimitCount) {
          console.log(`Agent ${agentId} has replied to ${targetAgentId} ${replyLimitCount} times in last ${coolDownHour} hours`);
          return true;
        }
      }
    }
    return false;
  } catch (error) {
    console.error(`Error checking tweet reply for agent ${agentId}, tweet ${tweetId}:`, error);
    return true; // Fail-safe
  }
};

export const testTwitterService = async (req: Request, res: Response) => {
  console.log('Running Twitter Service Tests...');
  try {
    await runTwitterServiceTests();
    res.status(200).json({ message: 'Twitter Service Tests Completed. Check server logs for results.' });
  } catch (error) {
    console.error('Error running Twitter Service Tests:', error);
    res.status(500).json({ error: 'Failed to run Twitter Service Tests. Check server logs for details.' });
  }
};

export const testTwitterApiService = async (req: Request, res: Response) => {
  console.log('Running Twitter Service actual api Tests...');
  try {
    await runTwitterServiceApiTests();
    res.status(200).json({ message: 'Twitter Service actual api Tests Completed. Check server logs for results.' });
  } catch (error) {
    console.error('Error running Twitter Service Tests:', error);
    res.status(500).json({ error: 'Failed to run Twitter Service actual api Tests. Check server logs for details.' });
  }
};

export const twitterStreams = new Map<string, TweetStream>();
export const postingIntervals = new Map<string, NodeJS.Timeout>();
export const telegramBots = new Map<string, TelegramBot>();