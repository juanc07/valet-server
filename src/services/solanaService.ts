import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { AGENT_CREATION_SOL_AMOUNT, RECEIVER_PUBLIC_KEY, SOLANA_ENDPOINT, TOKEN_MINT_ADDRESS, AGENT_CREATION_TOKEN_AMOUNT } from "../config";

// Original method kept for backward compatibility
export async function verifySolPayment(txSignature: string, senderWallet: string): Promise<boolean> {
  const connection = new Connection(SOLANA_ENDPOINT, "confirmed");
  const transaction = await connection.getParsedTransaction(txSignature, "confirmed");

  if (!transaction) {
    return false;
  }

  const transferInstruction = transaction.transaction.message.instructions.find(
    (ix: any) =>
      ix.programId.toString() === SystemProgram.programId.toString() &&
      ix.parsed?.type === "transfer" &&
      ix.parsed.info.source === senderWallet &&
      ix.parsed.info.destination === RECEIVER_PUBLIC_KEY.toString() &&
      ix.parsed.info.lamports === AGENT_CREATION_SOL_AMOUNT
  );

  return !!transferInstruction;
}

// New method that accepts a dynamic amount in lamports
export async function verifySolPaymentWithAmount(
  txSignature: string,
  senderWallet: string,
  requiredAmount: number
): Promise<boolean> {
  const connection = new Connection(SOLANA_ENDPOINT, "confirmed");
  const transaction = await connection.getParsedTransaction(txSignature, "confirmed");

  if (!transaction) {
    return false;
  }

  const transferInstruction = transaction.transaction.message.instructions.find(
    (ix: any) =>
      ix.programId.toString() === SystemProgram.programId.toString() &&
      ix.parsed?.type === "transfer" &&
      ix.parsed.info.source === senderWallet &&
      ix.parsed.info.destination === RECEIVER_PUBLIC_KEY.toString() &&
      ix.parsed.info.lamports === requiredAmount
  );

  return !!transferInstruction;
}

// New method to verify custom token payment
export async function verifyTokenPayment(txSignature: string, senderWallet: string): Promise<boolean> {
  try {
    const connection = new Connection(SOLANA_ENDPOINT, "confirmed");
    const transaction = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: 0,
    });

    if (!transaction || !transaction.meta) {
      console.log("Transaction not found or not confirmed yet");
      return false;
    }

    // Get sender's and receiver's Associated Token Accounts (ATAs)
    const senderPublicKey = new PublicKey(senderWallet);
    const senderATA = await getAssociatedTokenAddress(TOKEN_MINT_ADDRESS, senderPublicKey);
    const receiverATA = await getAssociatedTokenAddress(TOKEN_MINT_ADDRESS, RECEIVER_PUBLIC_KEY);

    // Check for token transfer instruction
    const tokenTransferInstruction = transaction.transaction.message.instructions.find(
      (ix: any) =>
        ix.programId.toString() === TOKEN_PROGRAM_ID.toString() &&
        ix.parsed?.type === "transfer" &&
        ix.parsed.info.source === senderATA.toString() &&
        ix.parsed.info.destination === receiverATA.toString() &&
        ix.parsed.info.amount === AGENT_CREATION_TOKEN_AMOUNT.toString()
    );

    if (!tokenTransferInstruction) {
      console.log("No valid token transfer found in transaction");
      return false;
    }

    console.log("Token payment verified successfully");
    return true;
  } catch (error) {
    console.error("Error verifying token payment:", error);
    return false;
  }
}