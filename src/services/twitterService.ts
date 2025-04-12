import { TwitterApi, TwitterApiTokens, TweetV2 } from "twitter-api-v2";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
import { hasValidTwitterCredentials } from "../utils/twitterUtils";
import { Agent } from "../types/agent";
import { Task } from "../types/task";
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
  incrementAgentReplyCount,
} from "../controllers/agentController";
import {
  TWITTER_INTEGRATION,
  TWITTER_APP_KEY,
  TWITTER_APP_SECRET,
  TWITTER_BEARER_TOKEN,
  MENTION_POLL_MIN_MINUTES,
  MENTION_POLL_MAX_MINUTES,
  TWITTER_MENTION_CHECK_ENABLED,
  TWITTER_AUTO_POSTING_ENABLED,
  TWITTER_AUTO_POSTING_MIN_INTERVAL,
  FRONTEND_URL,
} from "../config";
import { AgentPromptGenerator } from "../utils/agentPromptGenerator";
import { saveTask, getRecentTasks, updateTask } from "../controllers/taskController";
import { shouldSaveAsTask } from "../utils/criteriaUtils";
import { TaskClassifier } from "../utils/TaskClassifier";

// Helper to fetch Twitter user ID from handle
async function getTwitterUserId(handle: string, client: TwitterApi): Promise<string | undefined> {
  try {
    console.log(`Attempting to fetch user ID for handle ${handle}`);
    const response = await client.v2.userByUsername(handle.replace('@', ''), {
      "user.fields": ["id"],
    });
    if (!response.data?.id) {
      throw new Error("User ID not found in response");
    }
    console.log(`Fetched user ID for ${handle}: ${response.data.id}`);
    return response.data.id;
  } catch (error) {
    console.error(`Error fetching user ID for ${handle}:`, error);
    return undefined;
  }
}

// Helper to fetch username from user ID with improved fallback
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
    if (!response.data?.username) {
      throw new Error("Username not found in response");
    }
    const username = response.data.username;
    console.log(`Fetched username for ID ${userId}: ${username}`);

    await saveUsernameToCache(userId, username, db);
    return username;
  } catch (error: any) {
    console.error(`Error fetching username for user ID ${userId}:`, error);
    if (error.code === 429) {
      const cachedFallback = await getUsernameFromCache(userId, db);
      if (cachedFallback) {
        console.log(`Rate limit hit, using cached username for ${userId}: ${cachedFallback}`);
        return cachedFallback;
      }
    }
    console.warn(`Failed to fetch username for user ID ${userId}, using placeholder`);
    return `user_${userId}`; // Fallback to prevent crashes
  }
}

