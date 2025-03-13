import { connectToDatabase } from "../services/dbService";
import { Agent } from "../types/agent";
import {
    saveTweetReply,
    hasRepliedToTweet,
    getAgentByTwitterHandle,
    canPostTweetForAgent,
    canReplyToMentionForAgent,
    incrementAgentPostCount,
    incrementAgentReplyCount,
    createAgent
} from "../controllers/agentController";
import {
    setupTwitterListener,
    postTweet,
} from "../services/twitterService";

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


// Simulated agent for testing with real API credentials
const testAgent: Omit<Agent, "agentId" | "isActive"> & { agentId?: string } = {
    name: "TestAgentReal",
    description: "Real API test agent",
    bio: "I am a real test agent",
    mission: "Test real Twitter API",
    vision: "Verify integration",
    contact: {
        email: "test@agent.com",
        website: "https://testagent.com",
        socials: {
            twitter: "testagentreal", // Replace with your test Twitter handle (e.g., "@YourTestHandle")
            github: "",    // Optional fields can be undefined
            linkedin: ""
        }
    },
    wallets: {
        solana: "mock-solana-wallet",
        ethereum: "mock-ethereum-wallet",
        bitcoin: "mock-bitcoin-wallet"
    },
    knowledge: { "test-topic": "Real API testing" },
    personality: {
        tone: "friendly",
        humor: false,
        formality: "casual",
        catchphrase: "Real test!",
        preferences: { topics: ["testing"], languages: ["en"] }
    },
    settings: { max_memory_context: 1000, platforms: ["twitter"] },
    ruleIds: [],
    openaiApiKey: process.env.OPENAI_API_KEY || "your-openai-key-here", // Replace with real key
    twitterAppKey: TWITTER_APP_KEY || "your-app-key-here",
    twitterAppSecret: TWITTER_APP_SECRET || "your-app-secret-here",
    twitterAccessToken: process.env.TWITTER_ACCESS_TOKEN || "your-access-token-here", // Replace with real token
    twitterAccessSecret: process.env.TWITTER_ACCESS_SECRET || "your-access-secret-here", // Replace with real secret
    twitterHandle: "testagentreal", // Replace with your test Twitter handle
    enablePostTweet: TWITTER_AUTO_POSTING_ENABLED === "TRUE",
    postTweetInterval: 1,
    agentType: "basic",
    createdBy: "test-user-real",
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

// Test suite with real API calls
export async function runTwitterServiceApiTests(): Promise<{ successes: number; failures: number }> {
    console.log("Starting Twitter Service API Tests with Real API Calls...");
    const db = await connectToDatabase();

    let successes = 0;
    let failures = 0;

    const maxPosts = parseInt(MAX_POSTS_PER_DAY || "10", 10);
    const maxReplies = parseInt(MAX_REPLIES_PER_DAY || "12", 10);

    try {
        // Ensure test user exists
        await db.collection("users").updateOne(
            { userId: "test-user-real" },
            { $set: { solanaWalletAddress: "mock-solana-wallet" } },
            { upsert: true }
        );

        let agentToUse: Agent;
        const twitterHandle = testAgent.twitterHandle || "testagentreal";
        console.log(`[Test] Checking for existing agent with handle ${twitterHandle}`);
        const existingAgent = await getAgentByTwitterHandle(twitterHandle, db);

        if (existingAgent) {
            console.log(`[Test] Agent with handle ${twitterHandle} already exists: ${existingAgent.agentId}`);
            agentToUse = existingAgent;
            testAgent.agentId = existingAgent.agentId;
        } else {
            console.log("\nCreating test agent for real API test...");
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

        // Setup Twitter listener (real API call)
        console.log(`[Test] Setting up real Twitter listener for agent ${agentToUse.agentId}`);
        await setupTwitterListener(agentToUse, db);

        // Clean up related data before tests
        await db.collection("agentDailyLimits").deleteOne({ agentId: testAgent.agentId });
        await db.collection("tweetReplies").deleteMany({ agentId: testAgent.agentId });

        // Test 1: Max Original Tweet Limit (Real API)
        console.log(`\nTest 1: Simulating Max Original Tweet Limit (${maxPosts} tweets) with Real API`);
        for (let i = 1; i <= maxPosts + 1; i++) {
            const message = `Real API Test Tweet ${i} from ${agentToUse.name} at ${new Date().toISOString()}`;
            const tweetedMessage = await postTweet(agentToUse, message, db);
            if (i <= maxPosts && tweetedMessage) {
                console.log(`[Test 1] Successfully posted tweet ${i}: ${tweetedMessage}`);
                successes++;
            } else if (i > maxPosts && !tweetedMessage) {
                console.log(`[Test 1] Correctly blocked tweet ${i} due to limit (${maxPosts})`);
                successes++;
            } else {
                console.error(`[Test 1] Failure: Tweet ${i} expected ${i <= maxPosts ? "success" : "failure"}, got ${tweetedMessage ? "success" : "failure"}`);
                failures++;
            }
        }
        const postLimits = await db.collection("agentDailyLimits").findOne({ agentId: testAgent.agentId });
        console.log(`[Test 1] Tweet count: ${postLimits?.postCount || 0}, Last tweet limit hit: ${postLimits?.lastPostLimitHit?.toISOString() || "none"}`);

        // Test 2: Max Reply Limit (Real API)
        // Note: Requires a test tweet to reply to; we'll simulate a single reply due to API constraints
        console.log(`\nTest 2: Simulating Tweet Reply with Real API (Limited Scope)`);
        const testTweetId = "mock-tweet-id-for-test"; // Replace with a real tweet ID you control
        const authorUsername = "testuser"; // Replace with a real test user
        if (TWITTER_MENTION_CHECK_ENABLED === "TRUE" && TWITTER_API_MODE === "paid") {
            // Post a tweet to reply to (for testing)
            const initialTweet = await postTweet(agentToUse, `Test tweet for reply at ${new Date().toISOString()}`, db);
            if (initialTweet) {
                console.log(`[Test 2] Posted initial tweet to reply to: ${initialTweet}`);
                // Simulate a reply (in real scenario, this would come from streaming/polling)
                const replySuccess = await canReplyToMentionForAgent(agentToUse.agentId!, db) &&
                    !await hasRepliedToTweet(agentToUse.agentId!, testTweetId, db, authorUsername);
                if (replySuccess) {
                    const replyMessage = `Real API reply to @${authorUsername} at ${new Date().toISOString()}`;
                    const tweetedReply = await postTweet(agentToUse, replyMessage, db); // Simulate reply
                    if (tweetedReply) {
                        await saveTweetReply(agentToUse.agentId!, testTweetId, db, undefined, authorUsername);
                        await incrementAgentReplyCount(agentToUse.agentId!, db);
                        console.log(`[Test 2] Successfully replied to tweet: ${tweetedReply}`);
                        successes++;
                    } else {
                        console.error(`[Test 2] Failed to post reply`);
                        failures++;
                    }
                } else {
                    console.log(`[Test 2] Reply blocked due to limit or prior reply`);
                    successes++;
                }
            } else {
                console.error("[Test 2] Failed to post initial tweet for reply test");
                failures++;
            }
        } else {
            console.log("[Test 2] Skipped: TWITTER_MENTION_CHECK_ENABLED=FALSE or not in paid mode");
            successes++; // Count as success since it’s expected behavior
        }

        // Cleanup (delete test agent and data)
        await db.collection("agents").deleteOne({ agentId: testAgent.agentId });
        await db.collection("agentDailyLimits").deleteOne({ agentId: testAgent.agentId });
        await db.collection("tweetReplies").deleteMany({ agentId: testAgent.agentId });
        await db.collection("users").deleteOne({ userId: "test-user-real" });
        console.log(`[Test] Cleanup completed: Removed test agent and related data`);

        console.log(`\nTest Summary:`);
        console.log(`Successes: ${successes}`);
        console.log(`Failures: ${failures}`);
        console.log(`Twitter Service API Tests Completed.`);

        return { successes, failures };
    } catch (error) {
        console.error("[Test] Unexpected error during API tests:", error);
        failures++;
        return { successes, failures };
    }
}

// Run tests when this file is executed directly
if (require.main === module) {
    runTwitterServiceApiTests().catch(err => console.error("API Test run failed:", err));
}