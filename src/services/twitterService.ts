import { TwitterApi, TwitterApiTokens, TweetStream } from "twitter-api-v2";
import OpenAI from "openai";
import { hasValidTwitterCredentials } from "../utils/twitterUtils";
import { Agent } from "../types/agent";
import { 
  twitterStreams, 
  postingIntervals, 
  saveTweetReply, 
  hasRepliedToTweet, 
  saveUsernameToCache, 
  getUsernameFromCache, 
  getAgentByTwitterHandle, 
  getActiveTwitterAgents, 
  canPostTweetForAgent, 
  canReplyToMentionForAgent, 
  incrementAgentPostCount, 
  incrementAgentReplyCount 
} from "../controllers/agentController";
import { 
  TWITTER_API_MODE, 
  TWITTER_APP_KEY, 
  TWITTER_APP_SECRET, 
  TWITTER_BEARER_TOKEN, 
  MENTION_POLL_MIN_MINUTES, 
  MENTION_POLL_MAX_MINUTES, 
  TWITTER_MENTION_CHECK_ENABLED, 
  TWITTER_AUTO_POSTING_ENABLED 
} from "../config";
import { AgentPromptGenerator } from "../agentPromptGenerator";

// Helper to fetch Twitter user ID from handle
async function getTwitterUserId(handle: string, client: TwitterApi): Promise<string | undefined> {
  try {
    console.log(`Attempting to fetch user ID for handle ${handle}`);
    const response = await client.v2.userByUsername(handle.replace('@', ''), {
      "user.fields": ["id"],
    });
    console.log(`Fetched user ID for ${handle}: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    console.error(`Error fetching user ID for ${handle}:`, error);
    return undefined;
  }
}

// Helper to fetch username from user ID, using cache from agentController
async function getUsernameFromId(userId: string, client: TwitterApi, db: any): Promise<string> {
  try {
    console.log(`Looking up username for user ID ${userId}`);
    const cachedUsername = await getUsernameFromCache(userId, db);
    if (cachedUsername) {
      console.log(`Cache hit for user ID ${userId}: ${cachedUsername}`);
      return cachedUsername;
    }

    console.log(`Cache miss, fetching username from Twitter API for user ID ${userId}`);
    const response = await client.v2.user(userId, { "user.fields": ["username"] });
    const username = response.data.username;
    console.log(`Fetched username for ID ${userId}: ${username}`);

    console.log(`Saving username ${username} to cache for user ID ${userId}`);
    await saveUsernameToCache(userId, username, db);

    return username;
  } catch (error: any) {
    console.error(`Error fetching username for user ID ${userId}:`, error);
    if (error.code === 429) {
      console.log(`Rate limit hit for user ID ${userId}. Falling back to cache`);
      const cachedFallback = await getUsernameFromCache(userId, db);
      if (cachedFallback) {
        console.log(`Using cached username for ${userId}: ${cachedFallback}`);
        return cachedFallback;
      }
    }
    console.log(`No cache available, falling back to default 'friend' for user ID ${userId}`);
    return "friend";
  }
}

// Free tier: No streaming or polling for mentions, just posting
async function setupTwitterPollListenerFree(agent: Agent) {
  console.log(`Checking credentials for free tier setup for agent ${agent.agentId}`);
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup Twitter listener for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }
  console.log(`Twitter mention replies not supported in Free tier for agent ${agent.agentId}. Posting only enabled. Upgrade to Basic tier for replies.`);
}

// Paid tier (Basic): Real-time streaming with Filtered Stream for mentions using Bearer Token
async function setupTwitterStreamListenerPaid(agent: Agent, db: any) {
  console.log(`Setting up paid streaming for agent ${agent.agentId}`);
  if (!TWITTER_BEARER_TOKEN) {
    console.log(`Cannot setup Twitter stream listener for agent ${agent.agentId}: Missing TWITTER_BEARER_TOKEN in environment`);
    return false;
  }

  const twitterHandle = agent.twitterHandle;
  if (!twitterHandle) {
    console.log(`Cannot setup Twitter stream listener for agent ${agent.agentId}: Missing twitterHandle`);
    return false;
  }

  console.log(`Initializing Twitter stream setup for agent ${agent.agentId} with Bearer Token (first 10 chars): ${TWITTER_BEARER_TOKEN.slice(0, 10)}...`);
  const streamClient = new TwitterApi(TWITTER_BEARER_TOKEN);
  console.log(`Stream client initialized for agent ${agent.agentId}`);

  const twitterTokens: TwitterApiTokens = {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };
  const postClient = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });
  console.log(`Post client and OpenAI initialized for agent ${agent.agentId}`);

  stopTwitterStreamListener(agent.agentId);

  try {
    console.log(`Fetching current stream rules for agent ${agent.agentId}...`);
    const rules = await streamClient.v2.streamRules();
    console.log(`Stream rules fetched for agent ${agent.agentId}:`, rules.data || "No rules found");
    const existingRules = rules.data || [];
    const mentionRule = { value: `@${twitterHandle} -from:${twitterHandle}` };

    const ruleExists = existingRules.some((rule) => rule.value === mentionRule.value);
    if (!ruleExists) {
      console.log(`Adding new stream rule for agent ${agent.agentId}: ${mentionRule.value}`);
      const ruleResponse = await streamClient.v2.updateStreamRules({ add: [mentionRule] });
      console.log(`Stream rule added successfully for agent ${agent.agentId}:`, ruleResponse.data);
    } else {
      console.log(`Stream rule already exists for agent ${agent.agentId}: ${mentionRule.value}`);
    }

    let stream = twitterStreams.get(agent.agentId);
    if (!stream) {
      console.log(`Starting new Twitter stream for agent ${agent.agentId}...`);
      stream = await streamClient.v2.searchStream({
        "tweet.fields": ["author_id", "text", "created_at"],
        autoConnect: true,
      });
      twitterStreams.set(agent.agentId, stream);
      console.log(`Twitter stream successfully started for agent ${agent.agentId}`);

      stream.on("data", async (tweet) => {
        try {
          console.log(`Received tweet data for agent ${agent.agentId}:`, JSON.stringify(tweet, null, 2));
          const tweetData = tweet.data || tweet;
          if (!tweetData.author_id) {
            console.error(`No author_id found in tweet for agent ${agent.agentId}:`, tweetData);
            return;
          }

          const tweetId = tweetData.id;
          const authorUsername = await getUsernameFromId(tweetData.author_id, postClient, db);
          console.log(`Processing tweet ${tweetId}: author_id=${tweetData.author_id}, authorUsername=${authorUsername}`);

          if (!authorUsername || authorUsername === twitterHandle) {
            console.log(`Skipping self-mention or invalid author for agent ${agent.agentId}, tweet ID: ${tweetId}`);
            return;
          }

          const hasReplied = await hasRepliedToTweet(agent.agentId, tweetId, db, authorUsername);
          if (hasReplied) {
            console.log(`Skipping tweet ${tweetId} for agent ${agent.agentId}: Already replied or cooldown active`);
            return;
          }

          if (!(await canReplyToMentionForAgent(agent.agentId, db))) {
            console.log(`Skipping tweet ${tweetId} for agent ${agent.agentId}: Daily mention reply limit reached`);
            return;
          }

          console.log(`Generating prompt for reply to tweet ${tweetId} for agent ${agent.agentId}`);
          const promptGenerator = new AgentPromptGenerator(agent);
          const prompt = promptGenerator.generatePrompt(`Reply to this mention from @${authorUsername}: "${tweetData.text}"\nPersonalize your response by addressing @${authorUsername} directly.`);
          console.log(`Generated prompt for agent ${agent.agentId}: ${prompt}`);

          console.log(`Requesting AI response for agent ${agent.agentId}, tweet ${tweetId}`);
          const aiResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
          });
          console.log(`AI response received for agent ${agent.agentId}:`, aiResponse.choices[0]?.message?.content);

          let responseText = aiResponse.choices[0]?.message?.content || `Sorry, @${authorUsername}, I couldn't generate a response.`;
          responseText = responseText.replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
          responseText = responseText.replace(/#\w+/g, '');
          const replyText = `@${authorUsername} ${responseText}`.slice(0, 280);
          console.log(`Prepared reply text for tweet ${tweetId}: ${replyText}`);

          const normalizedUsername = authorUsername.trim().toLowerCase();
          console.log(`Checking if ${normalizedUsername} is an agent for tweet ${tweetId}`);
          const targetAgent = await getAgentByTwitterHandle(normalizedUsername, db);
          console.log(`Target agent lookup for ${normalizedUsername}:`, targetAgent);
          const targetAgentId = targetAgent ? targetAgent.agentId : undefined;

          console.log(`Posting reply to tweet ${tweetId} for agent ${agent.agentId}`);
          await postClient.v2.tweet({
            text: replyText,
            reply: { in_reply_to_tweet_id: tweetId },
          });
          console.log(`Agent ${agent.agentId} replied to tweet ${tweetId}: ${replyText}`);

          console.log(`Saving reply record for tweet ${tweetId} by agent ${agent.agentId}`);
          await saveTweetReply(agent.agentId, tweetId, db, targetAgentId, authorUsername);
        } catch (error) {
          console.error(`Error processing mention for agent ${agent.agentId}, tweet ID: ${(tweet.data || tweet).id || 'unknown'}:`, error);
        }
      });

      stream.on("error", (error) => {
        console.error(`Stream error for agent ${agent.agentId}:`, error);
        stopTwitterStreamListener(agent.agentId);
      });

      stream.on("end", () => {
        console.log(`Stream ended for agent ${agent.agentId}`);
        twitterStreams.delete(agent.agentId);
      });

      console.log(`Twitter stream listener fully operational for agent ${agent.agentId} (Paid mode)`);
    } else {
      console.log(`Reusing existing stream for agent ${agent.agentId}`);
    }
    return true;
  } catch (error) {
    console.error(`Detailed error setting up Twitter stream for agent ${agent.agentId}:`, error);
    stopTwitterStreamListener(agent.agentId);
    return false;
  }
}