// Free tier: No streaming or polling for mentions, just posting
async function setupTwitterPollListenerFree(agent: Agent) {
  console.log(`Setting up free tier for agent ${agent.agentId}`);
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup Twitter listener for agent ${agent.agentId}: Invalid Twitter credentials`);
    return;
  }
  console.log(`Twitter mention replies not supported in free tier for agent ${agent.agentId}. Posting only enabled.`);
}

// Paid tier: Real-time streaming with Filtered Stream
async function setupTwitterStreamListenerPaid(agent: Agent, db: any): Promise<boolean> {
  console.log(`Setting up paid streaming for agent ${agent.agentId}`);
  if (!TWITTER_BEARER_TOKEN) {
    console.log(`Cannot setup Twitter stream listener for agent ${agent.agentId}: Missing TWITTER_BEARER_TOKEN`);
    return false;
  }
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot setup paid Twitter stream for agent ${agent.agentId}: Invalid credentials`);
    return false;
  }
  if (!agent.twitterHandle) {
    console.log(`Cannot setup Twitter stream listener for agent ${agent.agentId}: Missing twitterHandle`);
    return false;
  }

  const streamClient = new TwitterApi(TWITTER_BEARER_TOKEN);
  console.log(`Stream client initialized for agent ${agent.agentId}`);

  const twitterTokens: TwitterApiTokens = TWITTER_INTEGRATION === "advance" ? {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  } : {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };

  const postClient = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });

  stopTwitterStreamListener(agent.agentId);

  const processedTweets = new Set<string>();
  let replyCount = 3; // Start with 3 replies allowed
  const STREAM_CHECK_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

  // Reset reply count every 5 minutes
  setInterval(() => {
    replyCount = 3;
    processedTweets.clear();
    console.log(`Reset reply count to 3 and cleared processed tweets for agent ${agent.agentId} at ${new Date().toISOString()}`);
  }, STREAM_CHECK_INTERVAL_MS);

  try {
    const rules = await streamClient.v2.streamRules();
    console.log(`Stream rules fetched for agent ${agent.agentId}:`, rules.data || "No rules found");
    const existingRules = rules.data || [];
    const mentionRule = { value: `@${agent.twitterHandle} -from:${agent.twitterHandle}` };

    if (!existingRules.some(rule => rule.value === mentionRule.value)) {
      console.log(`Adding new stream rule for agent ${agent.agentId}: ${mentionRule.value}`);
      await streamClient.v2.updateStreamRules({ add: [mentionRule] });
    } else {
      console.log(`Stream rule already exists for agent ${agent.agentId}: ${mentionRule.value}`);
    }

    let stream = twitterStreams.get(agent.agentId);
    if (!stream) {
      console.log(`Starting new Twitter stream for agent ${agent.agentId}...`);
      stream = await streamClient.v2.searchStream({
        "tweet.fields": ["author_id", "text", "created_at", "conversation_id"],
        autoConnect: true,
      });
      twitterStreams.set(agent.agentId, stream);
      console.log(`Twitter stream started for agent ${agent.agentId}`);

      stream.on("data", async (tweet: TweetV2) => {
        let task_id: string | undefined;
        try {
          const tweetId = tweet.id;
          const conversationId = tweet.conversation_id || tweetId;

          if (processedTweets.has(tweetId)) {
            console.log(`Tweet ${tweetId} already processed for agent ${agent.agentId}, skipping`);
            return;
          }
          processedTweets.add(tweetId);

          if (!tweet.author_id) {
            console.error(`No author_id in tweet for agent ${agent.agentId}:`, tweet);
            return;
          }

          console.log(`Processing tweet ${tweetId}:`, JSON.stringify(tweet, null, 2));
          const authorUsername = await getUsernameFromId(tweet.author_id, postClient, db);

          if (!authorUsername || authorUsername === agent.twitterHandle) {
            console.log(`Skipping self-mention or invalid author for tweet ${tweetId}`);
            return;
          }

          const hasReplied = await hasRepliedToTweet(agent.agentId, tweetId, db, authorUsername);
          if (hasReplied) {
            console.log(`Skipping tweet ${tweetId} for agent ${agent.agentId}: Already replied or cooldown active`);
            return;
          }

          if (!(await canReplyToMentionForAgent(agent.agentId, db))) {
            console.log(`Skipping tweet ${tweetId} for agent ${agent.agentId}: Daily reply limit reached`);
            return;
          }

          if (replyCount <= 0) {
            console.log(`Tweet ${tweetId} for agent ${agent.agentId}: Max 3 replies reached for this interval`);
            return;
          }

          // Identify user (registered only)
          const user = await db.collection("users").findOne({
            $or: [
              { "linked_channels.twitter_user_id": tweet.author_id },
              { twitterHandle: authorUsername },
            ],
          });
          let unified_user_id: string | undefined;

          if (user) {
            unified_user_id = user.userId;
            console.log(`User ${unified_user_id} found for Twitter user ${tweet.author_id}`);
          }

          // Handle unregistered users
          if (!unified_user_id) {
            const replyText = `@${authorUsername} Please visit ${FRONTEND_URL || 'valetapp.xyz'} to connect your wallet and register!`;
            await postClient.v2.tweet({
              text: replyText,
              reply: { in_reply_to_tweet_id: tweetId },
            });
            console.log(`Agent ${agent.agentId} replied to unregistered user tweet ${tweetId}: ${replyText}`);
            await saveTweetReply(agent.agentId, tweetId, db, undefined, authorUsername);
            replyCount--;
            console.log(`Reply count for agent ${agent.agentId} decremented to ${replyCount}`);
            return;
          }

          // Retrieve recent tasks
          const recentTasks = await getRecentTasks(
            {
              unified_user_id,
              channel_user_id: tweet.author_id,
            },
            agent.settings?.max_memory_context || 5
          );
          const hasRecentTasks = recentTasks.length > 0;
          const context = recentTasks.map(t => `Command: ${t.command}, Result: ${t.result || "Pending"}`).join("\n");

          // Classify and handle task
          const classification = await TaskClassifier.classifyTask(tweet.text || "No text provided", agent, recentTasks);
          const shouldSaveTask = shouldSaveAsTask(tweet.text || "No text provided", hasRecentTasks);

          if (classification.task_type !== "chat" || shouldSaveTask) {
            task_id = uuidv4();
            const task: Task = {
              task_id,
              channel_id: `twitter_${tweetId}`,
              channel_user_id: tweet.author_id,
              unified_user_id,
              command: tweet.text || "No text provided",
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
            console.log(`Saved task ${task_id} for tweet ${tweetId}: ${tweet.text}`);

            const replyText = `@${authorUsername} Your request has been queued for processing (Task ID: ${task_id}).`;
            await postClient.v2.tweet({
              text: replyText,
              reply: { in_reply_to_tweet_id: tweetId },
            });
            console.log(`Agent ${agent.agentId} replied to tweet ${tweetId}: ${replyText}`);
            await saveTweetReply(agent.agentId, tweetId, db, undefined, authorUsername);
            replyCount--;
            console.log(`Reply count for agent ${agent.agentId} decremented to ${replyCount}`);
            return;
          }

          // Handle chat messages
          const promptGenerator = new AgentPromptGenerator(agent);
          const prompt = promptGenerator.generatePrompt(
            `Reply to this mention from @${authorUsername}: "${tweet.text || "No text provided"}"\nPersonalize your response by addressing @${authorUsername} directly.\nPrevious interactions:\n${context || "None"}`
          );
          console.log(`Generated prompt for tweet ${tweetId}: ${prompt}`);

          const aiResponse = await openai.chat.completions.create({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
          });
          let responseText = aiResponse.choices[0]?.message?.content || `Sorry, @${authorUsername}, I couldn't generate a response.`;
          responseText = responseText.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/#\w+/g, '');

          const replyText = `@${authorUsername} ${responseText}`.slice(0, 280);
          console.log(`Prepared reply for tweet ${tweetId}: ${replyText}`);

          const normalizedUsername = authorUsername.trim().toLowerCase();
          const targetAgent = await getAgentByTwitterHandle(normalizedUsername, db);
          const targetAgentId = targetAgent ? targetAgent.agentId : undefined;

          await postClient.v2.tweet({
            text: replyText,
            reply: { in_reply_to_tweet_id: tweetId },
          });
          console.log(`Agent ${agent.agentId} replied to tweet ${tweetId}: ${replyText}`);

          await saveTweetReply(agent.agentId, tweetId, db, targetAgentId, authorUsername);
          replyCount--;
          console.log(`Reply count for agent ${agent.agentId} decremented to ${replyCount}`);
        } catch (error) {
          console.error(`Error processing tweet for agent ${agent.agentId}, tweet ID: ${tweet.id || 'unknown'}:`, error);
          if (task_id) {
            await updateTask(task_id, {
              status: "failed",
              result: "Error processing request",
              completed_at: new Date(),
              notified: false, // Ensure failed tasks can be notified
            });
          }
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

      console.log(`Twitter stream listener operational for agent ${agent.agentId}`);
    }
    return true;
  } catch (error) {
    console.error(`Error setting up Twitter stream for agent ${agent.agentId}:`, error);
    stopTwitterStreamListener(agent.agentId);
    return false;
  }
}

// Fallback to User Mention Timeline polling for paid tier
async function setupTwitterMentionsListenerPaid(agent: Agent, db: any) {
  console.log(`Setting up paid mentions polling for agent ${agent.agentId}`);
  if (!hasValidTwitterCredentials(agent) || !agent.twitterHandle) {
    console.log(`Cannot setup Twitter mentions listener for agent ${agent.agentId}: Invalid credentials or missing handle`);
    return;
  }

  const twitterTokens: TwitterApiTokens = TWITTER_INTEGRATION === "advance" ? {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  } : {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };

  const client = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });

  const twitterUserId = await getTwitterUserId(agent.twitterHandle, client);
  if (!twitterUserId) {
    console.log(`Failed to fetch Twitter user ID for agent ${agent.agentId}`);
    return;
  }

  let sinceId: string | undefined;

  const checkMentions = async (retries = 3, delayMs = 5000) => {
    let replyCount = 3; // Reset to 3 at the start of each polling cycle
    console.log(`Reset reply count to 3 for agent ${agent.agentId} at start of polling cycle`);

    try {
      console.log(`Polling mentions for agent ${agent.agentId} at ${new Date().toISOString()}`);
      const mentions = await client.v2.userMentionTimeline(twitterUserId, {
        "tweet.fields": ["author_id", "text", "created_at", "conversation_id"],
        since_id: sinceId,
        max_results: 10,
      });

      const tweets = mentions.data.data || [];
      console.log(`Found ${tweets.length} new mentions for agent ${agent.agentId}`);

      if (tweets.length > 0) {
        sinceId = tweets[0].id;
        for (const tweet of tweets) {
          let task_id: string | undefined;
          try {
            if (!tweet.author_id) {
              console.error(`No author_id in tweet for agent ${agent.agentId}:`, tweet);
              continue;
            }

            const tweetId = tweet.id;
            const conversationId = tweet.conversation_id || tweetId;
            const authorUsername = await getUsernameFromId(tweet.author_id, client, db);
            if (!authorUsername || authorUsername === agent.twitterHandle) {
              console.log(`Skipping self-mention or invalid author for tweet ${tweetId}`);
              continue;
            }

            const hasReplied = await hasRepliedToTweet(agent.agentId, tweetId, db, authorUsername);
            if (hasReplied) {
              console.log(`Skipping tweet ${tweetId}: Already replied or cooldown active`);
              continue;
            }

            if (!(await canReplyToMentionForAgent(agent.agentId, db))) {
              console.log(`Skipping tweet ${tweetId}: Daily reply limit reached`);
              continue;
            }

            if (replyCount <= 0) {
              console.log(`Tweet ${tweetId} for agent ${agent.agentId}: Max 3 replies reached for this polling cycle`);
              continue;
            }

            // Identify user (registered only)
            const user = await db.collection("users").findOne({
              $or: [
                { "linked_channels.twitter_user_id": tweet.author_id },
                { twitterHandle: authorUsername },
              ],
            });
            let unified_user_id: string | undefined;

            if (user) {
              unified_user_id = user.userId;
              console.log(`User ${unified_user_id} found for Twitter user ${tweet.author_id}`);
            }

            // Handle unregistered users
            if (!unified_user_id) {
              const replyText = `@${authorUsername} Please visit ${FRONTEND_URL || 'valetapp.xyz'} to connect your wallet and register!`;
              await client.v2.tweet({
                text: replyText,
                reply: { in_reply_to_tweet_id: tweetId },
              });
              console.log(`Agent ${agent.agentId} replied to unregistered user tweet ${tweetId}: ${replyText}`);
              await saveTweetReply(agent.agentId, tweetId, db, undefined, authorUsername);
              replyCount--;
              console.log(`Reply count for agent ${agent.agentId} decremented to ${replyCount}`);
              continue;
            }

            // Retrieve recent tasks
            const recentTasks = await getRecentTasks(
              {
                unified_user_id,
                channel_user_id: tweet.author_id,
              },
              agent.settings?.max_memory_context || 5
            );
            const hasRecentTasks = recentTasks.length > 0;
            const context = recentTasks.map(t => `Command: ${t.command}, Result: ${t.result || "Pending"}`).join("\n");

            // Classify and handle task
            const classification = await TaskClassifier.classifyTask(tweet.text || "No text provided", agent, recentTasks);
            const shouldSaveTask = shouldSaveAsTask(tweet.text || "No text provided", hasRecentTasks);

            if (classification.task_type !== "chat" || shouldSaveTask) {
              task_id = uuidv4();
              const task: Task = {
                task_id,
                channel_id: `twitter_${tweetId}`,
                channel_user_id: tweet.author_id,
                unified_user_id,
                command: tweet.text || "No text provided",
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
              console.log(`Saved task ${task_id} for tweet ${tweetId}: ${tweet.text}`);

              const replyText = `@${authorUsername} Your request has been queued for processing (Task ID: ${task_id}).`;
              await client.v2.tweet({
                text: replyText,
                reply: { in_reply_to_tweet_id: tweetId },
              });
              console.log(`Agent ${agent.agentId} replied to tweet ${tweetId}: ${replyText}`);
              await saveTweetReply(agent.agentId, tweetId, db, undefined, authorUsername);
              replyCount--;
              console.log(`Reply count for agent ${agent.agentId} decremented to ${replyCount}`);
              continue;
            }

            // Handle chat messages
            const promptGenerator = new AgentPromptGenerator(agent);
            const prompt = promptGenerator.generatePrompt(
              `Reply to this mention from @${authorUsername}: "${tweet.text || "No text provided"}"\nPersonalize your response by addressing @${authorUsername} directly.\nPrevious interactions:\n${context || "None"}`
            );
            const aiResponse = await openai.chat.completions.create({
              model: "gpt-3.5-turbo",
              messages: [{ role: "user", content: prompt }],
            });
            let responseText = aiResponse.choices[0]?.message?.content || `Sorry, @${authorUsername}, I couldn't generate a response.`;
            responseText = responseText.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/#\w+/g, '');

            const replyText = `@${authorUsername} ${responseText}`.slice(0, 280);

            const targetAgent = await getAgentByTwitterHandle(authorUsername.trim().toLowerCase(), db);
            const targetAgentId = targetAgent ? targetAgent.agentId : undefined;

            await client.v2.tweet({
              text: replyText,
              reply: { in_reply_to_tweet_id: tweetId },
            });
            console.log(`Agent ${agent.agentId} replied to tweet ${tweetId}: ${replyText}`);

            await saveTweetReply(agent.agentId, tweetId, db, targetAgentId, authorUsername);
            replyCount--;
            console.log(`Reply count for agent ${agent.agentId} decremented to ${replyCount}`);
          } catch (error) {
            console.error(`Error processing tweet for agent ${agent.agentId}, tweet ID: ${tweet.id}:`, error);
            if (task_id) {
              await updateTask(task_id, {
                status: "failed",
                result: "Error processing request",
                completed_at: new Date(),
                notified: false, // Ensure failed tasks can be notified
              });
            }
          }
        }
      }
      scheduleNextPoll();
    } catch (error: any) {
      if (error.code === 524 || error.code === 429) {
        if (retries > 0) {
          console.log(`Retrying polling for agent ${agent.agentId} after ${error.code} error. Retries left: ${retries}`);
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
    const interval = setTimeout(() => checkMentions(), intervalMs);
    pollingIntervals.set(agent.agentId, interval);
  };

  stopTwitterPollListener(agent.agentId);
  checkMentions();
  console.log(`Twitter mentions listener started for agent ${agent.agentId}`);
}

// Fallback polling for paid tier (alternative method)
async function setupTwitterPollListenerPaid(agent: Agent, db: any) {
  console.log(`Setting up paid polling for agent ${agent.agentId}`);
  if (!hasValidTwitterCredentials(agent) || !agent.twitterHandle) {
    console.log(`Cannot setup Twitter poll listener for agent ${agent.agentId}: Invalid credentials or missing handle`);
    return;
  }

  const twitterTokens: TwitterApiTokens = TWITTER_INTEGRATION === "advance" ? {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  } : {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };

  const client = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });

  let sinceId: string | undefined;

  const pollForMentions = async (retries = 3, delayMs = 5000) => {
    try {
      const query = `@${agent.twitterHandle} -from:${agent.twitterHandle}`;
      console.log(`Polling mentions for agent ${agent.agentId} with query: ${query}`);
      const response = await client.v2.search({
        query,
        "tweet.fields": ["author_id", "text", "created_at", "conversation_id"],
        since_id: sinceId,
        max_results: 10,
      });

      const tweets = response.data.data || [];
      if (tweets.length > 0) {
        sinceId = tweets[0].id;
        for (const tweet of tweets) {
          let task_id: string | undefined;
          try {
            if (!tweet.author_id) continue;

            const tweetId = tweet.id;
            const conversationId = tweet.conversation_id || tweetId;
            const authorUsername = await getUsernameFromId(tweet.author_id, client, db);
            if (!authorUsername || authorUsername === agent.twitterHandle) continue;

            const hasReplied = await hasRepliedToTweet(agent.agentId, tweetId, db, authorUsername);
            if (hasReplied) continue;

            if (!(await canReplyToMentionForAgent(agent.agentId, db))) continue;

            // Identify user (registered only)
            const user = await db.collection("users").findOne({
              $or: [
                { "linked_channels.twitter_user_id": tweet.author_id },
                { twitterHandle: authorUsername },
              ],
            });
            let unified_user_id: string | undefined;

            if (user) {
              unified_user_id = user.userId;
              console.log(`User ${unified_user_id} found for Twitter user ${tweet.author_id}`);
            }

            // Handle unregistered users
            if (!unified_user_id) {
              const replyText = `@${authorUsername} Please visit ${FRONTEND_URL || 'valetapp.xyz'} to connect your wallet and register!`;
              await client.v2.tweet({
                text: replyText,
                reply: { in_reply_to_tweet_id: tweetId },
              });
              console.log(`Agent ${agent.agentId} replied to unregistered user tweet ${tweetId}: ${replyText}`);
              await saveTweetReply(agent.agentId, tweetId, db, undefined, authorUsername);
              continue;
            }

            // Retrieve recent tasks
            const recentTasks = await getRecentTasks(
              {
                unified_user_id,
                channel_user_id: tweet.author_id,
              },
              agent.settings?.max_memory_context || 5
            );
            const hasRecentTasks = recentTasks.length > 0;
            const context = recentTasks.map(t => `Command: ${t.command}, Result: ${t.result || "Pending"}`).join("\n");

            // Classify and handle task
            const classification = await TaskClassifier.classifyTask(tweet.text || "No text provided", agent, recentTasks);
            const shouldSaveTask = shouldSaveAsTask(tweet.text || "No text provided", hasRecentTasks);

            if (classification.task_type !== "chat" || shouldSaveTask) {
              task_id = uuidv4();
              const task: Task = {
                task_id,
                channel_id: `twitter_${tweetId}`,
                channel_user_id: tweet.author_id,
                unified_user_id,
                command: tweet.text || "No text provided",
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
              console.log(`Saved task ${task_id} for tweet ${tweetId}: ${tweet.text}`);

              const replyText = `@${authorUsername} Your request has been queued for processing (Task ID: ${task_id}).`;
              await client.v2.tweet({
                text: replyText,
                reply: { in_reply_to_tweet_id: tweetId },
              });
              console.log(`Agent ${agent.agentId} replied to tweet ${tweetId}: ${replyText}`);
              await saveTweetReply(agent.agentId, tweetId, db, undefined, authorUsername);
              continue;
            }

            // Handle chat messages
            const promptGenerator = new AgentPromptGenerator(agent);
            const prompt = promptGenerator.generatePrompt(
              `Reply to this mention from @${authorUsername}: "${tweet.text || "No text provided"}"\nPersonalize your response by addressing @${authorUsername} directly.\nPrevious interactions:\n${context || "None"}`
            );
            const aiResponse = await openai.chat.completions.create({
              model: "gpt-3.5-turbo",
              messages: [{ role: "user", content: prompt }],
            });
            let responseText = aiResponse.choices[0]?.message?.content || `Sorry, @${authorUsername}, I couldn't generate a response.`;
            responseText = responseText.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/#\w+/g, '');

            const replyText = `@${authorUsername} ${responseText}`.slice(0, 280);

            const targetAgent = await getAgentByTwitterHandle(authorUsername.trim().toLowerCase(), db);
            const targetAgentId = targetAgent ? targetAgent.agentId : undefined;

            await client.v2.tweet({
              text: replyText,
              reply: { in_reply_to_tweet_id: tweetId },
            });
            console.log(`Agent ${agent.agentId} replied to tweet ${tweetId}: ${replyText}`);

            await saveTweetReply(agent.agentId, tweetId, db, targetAgentId, authorUsername);
          } catch (error) {
            console.error(`Error processing tweet for agent ${agent.agentId}, tweet ID: ${tweet.id}:`, error);
            if (task_id) {
              await updateTask(task_id, {
                status: "failed",
                result: "Error processing request",
                completed_at: new Date(),
                notified: false, // Ensure failed tasks can be notified
              });
            }
          }
        }
      }
      scheduleNextPoll();
    } catch (error: any) {
      if (error.code === 524 || error.code === 429) {
        if (retries > 0) {
          await new Promise(resolve => setTimeout(resolve, delayMs));
          return pollForMentions(retries - 1, delayMs * 2);
        }
      }
      console.error(`Error polling mentions for agent ${agent.agentId}:`, error);
      scheduleNextPoll();
    }
  };

  const scheduleNextPoll = () => {
    const interval = setInterval(() => pollForMentions(), 8 * 60 * 1000);
    pollingIntervals.set(agent.agentId, interval);
  };

  stopTwitterPollListener(agent.agentId);
  pollForMentions();
  console.log(`Twitter poll listener started for agent ${agent.agentId}`);
}

// Main Twitter listener setup using isTwitterPaid
export async function setupTwitterListener(agent: Agent, db: any) {
  console.log(`Starting Twitter listener setup for agent ${agent.agentId}`);
  if (TWITTER_MENTION_CHECK_ENABLED !== "TRUE") {
    console.log(`Mention checking disabled for agent ${agent.agentId}`);
    return;
  }

  const isTwitterPaid = agent.isTwitterPaid ?? false;
  const hasTwitterCredentials = hasValidTwitterCredentials(agent);

  if (isTwitterPaid) {
    console.log(`Agent ${agent.agentId} configured for paid Twitter API`);
    if (!TWITTER_BEARER_TOKEN || !hasTwitterCredentials) {
      console.warn(`Agent ${agent.agentId} marked as paid but missing BEARER_TOKEN or credentials. Falling back to free mode`);
      await setupTwitterPollListenerFree(agent);
    } else {
      const streamSuccess = await setupTwitterStreamListenerPaid(agent, db);
      if (!streamSuccess) {
        console.log(`Streaming failed for agent ${agent.agentId}, falling back to mentions polling`);
        await setupTwitterMentionsListenerPaid(agent, db);
      }
    }
  } else {
    console.log(`Agent ${agent.agentId} configured for free Twitter API`);
    await setupTwitterPollListenerFree(agent);
  }
}

// Setup listeners for all active agents
export async function setupTwitterListeners(db: any) {
  try {
    const agents = await getActiveTwitterAgents(db);
    console.log(`Found ${agents.length} active Twitter agents`);
    for (const agent of agents) {
      if (hasValidTwitterCredentials(agent)) {
        await setupTwitterListener(agent, db);
        if (agent.enablePostTweet && agent.agentType === "basic" && TWITTER_AUTO_POSTING_ENABLED === "TRUE") {
          startPostingInterval(agent, db);
        }
      } else {
        console.log(`Skipping Twitter features for agent ${agent.agentId}: Invalid credentials`);
      }
    }
  } catch (error) {
    console.error("Error setting up Twitter listeners:", error);
  }
}

// Stop Twitter listener for an agent
export async function stopTwitterListener(agentId: string) {
  console.log(`Stopping Twitter listener for agent ${agentId}`);
  stopTwitterStreamListener(agentId);
  stopTwitterPollListener(agentId);
}

const pollingIntervals = new Map<string, NodeJS.Timeout>();

function stopTwitterPollListener(agentId: string) {
  const interval = pollingIntervals.get(agentId);
  if (interval) {
    clearInterval(interval);
    clearTimeout(interval);
    pollingIntervals.delete(agentId);
    console.log(`Twitter poll listener stopped for agent ${agentId}`);
  }
}

function stopTwitterStreamListener(agentId: string) {
  const stream = twitterStreams.get(agentId);
  if (stream) {
    stream.autoReconnect = false;
    stream.destroy();
    twitterStreams.delete(agentId);
    console.log(`Twitter stream listener stopped for agent ${agentId}`);
  }
}

// Stop posting interval for an agent
export function stopPostingInterval(agentId: string) {
  const interval = postingIntervals.get(agentId);
  if (interval) {
    clearInterval(interval);
    postingIntervals.delete(agentId);
    console.log(`Posting interval stopped for agent ${agentId}`);
  }
}

// Post a random tweet
export async function postRandomTweet(agent: Agent, db: any) {
  if (!hasValidTwitterCredentials(agent) || !(await canPostTweetForAgent(agent.agentId, db))) {
    console.log(`Cannot post tweet for agent ${agent.agentId}: Invalid credentials or limit reached`);
    return;
  }

  const twitterTokens: TwitterApiTokens = TWITTER_INTEGRATION === "advance" ? {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  } : {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };

  const twitterClient = new TwitterApi(twitterTokens);
  const openai = new OpenAI({ apiKey: agent.openaiApiKey });
  const promptGenerator = new AgentPromptGenerator(agent);

  const timestamp = new Date().toISOString();
  const prompt = promptGenerator.generatePrompt(`Generate a short, unique tweet for me to post on Twitter right now at ${timestamp}. Keep it under 280 characters and reflect my personality.`);

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: prompt }],
    });
    let tweetText = response.choices[0]?.message?.content || `Tweet from ${agent.name} at ${timestamp}`;
    tweetText = tweetText.replace(/[\u{1F600}-\u{1F6FF}]/gu, '').replace(/#\w+/g, '').slice(0, 280);

    await twitterClient.v2.tweet({ text: tweetText });
    console.log(`Agent ${agent.agentId} posted: ${tweetText}`);
    await incrementAgentPostCount(agent.agentId, db);
  } catch (error: any) {
    console.error(`Failed to post tweet for agent ${agent.agentId}:`, error);
  }
}

