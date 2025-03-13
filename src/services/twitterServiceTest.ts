import { connectToDatabase } from "../services/dbService";
import { Agent } from "../types/agent";
import { 
  saveTweetReply, 
  hasRepliedToTweet, 
  saveUsernameToCache, 
  getUsernameFromCache, 
  getAgentByTwitterHandle, 
  canPostTweetForAgent, 
  canReplyToMentionForAgent, 
  incrementAgentPostCount, 
  incrementAgentReplyCount,
  createAgent,
  getAgentById
} from "../controllers/agentController";
import { 
  TWITTER_API_MODE, 
  TWITTER_APP_KEY, 
  TWITTER_APP_SECRET, 
  TWITTER_BEARER_TOKEN, 
  MENTION_POLL_MIN_MINUTES, 
  MENTION_POLL_MAX_MINUTES, 
  TWITTER_MENTION_CHECK_ENABLED, 
  TWITTER_AUTO_POSTING_ENABLED,
  MAX_POSTS_PER_DAY,
  MAX_REPLIES_PER_DAY
} from "../config";

// Simulated agent for testing
const testAgent: Omit<Agent, "agentId" | "isActive"> & { agentId?: string } = {
  name: "TestAgent",
  description: "Test agent description",
  bio: "I am a test agent",
  mission: "Test mission",
  vision: "Test vision",
  contact: {
    email: "test@agent.com",
    website: "https://testagent.com",
    socials: {
      twitter: "testagent",
      github: "testagent",
      linkedin: "testagent"
    }
  },
  wallets: {
    solana: "mock-solana-wallet",
    ethereum: "mock-ethereum-wallet",
    bitcoin: "mock-bitcoin-wallet"
  },
  knowledge: {
    "test-topic": "Test knowledge"
  },
  personality: {
    tone: "friendly",
    humor: true,
    formality: "casual",
    catchphrase: "Test!",
    preferences: {
      topics: ["testing", "AI"],
      languages: ["en"]
    }
  },
  settings: {
    max_memory_context: 1000,
    platforms: ["twitter"]
  },
  ruleIds: [],
  openaiApiKey: "mock-openai-key",
  twitterAppKey: TWITTER_APP_KEY || "mock-twitter-app-key",
  twitterAppSecret: TWITTER_APP_SECRET || "mock-twitter-app-secret",
  twitterAccessToken: "mock-twitter-access-token",
  twitterAccessSecret: "mock-twitter-access-secret",
  twitterHandle: "testagent",
  enablePostTweet: TWITTER_AUTO_POSTING_ENABLED === "TRUE",
  postTweetInterval: 1,
  agentType: "basic",
  createdBy: "test-user",
  profileImageId: "mock-profile-image-id"
};

// Mock request and response objects
const mockRequest = (body: any) => ({
  body,
  params: {},
  query: {}
} as any);

const mockResponse = () => {
  const res: any = {};
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: any) => {
    res.data = data;
    return res;
  };
  return res;
};

// Mock setup for Solana, Twitter, and OpenAI
let originalVerifySolPayment: any;
let originalTwitterService: any;
let originalOpenAI: any;

const mockVerifySolPayment = async () => true;

const mockTwitterService = {
  setupTwitterListener: async (agent: Agent, db: any) => {
    console.log(`[Mock] Setup Twitter listener for agent ${agent.agentId} (Mode: ${TWITTER_API_MODE})`);
  },
  startPostingInterval: (agent: Agent, db: any) => {
    console.log(`[Mock] Started posting interval for agent ${agent.agentId}`);
  },
  stopPostingInterval: (agentId: string) => {
    console.log(`[Mock] Stopped posting interval for agent ${agentId}`);
  },
  stopTwitterListener: (agentId: string) => {
    console.log(`[Mock] Stopped Twitter listener for agent ${agentId}`);
  },
  postTweet: async (agent: Agent, message?: string, db?: any) => {
    const tweetMessage = message || `Simulated tweet from ${agent.name} at ${new Date().toISOString()}`;
    console.log(`[Mock] Posting original tweet for agent ${agent.agentId}: ${tweetMessage}`);
    if (db) await incrementAgentPostCount(agent.agentId, db);
    return tweetMessage;
  },
  getTwitterUserId: async (handle: string) => `mock-user-id-${handle}`,
  getUsernameFromId: async (userId: string) => `mock-user-${userId}`
};