// Fallback to User Mention Timeline polling with retry logic
async function setupTwitterMentionsListenerPaid(agent: Agent, db: any) {
  console.log(`Setting up paid mentions polling for agent ${agent.agentId}`);
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup Twitter mentions listener for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  const twitterHandle = agent.twitterHandle;
  if (!twitterHandle) {
    console.log(`Cannot setup Twitter mentions listener for agent ${agent.agentId}: Missing twitterHandle`);
    return;
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };
  const client = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });

  console.log(`Fetching Twitter user ID for handle ${twitterHandle} for agent ${agent.agentId}`);
  const twitterUserId = await getTwitterUserId(twitterHandle, client);
  if (!twitterUserId) {
    console.log(`Failed to fetch Twitter user ID for agent ${agent.agentId}`);
    return;
  }

  console.log(`Mentions listener initialized for agent ${agent.agentId} with user ID ${twitterUserId}`);
  let sinceId: string | undefined;

  const checkMentions = async (retries = 3, delayMs = 5000) => {
    try {
      console.log(`Polling mentions started at ${new Date().toISOString()} for agent ${agent.agentId} with user ID ${twitterUserId}`);
      const mentions = await client.v2.userMentionTimeline(twitterUserId, {
        "tweet.fields": ["author_id", "text", "created_at"],
        since_id: sinceId,
        max_results: 10,
      });

      const tweets = mentions.data.data || [];
      console.log(`Found ${tweets.length} new mentions for agent ${agent.agentId}`);

      if (tweets.length > 0) {
        sinceId = tweets[0].id;
        for (const tweet of tweets) {
          console.log(`Processing tweet for agent ${agent.agentId}:`, JSON.stringify(tweet, null, 2));
          if (!tweet.author_id) {
            console.error(`No author_id found in tweet for agent ${agent.agentId}:`, tweet);
            continue;
          }

          const tweetId = tweet.id;
          const authorUsername = await getUsernameFromId(tweet.author_id, client, db);
          console.log(`Processing tweet ${tweetId}: author_id=${tweet.author_id}, authorUsername=${authorUsername}`);

          if (!authorUsername || authorUsername === twitterHandle) {
            console.log(`Skipping self-mention or invalid author for tweet ${tweetId}`);
            continue;
          }

          const hasReplied = await hasRepliedToTweet(agent.agentId, tweetId, db, authorUsername);
          if (hasReplied) {
            console.log(`Skipping tweet ${tweetId} for agent ${agent.agentId}: Already replied or cooldown active`);
            continue;
          }

          if (!(await canReplyToMentionForAgent(agent.agentId, db))) {
            console.log(`Skipping tweet ${tweetId} for agent ${agent.agentId}: Daily mention reply limit reached`);
            continue;
          }

          console.log(`Generating prompt for reply to tweet ${tweetId} for agent ${agent.agentId}`);
          const promptGenerator = new AgentPromptGenerator(agent);
          const prompt = promptGenerator.generatePrompt(`Reply to this mention from @${authorUsername}: "${tweet.text}"\nPersonalize your response by addressing @${authorUsername} directly.`);
          console.log(`Generated prompt for tweet ${tweetId}: ${prompt}`);

          console.log(`Requesting AI response for tweet ${tweetId} for agent ${agent.agentId}`);
          const aiResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
          });
          console.log(`AI response for tweet ${tweetId}:`, aiResponse.choices[0]?.message?.content);

          let responseText = aiResponse.choices[0]?.message?.content || `Sorry, @${authorUsername}, I couldn't generate a response.`;
          responseText = responseText.replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
          responseText = responseText.replace(/#\w+/g, '');
          const replyText = `@${authorUsername} ${responseText}`.slice(0, 280);
          console.log(`Prepared reply text for tweet ${tweetId}: ${replyText}`);

          const normalizedUsername = authorUsername.trim().toLowerCase();
          console.log(`Checking if ${normalizedUsername} is an agent for tweet ${tweetId}`);
          const targetAgent = await getAgentByTwitterHandle(normalizedUsername, db);
          console.log(`Target agent lookup for ${normalizedUsername}:`, targetAgent);
          const targetAgentId = targetAgent ? targetAgent.agentId : undefined;

          console.log(`Posting reply to tweet ${tweetId} for agent ${agent.agentId}`);
          await client.v2.tweet({
            text: replyText,
            reply: { in_reply_to_tweet_id: tweetId },
          });
          console.log(`Agent ${agent.agentId} replied to tweet ${tweetId}: ${replyText}`);

          console.log(`Saving reply record for tweet ${tweetId} by agent ${agent.agentId}`);
          await saveTweetReply(agent.agentId, tweetId, db, targetAgentId, authorUsername);
        }
      }

      scheduleNextPoll();
    } catch (error: any) {
      if (error.code === 524 || error.code === 429) {
        if (retries > 0) {
          console.log(`Retrying polling for agent ${agent.agentId} after ${error.code} error. Retries left: ${retries}, Delay: ${delayMs}ms`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          return checkMentions(retries - 1, delayMs * 2);
        }
      }
      console.error(`Error polling mentions for agent ${agent.agentId}:`, error);
      scheduleNextPoll();
    }
  };

  const scheduleNextPoll = () => {
    const minMinutes = parseInt(MENTION_POLL_MIN_MINUTES || "5", 10);
    const maxMinutes = parseInt(MENTION_POLL_MAX_MINUTES || "10", 10);
    const randomMinutes = minMinutes + Math.random() * (maxMinutes - minMinutes);
    const intervalMs = randomMinutes * 60 * 1000;
    const interval = setTimeout(() => {
      console.log(`Scheduling next poll for agent ${agent.agentId} in ${randomMinutes.toFixed(2)} minutes`);
      checkMentions();
    }, intervalMs);
    pollingIntervals.set(agent.agentId, interval);
  };

  stopTwitterPollListener(agent.agentId);
  checkMentions();
  console.log(`Twitter mentions listener (paid) started for agent ${agent.agentId} with random polling between ${MENTION_POLL_MIN_MINUTES} and ${MENTION_POLL_MAX_MINUTES} minutes`);
}

