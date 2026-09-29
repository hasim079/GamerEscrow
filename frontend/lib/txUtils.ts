import {
  Connection,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  ComputeBudgetProgram,
  BlockhashWithExpiryBlockHeight,
} from "@solana/web3.js";

const RETRY_DELAY_MS = 800;
const MAX_ATTEMPTS = 3;

/**
 * Helper function to create and send a VersionedTransaction via wallet adapter.
 *
 * - Fetches a fresh blockhash on every attempt (prevents expired blockhash errors).
 * - Automatically retries up to MAX_ATTEMPTS for Phantom port disconnect errors.
 * - Automatically prepends Compute Budget instructions.
 *
 * IMPORTANT: sendTransaction must be the Wallet Adapter's sendTransaction —
 * this function sends the transaction without signing it; the wallet handles signing.
 */
export async function buildAndSendVersionedTx(
  connection: Connection,
  publicKey: PublicKey,
  sendTransaction: (
    tx: VersionedTransaction,
    conn: Connection,
    options?: { skipPreflight?: boolean; preflightCommitment?: string }
  ) => Promise<string>,
  instructions: TransactionInstruction[],
  computeUnits = 300_000
): Promise<{ signature: string; latestBlockhash: BlockhashWithExpiryBlockHeight }> {
  if (!publicKey) {
    throw new Error("Wallet not connected. Please connect your wallet first.");
  }
  if (!instructions || instructions.length === 0) {
    throw new Error("No instructions provided to buildAndSendVersionedTx.");
  }

  const computeIx = ComputeBudgetProgram.setComputeUnitLimit({
    units: computeUnits,
  });

  // Add priority fee - for transaction priority on devnet/mainnet
  const priorityFeeIx = ComputeBudgetProgram.setComputeUnitPrice({
    microLamports: 1_000, // 0.001 lamport/CU — low priority fee
  });

  const allInstructions = [computeIx, priorityFeeIx, ...instructions];

  let lastErr: any = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      // Fresh blockhash on every attempt — no expired blockhash on retry
      const latestBlockhash = await connection.getLatestBlockhash("confirmed");

      const messageV0 = new TransactionMessage({
        payerKey: publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: allInstructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(messageV0);

      // skipPreflight: false → catch errors during simulation phase
      const signature = await sendTransaction(tx, connection, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });

      return { signature, latestBlockhash };
    } catch (err: any) {
      lastErr = err;
      const msg = (err?.message || "").toLowerCase();

      // Throw simulation error directly — do not retry
      if (
        msg.includes("simulation failed") ||
        msg.includes("transaction simulation") ||
        msg.includes("custom program error") ||
        msg.includes("0x") // Anchor custom error hex code
      ) {
        throw err;
      }

      // User rejection → throw directly
      if (msg.includes("rejected") || msg.includes("user denied")) {
        throw err;
      }

      // Phantom port/disconnect error → retry
      if (
        msg.includes("disconnected") ||
        msg.includes("failed to send message") ||
        msg.includes("unexpected error") ||
        msg.includes("port")
      ) {
        console.warn(
          `[TX] Phantom port error, retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`
        );
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        continue;
      }

      // Other errors → throw directly
      throw err;
    }
  }

  throw (
    lastErr ||
    new Error(
      "Transaction could not be sent after 3 attempts. Please open Phantom and try again."
    )
  );
}