class MockOpenAI {
  chat = {
    completions: {
      create: async ({ messages }: { messages: { role: string; content: string }[] }) => {
        const prompt = messages[0]?.content || "No prompt provided";
        return {
          choices: [{
            message: {
              content: `Simulated AI response: ${prompt}`
            }
          }]
        };
      }
    }
  };
}

async function setupMocks() {
  const solanaService = await import("../services/solanaService");
  originalVerifySolPayment = solanaService.verifySolPayment;
  (solanaService as any).verifySolPayment = mockVerifySolPayment;

  const twitterService = await import("../services/twitterService");
  originalTwitterService = { ...twitterService };
  Object.assign(twitterService, mockTwitterService);

  const OpenAI = (await import("openai")).default;
  originalOpenAI = OpenAI;
  (global as any).OpenAI = MockOpenAI;
}

async function restoreMocks() {
  const solanaService = await import("../services/solanaService");
  (solanaService as any).verifySolPayment = originalVerifySolPayment;

  const twitterService = await import("../services/twitterService");
  Object.assign(twitterService, originalTwitterService);

  const OpenAI = (await import("openai")).default;
  (global as any).OpenAI = originalOpenAI;
}

// Mock Twitter actions with clearer terminology
async function mockPostOriginalTweet(agent: Agent, db: any, message?: string): Promise<boolean> {
  const tweetMessage = message || `Test original tweet from ${agent.name} at ${new Date().toISOString()}`;
  console.log(`[Test] Agent ${agent.agentId} attempting to post original tweet: ${tweetMessage}`);
  if (!(await canPostTweetForAgent(agent.agentId!, db))) {
    console.log(`[Test] Cannot post original tweet for agent ${agent.agentId}: Daily tweet limit reached (${MAX_POSTS_PER_DAY})`);
    return false;
  }
  await incrementAgentPostCount(agent.agentId!, db);
  console.log(`[Test] Original tweet posted successfully: ${tweetMessage}`);
  return true;
}

async function mockReplyToTweet(agent: Agent, db: any, tweetId: string, authorUsername: string): Promise<boolean> {
  const replyMessage = `Simulated reply to @${authorUsername} for tweet ${tweetId}`;
  console.log(`[Test] Agent ${agent.agentId} attempting to reply to tweet ${tweetId} from @${authorUsername} with: ${replyMessage}`);
  if (!(await canReplyToMentionForAgent(agent.agentId!, db))) {
    console.log(`[Test] Cannot reply to tweet ${tweetId} for agent ${agent.agentId}: Daily reply limit reached (${MAX_REPLIES_PER_DAY})`);
    return false;
  }
  if (await hasRepliedToTweet(agent.agentId!, tweetId, db, authorUsername)) {
    console.log(`[Test] Skipping reply to tweet ${tweetId} for agent ${agent.agentId}: Already replied or cooldown active`);
    return false;
  }
  const targetAgent = await getAgentByTwitterHandle(authorUsername, db);
  const targetAgentId = targetAgent ? targetAgent.agentId : undefined;
  await saveTweetReply(agent.agentId!, tweetId, db, targetAgentId, authorUsername);
  console.log(`[Test] Reply to tweet ${tweetId} successful: ${replyMessage}`);
  return true;
}

