import { TwitterApi, TwitterApiTokens, TweetStream } from "twitter-api-v2";
import OpenAI from "openai";
import { hasValidTwitterCredentials } from "../utils/twitterUtils";
import { Agent } from "../types/agent";
import { twitterStreams, postingIntervals } from "../controllers/agentController";
import { TWITTER_API_MODE } from "../config";

// Cache for paid approach (streaming client)
let cachedStreamClient: TwitterApi | null = null;

async function getStreamClient(appKey: string, appSecret: string): Promise<TwitterApi> {
  if (cachedStreamClient) {
    console.log("Using cached Twitter stream client");
    return cachedStreamClient;
  }

  const client = new TwitterApi({
    appKey,
    appSecret,
  });

  try {
    cachedStreamClient = await client.appLogin();
    console.log("Twitter stream client authenticated successfully");
    return cachedStreamClient;
  } catch (error) {
    console.error("Failed to authenticate Twitter stream client:", error);
    throw error;
  }
}

// Paid approach: Real-time streaming with v2/searchStream
async function setupTwitterStreamListener(agent: Agent) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup Twitter stream listener for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  let streamClient: TwitterApi;
  try {
    streamClient = await getStreamClient(agent.twitterAppKey!, agent.twitterAppSecret!);
  } catch (error) {
    console.log(`Cannot setup Twitter stream listener for agent ${agent.agentId}: Failed to authenticate stream client`);
    return;
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };
  const postClient = new TwitterApi(twitterTokens);

  const openai = new OpenAI({ apiKey: agent.openaiApiKey });

  try {
    const currentRules = await streamClient.v2.streamRules();
    if (currentRules.data && currentRules.data.length > 0) {
      await streamClient.v2.updateStreamRules({
        delete: { ids: currentRules.data.map(rule => rule.id) }
      });
    }

    await streamClient.v2.updateStreamRules({
      add: [{ value: `@${agent.twitterHandle}`, tag: agent.agentId }],
    });

    const stream = await streamClient.v2.searchStream({
      "tweet.fields": ["author_id", "text", "in_reply_to_user_id"],
    });

    twitterStreams.set(agent.agentId, stream);

    stream.on('data', async (tweet) => {
      try {
        if (tweet.data.text.includes(`@${agent.twitterHandle}`)) {
          const response = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: tweet.data.text }],
          });
          const replyText = `@${tweet.author_id} ${response.choices[0].message.content}`.slice(0, 280);
          await postClient.v2.tweet({ text: replyText }); // Use v2 for replies
          console.log(`Agent ${agent.agentId} replied to tweet: ${replyText}`);
        }
      } catch (error) {
        console.error(`Error processing tweet for agent ${agent.agentId}:`, error);
      }
    });

    stream.on('error', (error) => {
      console.error(`Twitter stream error for agent ${agent.agentId}:`, error);
    });

    stream.autoReconnect = true;
    console.log(`Twitter stream listener started for agent ${agent.agentId}`);
  } catch (error) {
    console.error(`Failed to setup Twitter stream listener for agent ${agent.agentId}:`, error);
    throw error;
  }
}

// Free approach: No polling, just log limitation
async function setupTwitterPollListener(agent: Agent) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup Twitter poll listener for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }
  console.log(`Twitter poll listener not supported in Free tier for agent ${agent.agentId}. Upgrade to Basic tier for mention replies.`);
}

// Unified setup function based on TWITTER_API_MODE
export async function setupTwitterListener(agent: Agent) {
  if (TWITTER_API_MODE === "paid") {
    await setupTwitterStreamListener(agent);
  } else {
    await setupTwitterPollListener(agent);
  }
}

export async function setupTwitterListeners(db: any) {
  try {
    const agents = await db.collection("agents").find({
      isActive: true,
      "settings.platforms": "twitter",
      twitterHandle: { $exists: true, $ne: "" },
      twitterAppKey: { $exists: true, $ne: "" },
      twitterAppSecret: { $exists: true, $ne: "" },
      twitterAccessToken: { $exists: true, $ne: "" },
      twitterAccessSecret: { $exists: true, $ne: "" },
      openaiApiKey: { $exists: true, $ne: "" }
    }).toArray();

    for (const agent of agents) {
      if (hasValidTwitterCredentials(agent)) {
        await setupTwitterListener(agent);
        if (agent.enablePostTweet === true && agent.agentType === "basic") {
          startPostingInterval(agent);
        }
      } else {
        console.log(`Skipping Twitter features for agent ${agent.agentId}: Missing or invalid Twitter credentials`);
      }
    }
  } catch (error) {
    console.error("Error setting up Twitter listeners:", error);
  }
}

// Stop functions for both approaches
export async function stopTwitterListener(agentId: string) {
  if (TWITTER_API_MODE === "paid") {
    try {
      const stream = twitterStreams.get(agentId);
      if (stream) {
        stream.destroy();
        twitterStreams.delete(agentId);
        console.log(`Twitter stream listener stopped for agent ${agentId}`);
      }
    } catch (error) {
      console.error(`Error stopping Twitter stream listener for agent ${agentId}:`, error);
    }
  } else {
    console.log(`No Twitter poll listener to stop for agent ${agentId} in Free tier`);
  }
}

export function stopPostingInterval(agentId: string) {
  try {
    const interval = postingIntervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      postingIntervals.delete(agentId);
      console.log(`Posting interval stopped for agent ${agentId}`);
    }
  } catch (error) {
    console.error(`Error stopping posting interval for agent ${agentId}:`, error);
  }
}

export async function postRandomTweet(agent: Agent) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot post tweet for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };

  const twitterClient = new TwitterApi(twitterTokens);

  const randomMessages = [
    `Hello from ${agent.name}! Just a basic agent checking in.`,
    `${agent.name} here: What's happening on X today?`,
    `Agent ${agent.name} says: ${agent.personality.catchphrase}`,
  ];
  const randomMessage = randomMessages[Math.floor(Math.random() * randomMessages.length)];

  try {
    await twitterClient.v2.tweet({ text: randomMessage });
    console.log(`Agent ${agent.agentId} posted: ${randomMessage}`);
  } catch (error) {
    console.error(`Failed to post tweet for agent ${agent.agentId}:`, error);
    throw error;
  }
}

// Manual posting function
export async function postTweet(agent: Agent, message?: string) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot post tweet for agent ${agent.agentId}: Invalid Twitter credentials`);
    throw new Error("Invalid Twitter credentials");
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };

  const twitterClient = new TwitterApi(twitterTokens);

  const tweetMessage = message || `Manual tweet from ${agent.name} at ${new Date().toISOString()}`;

  try {
    await twitterClient.v2.tweet({ text: tweetMessage });
    console.log(`Agent ${agent.agentId} manually posted: ${tweetMessage}`);
    return tweetMessage;
  } catch (error) {
    console.error(`Failed to manually post tweet for agent ${agent.agentId}:`, error);
    throw error;
  }
}

export function startPostingInterval(agent: Agent) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot start posting interval for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  try {
    stopPostingInterval(agent.agentId);
    const intervalSeconds = agent.postTweetInterval ?? 3600;
    const interval = setInterval(() => postRandomTweet(agent), intervalSeconds * 1000);
    postingIntervals.set(agent.agentId, interval);
    console.log(`Started posting interval for agent ${agent.agentId} every ${intervalSeconds} seconds`);
  } catch (error) {
    console.error(`Error starting posting interval for agent ${agent.agentId}:`, error);
  }
}