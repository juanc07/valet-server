import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { SOL_AMOUNT, RECEIVER_PUBLIC_KEY, SOLANA_ENDPOINT } from "../config";

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
      ix.parsed.info.lamports === SOL_AMOUNT
  );

  return !!transferInstruction;
}