// Post a manual tweet
export async function postTweet(agent: Agent, message?: string, db?: any) {
  if (!hasValidTwitterCredentials(agent) || (db && !(await canPostTweetForAgent(agent.agentId, db)))) {
    console.log(`Cannot post tweet for agent ${agent.agentId}: Invalid credentials or limit reached`);
    return null;
  }

  const twitterTokens: TwitterApiTokens = TWITTER_INTEGRATION === "advance" ? {
    appKey: agent.twitterAppKey!,
    appSecret: agent.twitterAppSecret!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  } : {
    appKey: TWITTER_APP_KEY!,
    appSecret: TWITTER_APP_SECRET!,
    accessToken: agent.twitterAccessToken!,
    accessSecret: agent.twitterAccessSecret!,
  };

  const twitterClient = new TwitterApi(twitterTokens);
  const tweetMessage = message || `Manual tweet from ${agent.name} at ${new Date().toISOString()}`;

  try {
    await twitterClient.v2.tweet({ text: tweetMessage });
    console.log(`Agent ${agent.agentId} posted: ${tweetMessage}`);
    if (db) await incrementAgentPostCount(agent.agentId, db);
    return tweetMessage;
  } catch (error: any) {
    console.error(`Failed to post tweet for agent ${agent.agentId}:`, error);
    return null;
  }
}

// Start periodic posting interval
export function startPostingInterval(agent: Agent, db: any) {
  if (!hasValidTwitterCredentials(agent)) {
    console.log(`Cannot start posting interval for agent ${agent.agentId}: Invalid credentials`);
    return;
  }

  stopPostingInterval(agent.agentId);

  const twitterAutoPostingMinInterval = parseInt(TWITTER_AUTO_POSTING_MIN_INTERVAL || "3600", 10);
  let intervalSeconds = 3600;
  if (agent.postTweetInterval !== undefined) {
    intervalSeconds = agent.postTweetInterval < twitterAutoPostingMinInterval
      ? twitterAutoPostingMinInterval
      : agent.postTweetInterval;
  }

  const interval = setInterval(async () => {
    try {
      await postRandomTweet(agent, db);
    } catch (error) {
      console.error(`Error posting tweet for agent ${agent.agentId}:`, error);
    }
  }, intervalSeconds * 1000);

  postingIntervals.set(agent.agentId, interval);
  console.log(`Started posting interval for agent ${agent.agentId} every ${intervalSeconds} seconds`);
}