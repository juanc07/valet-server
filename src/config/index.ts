import dotenv from "dotenv";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

dotenv.config();

export const PORT = process.env.PORT || 3000;
export const SOLANA_PAYMENT_WALLET = process.env.SOLANA_PAYMENT_WALLET || "";
export const SOLANA_ENDPOINT = process.env.SOLANA_ENDPOINT || "https://api.devnet.solana.com";
export const FRONTEND_URL = process.env.FRONTEND_URL;

// twitter things
export const TWITTER_API_MODE = process.env.TWITTER_API_MODE || "free"; // Default to free
export const TWITTER_APP_KEY = process.env.TWITTER_APP_KEY;
export const TWITTER_APP_SECRET = process.env.TWITTER_APP_SECRET;
export const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
export const TWITTER_INTEGRATION = process.env.TWITTER_INTEGRATION;


// related to twitter mentions
export const MENTION_POLL_MIN_MINUTES = process.env.MENTION_POLL_MIN_MINUTES;
export const MENTION_POLL_MAX_MINUTES = process.env.MENTION_POLL_MAX_MINUTES;
export const AGENT_REPLY_LIMIT = process.env.AGENT_REPLY_LIMIT;
export const AGENT_REPLY_COOLDOWN_HOURS = process.env.AGENT_REPLY_COOLDOWN_HOURS;
export const TWITTER_MENTION_CHECK_ENABLED = process.env.TWITTER_MENTION_CHECK_ENABLED;
export const TWITTER_AUTO_POSTING_ENABLED = process.env.TWITTER_AUTO_POSTING_ENABLED;

export const MAX_POSTS_PER_DAY = process.env.MAX_POSTS_PER_DAY;
export const MAX_REPLIES_PER_DAY = process.env.MAX_REPLIES_PER_DAY;


export const RECEIVER_PUBLIC_KEY = new PublicKey(SOLANA_PAYMENT_WALLET);
export const AGENT_CREATION_SOL_AMOUNT = 0.2 * LAMPORTS_PER_SOL;