// Fallback polling for paid tier if streaming isn’t desired or fails
async function setupTwitterPollListenerPaid(agent: Agent, db: any) {
  console.log(`Setting up paid polling for agent ${agent.agentId}`);
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup Twitter poll listener for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  const twitterHandle = agent.twitterHandle;
  if (!twitterHandle) {
    console.log(`Cannot setup Twitter poll listener for agent ${agent.agentId}: Missing twitterHandle`);
    return;
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };
  const client = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });
  console.log(`Poll listener initialized for agent ${agent.agentId}`);

  let sinceId: string | undefined;

  const pollForMentions = async (retries = 3, delayMs = 5000) => {
    try {
      console.log(`Polling mentions started at ${new Date().toISOString()} for agent ${agent.agentId}`);
      const query = `@${twitterHandle} -from:${twitterHandle}`;
      console.log(`Polling for mentions for agent ${agent.agentId} with query: ${query}`);
      const response = await client.v2.search({
        query,
        "tweet.fields": ["author_id", "text", "created_at"],
        since_id: sinceId,
        max_results: 10,
      });

      const tweets = response.data.data || [];
      console.log(`Poll returned ${tweets.length} tweets for agent ${agent.agentId}`);
      if (tweets.length > 0) {
        sinceId = tweets[0].id;
        for (const tweet of tweets) {
          console.log(`Processing tweet for agent ${agent.agentId}:`, JSON.stringify(tweet, null, 2));
          if (!tweet.author_id) {
            console.error(`No author_id found in tweet for agent ${agent.agentId}:`, tweet);
            continue;
          }

          const tweetId = tweet.id;
          const authorUsername = await getUsernameFromId(tweet.author_id, client, db);
          console.log(`Processing tweet ${tweetId}: author_id=${tweet.author_id}, authorUsername=${authorUsername}`);

          if (!authorUsername || authorUsername === twitterHandle) {
            console.log(`Skipping self-mention or invalid author for tweet ${tweetId}`);
            continue;
          }

          const hasReplied = await hasRepliedToTweet(agent.agentId, tweetId, db, authorUsername);
          if (hasReplied) {
            console.log(`Skipping tweet ${tweetId} for agent ${agent.agentId}: Already replied or cooldown active`);
            continue;
          }

          if (!(await canReplyToMentionForAgent(agent.agentId, db))) {
            console.log(`Skipping tweet ${tweetId} for agent ${agent.agentId}: Daily mention reply limit reached`);
            continue;
          }

          console.log(`Generating prompt for reply to tweet ${tweetId} for agent ${agent.agentId}`);
          const promptGenerator = new AgentPromptGenerator(agent);
          const prompt = promptGenerator.generatePrompt(`Reply to this mention from @${authorUsername}: "${tweet.text}"\nPersonalize your response by addressing @${authorUsername} directly.`);
          console.log(`Generated prompt for tweet ${tweetId}: ${prompt}`);

          console.log(`Requesting AI response for tweet ${tweetId} for agent ${agent.agentId}`);
          const aiResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
          });
          console.log(`AI response for tweet ${tweetId}:`, aiResponse.choices[0]?.message?.content);

          let responseText = aiResponse.choices[0]?.message?.content || `Sorry, @${authorUsername}, I couldn't generate a response.`;
          responseText = responseText.replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
          responseText = responseText.replace(/#\w+/g, '');
          const replyText = `@${authorUsername} ${responseText}`.slice(0, 280);
          console.log(`Prepared reply text for tweet ${tweetId}: ${replyText}`);

          const normalizedUsername = authorUsername.trim().toLowerCase();
          console.log(`Checking if ${normalizedUsername} is an agent for tweet ${tweetId}`);
          const targetAgent = await getAgentByTwitterHandle(normalizedUsername, db);
          console.log(`Target agent lookup for ${normalizedUsername}:`, targetAgent);
          const targetAgentId = targetAgent ? targetAgent.agentId : undefined;

          console.log(`Posting reply to tweet ${tweetId} for agent ${agent.agentId}`);
          await client.v2.tweet({
            text: replyText,
            reply: { in_reply_to_tweet_id: tweetId },
          });
          console.log(`Agent ${agent.agentId} replied to tweet ${tweetId}: ${replyText}`);

          console.log(`Saving reply record for tweet ${tweetId} by agent ${agent.agentId}`);
          await saveTweetReply(agent.agentId, tweetId, db, targetAgentId, authorUsername);
        }
      }

      scheduleNextPoll();
    } catch (error: any) {
      if (error.code === 524 || error.code === 429) {
        if (retries > 0) {
          console.log(`Retrying polling for agent ${agent.agentId} after ${error.code} error. Retries left: ${retries}, Delay: ${delayMs}ms`);
          await new Promise(resolve => setTimeout(resolve, delayMs));
          return pollForMentions(retries - 1, delayMs * 2);
        }
      }
      console.error(`Error polling mentions for agent ${agent.agentId}:`, error);
      scheduleNextPoll();
    }
  };

  const scheduleNextPoll = () => {
    const interval = setInterval(() => {
      console.log(`Scheduling polling for agent ${agent.agentId} at ${new Date().toISOString()}`);
      pollForMentions();
    }, 8 * 60 * 1000); // Poll every 8 minutes
    pollingIntervals.set(agent.agentId, interval);
  };

  stopTwitterPollListener(agent.agentId);
  pollForMentions();
  console.log(`Twitter poll listener (paid) started for agent ${agent.agentId} every 8 minutes`);
}

