import dotenv from "dotenv";
import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";

dotenv.config();

export const PORT = process.env.PORT || 3000;
export const SOLANA_PAYMENT_WALLET = process.env.SOLANA_PAYMENT_WALLET || "";
export const SOLANA_ENDPOINT = process.env.SOLANA_ENDPOINT || "https://api.devnet.solana.com";
export const FRONTEND_URL = process.env.FRONTEND_URL;
export const TWITTER_API_MODE = process.env.TWITTER_API_MODE || "free"; // Default to free

export const RECEIVER_PUBLIC_KEY = new PublicKey(SOLANA_PAYMENT_WALLET);
export const AGENT_CREATION_SOL_AMOUNT = 0.2 * LAMPORTS_PER_SOL;