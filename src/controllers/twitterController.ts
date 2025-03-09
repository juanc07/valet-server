import { Request, Response, RequestHandler } from "express";
import { TwitterApi } from "twitter-api-v2";
import { connectToDatabase } from "../services/dbService";
import { postTweet } from "../services/twitterService";
import { Agent } from "../types/agent";
import { FRONTEND_URL } from "../config";


interface AgentParams {
  agentId: string;
}

const twitterClient = new TwitterApi({
  appKey: process.env.TWITTER_APP_KEY!,
  appSecret: process.env.TWITTER_APP_SECRET!,
});

export const initiateTwitterOAuth: RequestHandler = async (req, res) => {
  console.log("1st Initiating Twitter OAuth");
  try {
    const { agentId } = req.body;
    if (!agentId) {
      console.log("2nd Initiating Twitter OAuth");
      res.status(400).json({ error: "Agent ID is required" });
      return;
    }

    console.log("Initiating Twitter OAuth for agentId:", agentId);
    console.log("Twitter App Key:", process.env.TWITTER_APP_KEY);
    console.log("Twitter App Secret:", process.env.TWITTER_APP_SECRET);
    console.log("Callback URL:", `${process.env.API_BASE_URL}/twitter/oauth/callback`);

    const authLink = await twitterClient.generateAuthLink(`${process.env.API_BASE_URL}/twitter/oauth/callback`, {
      linkMode: "authorize",
    });

    // Type assertion for session
    const session = req.session as typeof req.session & {
      oauthToken?: string;
      oauthTokenSecret?: string;
      agentId?: string;
      test?: string;
    };
    session.oauthToken = authLink.oauth_token;
    session.oauthTokenSecret = authLink.oauth_token_secret;
    session.agentId = agentId;

    console.log("3rd Initiating Twitter OAuth");
    res.json({ redirectUrl: authLink.url });
  } catch (error) {
    console.log("4th Initiating Twitter OAuth");
    console.error("OAuth initiation error:", error);
    res.status(500).json({ error: "Failed to initiate Twitter OAuth" });
  }
};

// twitterController.ts
export const completeTwitterOAuth: RequestHandler = async (req, res) => {
  const { oauth_token, oauth_verifier } = req.query as { [key: string]: string | undefined };
  
  const session = req.session as typeof req.session & {
    oauthToken?: string;
    oauthTokenSecret?: string;
    agentId?: string;
    test?: string;
  };
  const { oauthTokenSecret, agentId } = session || {};

  if (!oauth_token || !oauth_verifier || !oauthTokenSecret || !agentId) {
    res.status(400).json({ error: "Missing OAuth parameters or agentId" });
    return;
  }

  try {
    const client = new TwitterApi({
      appKey: process.env.TWITTER_APP_KEY!,
      appSecret: process.env.TWITTER_APP_SECRET!,
      accessToken: oauth_token,
      accessSecret: oauthTokenSecret,
    });

    const { accessToken, accessSecret, screenName } = await client.login(oauth_verifier);

    const db = await connectToDatabase();
    await db.collection("agents").updateOne(
      { agentId },
      { $set: { twitterAccessToken: accessToken, twitterAccessSecret: accessSecret, twitterHandle: screenName } }
    );

    delete session.oauthToken;
    delete session.oauthTokenSecret;
    delete session.agentId;

    // Redirect to frontend port
    res.redirect(`${FRONTEND_URL}/agent/edit/${agentId}?oauth_callback=true`);
  } catch (error) {
    console.error("OAuth callback error:", error);
    res.status(500).json({ error: "Failed to complete Twitter OAuth" });
  }
};

export const postTweetManually = async (req: Request<AgentParams>, res: Response) => {
  try {
    const db = await connectToDatabase();
    const agentId = req.params.agentId;
    const { message } = req.body;

    const agent = await db.collection("agents").findOne({ agentId }) as Agent | null;
    if (!agent) {
      res.status(404).json({ error: "Agent not found" });
      return;
    }

    const tweetedMessage = await postTweet(agent, message);
    res.status(200).json({ message: "Tweet posted successfully", tweetedMessage });
  } catch (error) {
    console.error(`Error posting tweet manually for agent ${req.params.agentId}:`, error);
    res.status(500).json({ error: "Failed to post tweet" });
  }
};