// Modified setupTwitterListener to include db
export async function setupTwitterListener(agent: Agent, db: any) {
  console.log(`Starting Twitter listener setup for agent ${agent.agentId}`);

  // Check if mention checking is enabled
  if (TWITTER_MENTION_CHECK_ENABLED === "TRUE") {
    console.log(`Mention checking is enabled for agent ${agent.agentId}`);
    if (TWITTER_API_MODE === "paid") {
      console.log("TWITTER_APP_KEY: ", TWITTER_APP_KEY);
      console.log("TWITTER_APP_SECRET: ", TWITTER_APP_SECRET);
      console.log("twitterAccessToken: ", agent.twitterAccessToken);
      console.log("twitterAccessSecret: ", agent.twitterAccessSecret);
      console.log("TWITTER_BEARER_TOKEN: ", TWITTER_BEARER_TOKEN);
      console.log(`Setting up Twitter listener for agent ${agent.agentId} in Paid mode`);
      console.log(`Setting up Twitter listener for twitterHandle ${agent.twitterHandle} in Paid mode`);

      const streamSuccess = await setupTwitterStreamListenerPaid(agent, db);
      if (!streamSuccess) {
        console.log(`Streaming setup failed for agent ${agent.agentId}, falling back to mentions timeline polling`);
        await setupTwitterMentionsListenerPaid(agent, db);
      }
    } else if (TWITTER_API_MODE === "free") {
      console.log(`Setting up Twitter listener for agent ${agent.agentId} in Free mode`);
      console.log(`Setting up Twitter listener for twitterHandle ${agent.twitterHandle} in Free mode`);
      await setupTwitterPollListenerFree(agent);
    } else {
      console.error(`Invalid TWITTER_API_MODE: ${TWITTER_API_MODE}. Expected "free" or "paid".`);
    }
  } else {
    console.log(`Mention checking is disabled for agent ${agent.agentId} (TWITTER_MENTION_CHECK_ENABLED=false). Only posting will be available if enabled.`);
  }
  
  console.log(`Twitter listener setup completed for agent ${agent.agentId}`);
}

