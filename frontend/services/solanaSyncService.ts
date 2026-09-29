import { Connection, PublicKey, clusterApiUrl } from "@solana/web3.js";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Program configuration
export const PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_PROGRAM_ID || "EjhkjCLXe6aPg1zpSi9ihJemo4JvYVacQzSi8Nbczytp"
);

// 142-byte ListingAccount layout mapping
export enum ListingStatusEnum {
  Listed = 0,
  InEscrow = 1,
  Completed = 2,
  InDispute = 3,
  Cancelled = 4,
}

export const STATUS_MAP: Record<number, string> = {
  0: "Listed",
  1: "InEscrow",
  2: "Completed",
  3: "InDispute",
  4: "Cancelled",
};

export interface DecodedListingAccount {
  seller: string;
  buyer: string | null;
  priceLamports: bigint;
  priceSol: number;
  dataHashHex: string;
  status: string;
  createdAt: number;
  bump: number;
  vaultBump: number;
  escrowStartTime: number;
}

export function decodeListingAccount(buffer: Buffer): DecodedListingAccount | null {
  // Exact on-chain size: 8 (Anchor discriminator) + 124 (data fields) = 132 bytes
  // Fields: 32 (seller) + 1+32 (Option<buyer>) + 8 (price u64) + 32 (data_hash)
  //       + 1 (status) + 8 (created_at i64) + 1 (bump) + 1 (vault_bump) + 8 (escrow_start_time i64)
  const EXPECTED_SIZE = 132;
  if (buffer.length < EXPECTED_SIZE) {
    return null;
  }

  let offset = 8; // Skip 8-byte Anchor discriminator

  // Seller: 32 bytes
  const seller = new PublicKey(buffer.subarray(offset, offset + 32)).toBase58();
  offset += 32;

  // Buyer: 1 byte Option tag + 32 bytes Pubkey
  const hasBuyer = buffer.readUInt8(offset) === 1;
  offset += 1;
  const buyer = hasBuyer ? new PublicKey(buffer.subarray(offset, offset + 32)).toBase58() : null;
  offset += 32;

  // Price: 8 bytes (u64 little endian)
  const priceLamports = buffer.readBigUInt64LE(offset);
  const priceSol = Number(priceLamports) / 1e9;
  offset += 8;

  // Data hash: 32 bytes
  const dataHashHex = buffer.subarray(offset, offset + 32).toString("hex");
  offset += 32;

  // Status: 1 byte enum
  const statusNum = buffer.readUInt8(offset);
  const status = STATUS_MAP[statusNum] || "Unknown";
  offset += 1;

  // Created at: 8 bytes (i64 little endian)
  const createdAt = Number(buffer.readBigInt64LE(offset));
  offset += 8;

  // Bump: 1 byte
  const bump = buffer.readUInt8(offset);
  offset += 1;

  // Vault bump: 1 byte
  const vaultBump = buffer.readUInt8(offset);
  offset += 1;

  // Escrow start time: 8 bytes (i64 little endian)
  const escrowStartTime = Number(buffer.readBigInt64LE(offset));

  return {
    seller,
    buyer,
    priceLamports,
    priceSol,
    dataHashHex,
    status,
    createdAt,
    bump,
    vaultBump,
    escrowStartTime,
  };
}

export class SolanaSyncService {
  private connection: Connection;
  private supabase: SupabaseClient;
  private subscriptionId: number | null = null;
  private isRunning: boolean = false;

  constructor(rpcUrl?: string, supabaseUrl?: string, supabaseKey?: string) {
    const rpc = rpcUrl || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || clusterApiUrl("devnet");
    this.connection = new Connection(rpc, "confirmed");

    const sbUrl = supabaseUrl || process.env.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321";
    const sbKey =
      supabaseKey ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "placeholder-key";

    this.supabase = createClient(sbUrl, sbKey);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[SolanaSyncService] Starting sync for Program ID: ${PROGRAM_ID.toBase58()}`);

    // 1. Initial full reconciliation pass
    try {
      await this.reconcileAllAccounts();
    } catch (err) {
      console.warn(`[SolanaSyncService] Initial reconciliation warning:`, err);
    }

    // 2. Real-time WebSocket account subscription
    try {
      this.subscriptionId = this.connection.onProgramAccountChange(
        PROGRAM_ID,
        async (keyedAccountInfo) => {
          const accountPubkey = keyedAccountInfo.accountId.toBase58();
          const dataBuffer = keyedAccountInfo.accountInfo.data;

          const decoded = decodeListingAccount(Buffer.from(dataBuffer));
          if (!decoded) return;

          console.log(
            `[SolanaSyncService] On-chain update detected: ${accountPubkey} -> Status: ${decoded.status}`
          );
          await this.syncToSupabase(accountPubkey, decoded);
        },
        "confirmed",
        [{ dataSize: 132 }] // Exact on-chain ListingAccount size: 8 disc + 124 data
      );
      console.log(`[SolanaSyncService] WebSocket listener established (SubId: ${this.subscriptionId})`);
    } catch (err) {
      console.error(`[SolanaSyncService] Error starting WebSocket subscription:`, err);
    }
  }

  public async stop(): Promise<void> {
    if (!this.isRunning) return;
    if (this.subscriptionId !== null) {
      await this.connection.removeProgramAccountChangeListener(this.subscriptionId);
      this.subscriptionId = null;
    }
    this.isRunning = false;
    console.log(`[SolanaSyncService] Service stopped.`);
  }

  public async reconcileAllAccounts(): Promise<void> {
    console.log(`[SolanaSyncService] Fetching all program accounts...`);
    const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
      filters: [{ dataSize: 132 }],
    });

    console.log(`[SolanaSyncService] Found ${accounts.length} listing accounts on-chain.`);
    for (const { pubkey, account } of accounts) {
      const decoded = decodeListingAccount(Buffer.from(account.data));
      if (decoded) {
        await this.syncToSupabase(pubkey.toBase58(), decoded);
      }
    }
  }

  private async syncToSupabase(escrowPda: string, account: DecodedListingAccount): Promise<void> {
    try {
      // Find listing by escrow_pda or data_hash
      const { data: existing } = await this.supabase
        .from("listings")
        .select("id, status")
        .or(`escrow_pda.eq.${escrowPda},data_hash.eq.${account.dataHashHex}`)
        .maybeSingle();

      if (existing) {
        // Update status and buyer details
        const updatePayload: Record<string, any> = {
          status: account.status,
          buyer_pubkey: account.buyer,
          escrow_pda: escrowPda,
          price_sol: account.priceSol,
          updated_at: new Date().toISOString(),
        };

        const { error } = await this.supabase
          .from("listings")
          .update(updatePayload)
          .eq("id", existing.id);

        if (error) {
          console.error(`[SolanaSyncService] Failed to update listing ${existing.id}:`, error.message);
        } else {
          console.log(`[SolanaSyncService] Synced listing ${existing.id}: status -> ${account.status}`);
        }
      }
    } catch (err) {
      console.error(`[SolanaSyncService] Database sync exception:`, err);
    }
  }
}

// Export class for server-side initialization only
// Do not export a singleton instance here to prevent browser execution.
// export const solanaSyncService = new SolanaSyncService();

