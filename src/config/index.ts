import dotenv from "dotenv";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

dotenv.config();

export const PORT = process.env.PORT || 3000;
export const SOLANA_PAYMENT_WALLET = process.env.SOLANA_PAYMENT_WALLET || "";
export const SOLANA_ENDPOINT = process.env.SOLANA_ENDPOINT || "https://api.mainnet-beta.solana.com";
export const FRONTEND_URL = process.env.FRONTEND_URL;

// Twitter configurations
export const TWITTER_API_MODE = process.env.TWITTER_API_MODE || "free"; // Default to free
export const TWITTER_APP_KEY = process.env.TWITTER_APP_KEY;
export const TWITTER_APP_SECRET = process.env.TWITTER_APP_SECRET;
export const TWITTER_BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;
export const TWITTER_INTEGRATION = process.env.TWITTER_INTEGRATION;

// Related to Twitter mentions
export const MENTION_POLL_MIN_MINUTES = process.env.MENTION_POLL_MIN_MINUTES;
export const MENTION_POLL_MAX_MINUTES = process.env.MENTION_POLL_MAX_MINUTES;
export const AGENT_REPLY_LIMIT = process.env.AGENT_REPLY_LIMIT;
export const AGENT_REPLY_COOLDOWN_HOURS = process.env.AGENT_REPLY_COOLDOWN_HOURS;
export const TWITTER_MENTION_CHECK_ENABLED = process.env.TWITTER_MENTION_CHECK_ENABLED;

// Twitter posting
export const TWITTER_AUTO_POSTING_ENABLED = process.env.TWITTER_AUTO_POSTING_ENABLED;
export const TWITTER_AUTO_POSTING_MIN_INTERVAL = process.env.TWITTER_AUTO_POSTING_MIN_INTERVAL;

export const MAX_POSTS_PER_DAY = process.env.MAX_POSTS_PER_DAY;
export const MAX_REPLIES_PER_DAY = process.env.MAX_REPLIES_PER_DAY;

// Solana payment configurations
export const RECEIVER_PUBLIC_KEY = new PublicKey(SOLANA_PAYMENT_WALLET);
export const AGENT_CREATION_SOL_AMOUNT = 0.01 * LAMPORTS_PER_SOL;

// Custom token configurations
export const TOKEN_MINT_ADDRESS = new PublicKey(process.env.VALET_TOKEN_ADDRESS || "2ex5kxL5ZKSxv6mJHf5EiM86ZYCGJp56JY1MjKrgpump"); // Use env variable with fallback
export const AGENT_CREATION_TOKEN_AMOUNT = 1000 * Math.pow(10, 6); // 1000 tokens with 6 decimals

//telegram
export const MAX_TELEGRAM_REPLIES_PER_DAY = process.env.MAX_TELEGRAM_REPLIES_PER_DAY || '12';