// Test suite
export async function runTwitterServiceTests(): Promise<{ successes: number; failures: number }> {
  console.log("Starting Twitter Service Tests with MongoDB...");
  const db = await connectToDatabase();
  
  let successes = 0;
  let failures = 0;

  const maxPosts = parseInt(MAX_POSTS_PER_DAY || "10", 10);
  const maxReplies = parseInt(MAX_REPLIES_PER_DAY || "12", 10);

  await setupMocks();

  try {
    await db.collection("users").updateOne(
      { userId: "test-user" },
      { $set: { solanaWalletAddress: "mock-solana-wallet" } },
      { upsert: true }
    );

    let agentToUse: Agent;
    const twitterHandle = testAgent.twitterHandle || "testagent_default";
    console.log(`[Test] Checking for existing agent with handle ${twitterHandle}`);
    const existingAgent = await getAgentByTwitterHandle(twitterHandle, db);

    if (existingAgent) {
      console.log(`[Test] Agent with handle ${twitterHandle} already exists: ${existingAgent.agentId}`);
      agentToUse = existingAgent;
      testAgent.agentId = existingAgent.agentId;
    } else {
      console.log("\nCreating test agent...");
      const req = mockRequest({
        txSignature: "mock-tx-signature",
        ...testAgent
      });
      const res = mockResponse();

      await createAgent(req, res);

      if (res.statusCode !== 201) {
        console.error("[Test] Failed to create test agent:", res.data);
        failures++;
        return { successes, failures };
      }
      agentToUse = res.data;
      testAgent.agentId = agentToUse.agentId;
      console.log(`[Test] Test agent ${testAgent.agentId} created successfully`);
    }

    await db.collection("agentDailyLimits").deleteOne({ agentId: testAgent.agentId });
    await db.collection("tweetReplies").deleteMany({ agentId: testAgent.agentId });
    await db.collection("usernameCache").deleteMany({ userId: { $regex: /^test-/ } });

    // Test 1: Max Original Tweet Limit
    console.log(`\nTest 1: Simulating Max Original Tweet Limit (${maxPosts} tweets)`);
    for (let i = 1; i <= maxPosts + 1; i++) {
      const success = await mockPostOriginalTweet(agentToUse, db);
      if (i <= maxPosts && success) successes++;
      else if (i > maxPosts && !success) successes++;
      else {
        console.error(`[Test 1] Failure: Original tweet ${i} expected ${i <= maxPosts ? "success" : "failure"}, got ${success ? "success" : "failure"}`);
        failures++;
      }
    }
    const postLimits = await db.collection("agentDailyLimits").findOne({ agentId: testAgent.agentId });
    console.log(`[Test 1] Tweet count: ${postLimits?.postCount || 0}, Last tweet limit hit: ${postLimits?.lastPostLimitHit?.toISOString() || "none"}`);

    // Test 2: Max Reply Limit
    console.log(`\nTest 2: Simulating Max Tweet Reply Limit (${maxReplies} replies)`);
    for (let i = 1; i <= maxReplies + 1; i++) {
      const tweetId = `tweet-${i}`;
      const success = await mockReplyToTweet(agentToUse, db, tweetId, "user" + i);
      if (i <= maxReplies && success) successes++;
      else if (i > maxReplies && !success) successes++;
      else {
        console.error(`[Test 2] Failure: Reply ${i} expected ${i <= maxReplies ? "success" : "failure"}, got ${success ? "success" : "failure"}`);
        failures++;
      }
    }
    const replyLimits = await db.collection("agentDailyLimits").findOne({ agentId: testAgent.agentId });
    console.log(`[Test 2] Reply count: ${replyLimits?.replyCount || 0}, Last reply limit hit: ${replyLimits?.lastReplyLimitHit?.toISOString() || "none"}`);

    // Test 3: Turning Off Tweet Posting
    console.log("\nTest 3: Turning Off Tweet Posting");
    await db.collection("agents").updateOne({ agentId: testAgent.agentId }, { $set: { enablePostTweet: false } });
    const postSuccessAfterOff = await mockPostOriginalTweet(agentToUse, db);
    if (!postSuccessAfterOff) {
      console.log(`[Test 3] Success: Tweet posting blocked when enablePostTweet is false`);
      successes++;
    } else {
      console.error(`[Test 3] Failure: Tweet posting should be blocked when enablePostTweet is false`);
      failures++;
    }
    await db.collection("agents").updateOne({ agentId: testAgent.agentId }, { $set: { enablePostTweet: true } });

    // Test 4: Turning Off Tweet Replies
    console.log("\nTest 4: Turning Off Tweet Replies");
    await db.collection("agents").updateOne({ agentId: testAgent.agentId }, { $set: { isActive: false } });
    const replySuccessAfterOff = await mockReplyToTweet(agentToUse, db, "tweet-off", "user-off");
    if (!replySuccessAfterOff) {
      console.log(`[Test 4] Success: Tweet replying blocked when isActive is false`);
      successes++;
    } else {
      console.error(`[Test 4] Failure: Tweet replying should be blocked when isActive is false`);
      failures++;
    }
    await db.collection("agents").updateOne({ agentId: testAgent.agentId }, { $set: { isActive: true } });

    // Test 5: Reset Tweet Post Limit After 24 Hours
    console.log("\nTest 5: Reset Tweet Post Limit After 24 Hours");
    const twentyFiveHoursAgo = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await db.collection("agentDailyLimits").updateOne(
      { agentId: testAgent.agentId },
      { $set: { lastPostLimitHit: twentyFiveHoursAgo } }
    );
    const postAfterReset = await mockPostOriginalTweet(agentToUse, db);
    if (postAfterReset) {
      console.log(`[Test 5] Success: Tweet post limit reset after 24 hours`);
      successes++;
    } else {
      console.error(`[Test 5] Failure: Tweet post limit should reset after 24 hours`);
      failures++;
    }
    const resetPostLimits = await db.collection("agentDailyLimits").findOne({ agentId: testAgent.agentId });
    console.log(`[Test 5] Tweet count after reset: ${resetPostLimits?.postCount || 0}, Last tweet limit hit: ${resetPostLimits?.lastPostLimitHit?.toISOString() || "none"}`);

    // Test 6: Reset Tweet Reply Limit After 24 Hours
    console.log("\nTest 6: Reset Tweet Reply Limit After 24 Hours");
    await db.collection("agentDailyLimits").updateOne(
      { agentId: testAgent.agentId },
      { $set: { lastReplyLimitHit: twentyFiveHoursAgo } }
    );
    const replyAfterReset = await mockReplyToTweet(agentToUse, db, "tweet-reset", "user-reset");
    if (replyAfterReset) {
      console.log(`[Test 6] Success: Tweet reply limit reset after 24 hours`);
      successes++;
    } else {
      console.error(`[Test 6] Failure: Tweet reply limit should reset after 24 hours`);
      failures++;
    }
    const resetReplyLimits = await db.collection("agentDailyLimits").findOne({ agentId: testAgent.agentId });
    console.log(`[Test 6] Reply count after reset: ${resetReplyLimits?.replyCount || 0}, Last reply limit hit: ${resetReplyLimits?.lastReplyLimitHit?.toISOString() || "none"}`);

    // Cleanup
    await db.collection("agents").deleteOne({ agentId: testAgent.agentId });
    await db.collection("agentDailyLimits").deleteOne({ agentId: testAgent.agentId });
    await db.collection("tweetReplies").deleteMany({ agentId: testAgent.agentId });
    await db.collection("usernameCache").deleteMany({ userId: { $regex: /^test-/ } });
    await db.collection("users").deleteOne({ userId: "test-user" });
    console.log(`[Test] Cleanup completed: Removed test agent and related data`);

    console.log(`\nTest Summary:`);
    console.log(`Successes: ${successes}`);
    console.log(`Failures: ${failures}`);
    console.log(`Twitter Service Tests Completed.`);

    return { successes, failures };
  } finally {
    await restoreMocks();
  }
}

// Run tests when this file is executed directly
if (require.main === module) {
  runTwitterServiceTests().catch(err => console.error("Test run failed:", err));
}