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
 * Runs simulateTransaction via RPC and throws a human-readable error
 * if the simulation fails. This surfaces real Anchor error codes BEFORE
 * Phantom gets a chance to show its generic "Unexpected error".
 */
async function simulateAndCheck(
  connection: Connection,
  tx: VersionedTransaction
): Promise<void> {
  const { value: simResult } = await connection.simulateTransaction(tx, {
    commitment: "confirmed",
  });

  if (simResult.err) {
    // Try to extract Anchor custom error code from logs
    const logs = simResult.logs ?? [];
    const anchorLog = logs.find(
      (l) =>
        l.includes("custom program error") ||
        l.includes("AnchorError") ||
        l.includes("Error Number")
    );

    if (anchorLog) {
      // Extract readable message
      throw new Error(`Simulation failed: ${anchorLog}`);
    }

    // Check for common error patterns in logs
    const failLog = logs.find((l) => l.includes("failed:") || l.includes("Error:"));
    if (failLog) {
      throw new Error(`Simulation failed: ${failLog}`);
    }

    throw new Error(
      `Transaction simulation failed: ${JSON.stringify(simResult.err)}\n\nLogs:\n${logs.slice(-5).join("\n")}`
    );
  }
}

/**
 * Helper function to create and send a VersionedTransaction via wallet adapter.
 *
 * - Fetches a fresh blockhash on every attempt (prevents expired blockhash errors).
 * - Runs RPC simulation FIRST to surface real Anchor errors before Phantom.
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

  // ── Step 1: RPC Simulation (once, before any Phantom interaction) ──────────
  // This runs BEFORE asking Phantom to sign, so we get real Anchor error codes
  // instead of Phantom's generic "Unexpected error".
  try {
    const simBlockhash = await connection.getLatestBlockhash("confirmed");
    const simMessage = new TransactionMessage({
      payerKey: publicKey,
      recentBlockhash: simBlockhash.blockhash,
      instructions: allInstructions,
    }).compileToV0Message();
    const simTx = new VersionedTransaction(simMessage);
    await simulateAndCheck(connection, simTx);
  } catch (simErr: any) {
    // Surface simulation errors immediately — no point asking Phantom to sign
    throw simErr;
  }

  // ── Step 2: Send via Phantom (skipPreflight=true since we already simulated) ─
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

      // skipPreflight: true — we already simulated above, avoid double simulation
      const signature = await sendTransaction(tx, connection, {
        skipPreflight: true,
        preflightCommitment: "confirmed",
      });

      return { signature, latestBlockhash };
    } catch (err: any) {
      lastErr = err;
      const msg = (err?.message || "").toLowerCase();

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