export async function setupTwitterListeners(db: any) {
  try {
    console.log("Fetching agents from database...");
    const agents = await getActiveTwitterAgents(db);
    console.log(`Found ${agents.length} active Twitter agents`);

    for (const agent of agents) {
      if (hasValidTwitterCredentials(agent)) {
        console.log(`Setting up listener for agent ${agent.agentId}`);
        await setupTwitterListener(agent, db);
        if (agent.enablePostTweet === true && agent.agentType === "basic") {
          if (TWITTER_AUTO_POSTING_ENABLED === "TRUE") {
            console.log(`TWITTER_AUTO_POSTING_ENABLED=TRUE: Starting posting interval for agent ${agent.agentId}`);
            startPostingInterval(agent, db);
          } else {
            console.log(`TWITTER_AUTO_POSTING_ENABLED=${TWITTER_AUTO_POSTING_ENABLED}: Auto-posting disabled for agent ${agent.agentId}`);
          }
        } else {
          console.log(`Auto-posting not enabled for agent ${agent.agentId} (enablePostTweet=${agent.enablePostTweet}, agentType=${agent.agentType})`);
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
  console.log(`Attempting to stop Twitter listener for agent ${agentId}`);
  if (TWITTER_API_MODE === "paid") {
    console.log(`Stopping Twitter listener for agent ${agentId} in Paid mode`);
    stopTwitterStreamListener(agentId);
    stopTwitterPollListener(agentId);
  } else if (TWITTER_API_MODE === "free") {
    console.log(`No Twitter listener to stop for agent ${agentId} in Free tier`);
  } else {
    console.error(`Invalid TWITTER_API_MODE: ${TWITTER_API_MODE}. Cannot stop listener.`);
  }
  console.log(`Twitter listener stopped for agent ${agentId}`);
}

const pollingIntervals = new Map<string, NodeJS.Timeout>();

function stopTwitterPollListener(agentId: string) {
  try {
    console.log(`Stopping Twitter poll listener for agent ${agentId}`);
    const interval = pollingIntervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      clearTimeout(interval);
      pollingIntervals.delete(agentId);
      console.log(`Twitter poll listener stopped for agent ${agentId}`);
    } else {
      console.log(`No poll listener found to stop for agent ${agentId}`);
    }
  } catch (error) {
    console.error(`Error stopping Twitter poll listener for agent ${agentId}:`, error);
  }
}

function stopTwitterStreamListener(agentId: string) {
  try {
    console.log(`Stopping Twitter stream listener for agent ${agentId}`);
    const stream = twitterStreams.get(agentId);
    if (stream) {
      console.log(`Found active stream for agent ${agentId}, stopping it`);
      stream.autoReconnect = false;
      stream.destroy();
      twitterStreams.delete(agentId);
      console.log(`Twitter stream listener stopped for agent ${agentId}`);
    } else {
      console.log(`No stream found to stop for agent ${agentId}`);
    }
  } catch (error) {
    console.error(`Error stopping Twitter stream listener for agent ${agentId}:`, error);
  }
}

export function stopPostingInterval(agentId: string) {
  try {
    console.log(`Stopping posting interval for agent ${agentId}`);
    const interval = postingIntervals.get(agentId);
    if (interval) {
      clearInterval(interval);
      postingIntervals.delete(agentId);
      console.log(`Posting interval stopped for agent ${agentId}`);
    } else {
      console.log(`No posting interval found to stop for agent ${agentId}`);
    }
  } catch (error) {
    console.error(`Error stopping posting interval for agent ${agentId}:`, error);
  }
}

export async function postRandomTweet(agent: Agent, db: any) {
  console.log(`Starting random tweet posting for agent ${agent.agentId}`);
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot post tweet for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  if (!(await canPostTweetForAgent(agent.agentId, db))) {
    console.log(`Cannot post tweet for agent ${agent.agentId}: Daily post limit reached`);
    return;
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };
  const twitterClient = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });
  const promptGenerator = new AgentPromptGenerator(agent);
  console.log(`Initialized Twitter client and OpenAI for random tweet posting for agent ${agent.agentId}`);

  const timestamp = new Date().toISOString();
  const userMessage = `Generate a short, unique tweet for me to post on Twitter right now at ${timestamp}. Keep it under 280 characters and reflect my personality.`;
  const prompt = promptGenerator.generatePrompt(userMessage);
  console.log(`Generated prompt for random tweet for agent ${agent.agentId}: ${prompt}`);

  try {
    console.log(`Requesting OpenAI response for tweet for agent ${agent.agentId}`);
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });
    console.log(`OpenAI response received for agent ${agent.agentId}:`, response.choices[0]?.message?.content);

    let tweetText = `Tweet from ${agent.name} at ${timestamp}`;
    if (response.choices && response.choices[0] && response.choices[0].message && response.choices[0].message.content) {
      tweetText = response.choices[0].message.content;
      tweetText = tweetText.replace(/[\u{1F600}-\u{1F6FF}]/gu, '');
      tweetText = tweetText.replace(/#\w+/g, '');
      tweetText = tweetText.slice(0, 280);
      console.log(`Processed tweet text for agent ${agent.agentId}: ${tweetText}`);
    } else {
      console.warn(`OpenAI response missing content for agent ${agent.agentId}, using fallback: ${tweetText}`);
    }

    console.log(`Attempting to post tweet for agent ${agent.agentId}: ${tweetText}`);
    await twitterClient.v2.tweet({ text: tweetText });
    console.log(`Agent ${agent.agentId} successfully posted: ${tweetText}`);

    // Increment post count after successful post
    await incrementAgentPostCount(agent.agentId, db);
  } catch (error: any) {
    console.error(`Failed to post tweet for agent ${agent.agentId}:`, error);
    if (error.code === 403) {
      console.log(`Twitter API denied write access for agent ${agent.agentId}. Check app permissions at https://developer.twitter.com`);
    } else if (error.code === 524) {
      console.log(`Twitter API timed out (524) for agent ${agent.agentId}. Possible server issue`);
    }
    // No throw; process continues
  }
}

