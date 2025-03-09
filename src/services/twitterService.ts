import { TwitterApi, TwitterApiTokens, TweetStream } from "twitter-api-v2";
import OpenAI from "openai";
import { hasValidTwitterCredentials } from "../utils/twitterUtils";
import { Agent } from "../types/agent";
import { twitterStreams, postingIntervals } from "../controllers/agentController";
import { TWITTER_API_MODE } from "../config";
import { AgentPromptGenerator } from "../agentPromptGenerator";

async function setupTwitterPollListenerFree(agent: Agent) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup Twitter poll listener for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }
  console.log(`Twitter mention replies not supported in Free tier for agent ${agent.agentId}. Posting only enabled. Upgrade to Basic tier for replies.`);
}

async function setupTwitterPollListenerPaid(agent: Agent) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup Twitter poll listener for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };
  const client = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });

  let sinceId: string | undefined;

  const pollForMentions = async () => {
    try {
      const query = `@${agent.twitterHandle} -from:${agent.twitterHandle}`;
      const response = await client.v2.search({
        query,
        "tweet.fields": ["author_id", "text", "created_at"],
        since_id: sinceId,
        max_results: 10,
      });

      const tweets = response.data.data || [];
      if (tweets.length > 0) {
        sinceId = tweets[0].id;
        for (const tweet of tweets) {
          const aiResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: tweet.text }],
          });
          const replyText = `@${tweet.author_id} ${aiResponse.choices[0].message.content}`.slice(0, 280);
          await client.v2.tweet({ text: replyText });
          console.log(`Agent ${agent.agentId} replied to tweet ${tweet.id}: ${replyText}`);
        }
      }
    } catch (error) {
      console.error(`Error polling mentions for agent ${agent.agentId}:`, error);
    }
  };

  stopTwitterPollListener(agent.agentId);
  const interval = setInterval(pollForMentions, 8 * 60 * 1000); // 8 minutes
  pollingIntervals.set(agent.agentId, interval);
  console.log(`Twitter poll listener (paid) started for agent ${agent.agentId} every 8 minutes`);
}

export async function setupTwitterListener(agent: Agent) {
  if (TWITTER_API_MODE === "paid") {
    await setupTwitterPollListenerPaid(agent);
  } else {
    await setupTwitterPollListenerFree(agent);
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

export async function stopTwitterListener(agentId: string) {
  if (TWITTER_API_MODE === "paid") {
    stopTwitterPollListener(agentId);
  } else {
    console.log(`No Twitter poll listener to stop for agent ${agentId} in Free tier`);
  }
}

const pollingIntervals = new Map<string, NodeJS.Timeout>();

function stopTwitterPollListener(agentId: string) {
  try {
    const interval = pollingIntervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      pollingIntervals.delete(agentId);
      console.log(`Twitter poll listener stopped for agent ${agentId}`);
    }
  } catch (error) {
    console.error(`Error stopping Twitter poll listener for agent ${agentId}:`, error);
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
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });
  const promptGenerator = new AgentPromptGenerator(agent);

  const timestamp = new Date().toISOString();
  const userMessage = `Generate a short, unique tweet for me to post on Twitter right now at ${timestamp}. Keep it under 280 characters and reflect my personality.`;
  const prompt = promptGenerator.generatePrompt(userMessage);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });

    // Check if response is valid before accessing content
    let tweetText = `Tweet from ${agent.name} at ${timestamp}`; // Fallback
    if (response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) {
      tweetText = response.choices[0].message.content.slice(0, 280);
    } else {
      console.warn(`OpenAI response missing content for agent ${agent.agentId}, using fallback`);
    }

    await twitterClient.v2.tweet({ text: tweetText });
    console.log(`Agent ${agent.agentId} posted: ${tweetText}`);
  } catch (error) {
    console.error(`Failed to post tweet for agent ${agent.agentId}:`, error);
    throw error;
  }
}

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