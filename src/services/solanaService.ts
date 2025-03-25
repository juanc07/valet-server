import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from "@solana/spl-token";
import { AGENT_CREATION_SOL_AMOUNT, RECEIVER_PUBLIC_KEY, SOLANA_ENDPOINT, TOKEN_MINT_ADDRESS, AGENT_CREATION_TOKEN_AMOUNT } from "../config";

// Original method kept for backward compatibility
export async function verifySolPayment(txSignature: string, senderWallet: string): Promise<boolean> {
  const connection = new Connection(SOLANA_ENDPOINT, "confirmed");
  const transaction = await connection.getParsedTransaction(txSignature, "confirmed");

  if (!transaction) {
    console.log(`Transaction ${txSignature} not found or not confirmed`);
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

// Verify SOL payment with dynamic amount
export async function verifySolPaymentWithAmount(
  txSignature: string,
  senderWallet: string,
  requiredAmount: number
): Promise<boolean> {
  try {
    console.log("Verifying SOL payment with SOLANA_ENDPOINT:", SOLANA_ENDPOINT);
    console.log("Transaction signature:", txSignature);
    console.log("Sender wallet:", senderWallet);
    console.log("Required amount (lamports):", requiredAmount);

    const connection = new Connection(SOLANA_ENDPOINT, "confirmed");
    const transaction = await connection.getParsedTransaction(txSignature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: undefined, // Support all transaction versions
    });

    if (!transaction || !transaction.meta) {
      console.log("Transaction not found or not confirmed yet:", transaction);
      return false;
    }

    // Log full transaction instructions for debugging
    console.log("Transaction instructions:", JSON.stringify(transaction.transaction.message.instructions, null, 2));

    const transferInstruction = transaction.transaction.message.instructions.find(
      (ix: any) =>
        ix.programId.toString() === SystemProgram.programId.toString() &&
        ix.parsed?.type === "transfer" &&
        ix.parsed.info.source === senderWallet &&
        ix.parsed.info.destination === RECEIVER_PUBLIC_KEY.toString() &&
        ix.parsed.info.lamports === requiredAmount
    );

    if (!transferInstruction) {
      console.log("No valid SOL transfer found in transaction. Expected conditions not met.");
      return false;
    }

    console.log("SOL payment verified successfully:", JSON.stringify(transferInstruction, null, 2));
    return true;
  } catch (error) {
    console.error("Error verifying SOL payment:", error);
    return false;
  }
}

// Verify custom token payment with enhanced debugging
export async function verifyTokenPayment(txSignature: string, senderWallet: string): Promise<boolean> {
  try {
    console.log("Verifying token payment with SOLANA_ENDPOINT:", SOLANA_ENDPOINT);
    console.log("Transaction signature:", txSignature);
    console.log("Sender wallet:", senderWallet);
    const connection = new Connection(SOLANA_ENDPOINT, "confirmed");
    const transaction = await connection.getParsedTransaction(txSignature, {
      maxSupportedTransactionVersion: undefined, // Support all transaction versions
    });

    if (!transaction || !transaction.meta) {
      console.log("Transaction not found or not confirmed yet:", transaction);
      return false;
    }

    console.log("Transaction instructions:", JSON.stringify(transaction.transaction.message.instructions, null, 2));

    const senderPublicKey = new PublicKey(senderWallet);
    const senderATA = await getAssociatedTokenAddress(TOKEN_MINT_ADDRESS, senderPublicKey);
    const receiverATA = await getAssociatedTokenAddress(TOKEN_MINT_ADDRESS, RECEIVER_PUBLIC_KEY);

    console.log("Expected senderATA:", senderATA.toString());
    console.log("Expected receiverATA:", receiverATA.toString());
    console.log("Expected amount:", AGENT_CREATION_TOKEN_AMOUNT.toString());

    const tokenTransferInstruction = transaction.transaction.message.instructions.find(
      (ix: any) =>
        ix.programId.toString() === TOKEN_PROGRAM_ID.toString() &&
        ix.parsed?.info?.source === senderATA.toString() &&
        ix.parsed?.info?.destination === receiverATA.toString() &&
        ix.parsed?.info?.amount === AGENT_CREATION_TOKEN_AMOUNT.toString()
    );

    if (!tokenTransferInstruction) {
      console.log("No valid token transfer found in transaction. Expected conditions not met.");
      return false;
    }

    console.log("Token payment verified successfully:", JSON.stringify(tokenTransferInstruction, null, 2));
    return true;
  } catch (error) {
    console.error("Error verifying token payment:", error);
    return false;
  }
}