export async function postTweet(agent: Agent, message?: string, db?: any) {
  console.log(`Starting manual tweet posting for agent ${agent.agentId}`);
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot post tweet for agent ${agent.agentId}: Invalid Twitter credentials`);
    return null;
  }

  if (db && !(await canPostTweetForAgent(agent.agentId, db))) {
    console.log(`Cannot post tweet for agent ${agent.agentId}: Daily post limit reached`);
    return null;
  }

  const twitterTokens: TwitterApiTokens = {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };
  const twitterClient = new TwitterApi(twitterTokens);
  console.log(`Initialized Twitter client for manual tweet posting for agent ${agent.agentId}`);

  const tweetMessage = message || `Manual tweet from ${agent.name} at ${new Date().toISOString()}`;
  console.log(`Prepared tweet message for agent ${agent.agentId}: ${tweetMessage}`);

  try {
    console.log(`Attempting to post tweet for agent ${agent.agentId}: ${tweetMessage}`);
    await twitterClient.v2.tweet({ text: tweetMessage });
    console.log(`Agent ${agent.agentId} manually posted: ${tweetMessage}`);

    // Increment post count if db is provided
    if (db) await incrementAgentPostCount(agent.agentId, db);
    return tweetMessage;
  } catch (error: any) {
    console.error(`Failed to manually post tweet for agent ${agent.agentId}:`, error);
    if (error.code === 403) {
      console.log(`Twitter API denied write access for agent ${agent.agentId}. Check app permissions at https://developer.twitter.com`);
    } else if (error.code === 524) {
      console.log(`Twitter API timed out (524) for agent ${agent.agentId}. Possible server issue`);
    }
    return null;
  }
}

export function startPostingInterval(agent: Agent, db: any) {
  console.log(`Starting posting interval setup for agent ${agent.agentId}`);
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot start posting interval for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }

  try {
    stopPostingInterval(agent.agentId);
    const intervalSeconds = agent.postTweetInterval ?? 3600;
    const interval = setInterval(async () => {
      try {
        console.log(`Interval triggered for agent ${agent.agentId} at ${new Date().toISOString()}`);
        await postRandomTweet(agent, db);
        console.log(`Interval completed for agent ${agent.agentId}`);
      } catch (error) {
        console.error(`Error in posting interval for agent ${agent.agentId}:`, error);
      }
    }, intervalSeconds * 1000);
    postingIntervals.set(agent.agentId, interval);
    console.log(`Started posting interval for agent ${agent.agentId} every ${intervalSeconds} seconds`);
  } catch (error) {
    console.error(`Error starting posting interval for agent ${agent.agentId}:`, error);
  }
}