import { PublicKey } from "@solana/web3.js";

// ─── Program & PDA Seeds ─────────────────────────────────────────────────────
export const PROGRAM_ID_STR =
  process.env.NEXT_PUBLIC_PROGRAM_ID ||
  "EjhkjCLXe6aPg1zpSi9ihJemo4JvYVacQzSi8Nbczytp";

export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

// Seeds MUST match Rust constants.rs exactly (b"listing", b"vault")
export const LISTING_SEED = Buffer.from("listing");
export const VAULT_SEED = Buffer.from("vault");

// ─── Admin ───────────────────────────────────────────────────────────────────
export const ADMIN_PUBKEY_STR =
  process.env.NEXT_PUBLIC_ADMIN_PUBKEY ||
  "3trynVPFszVYU4UavqhUJpe1RyhkV5icAcmJ77mArNzP";

export const ADMIN_PUBKEY = new PublicKey(ADMIN_PUBKEY_STR);

// ─── Storage Buckets ─────────────────────────────────────────────────────────
/** Supabase storage bucket for dispute evidence files. */
export const DISPUTE_BUCKET = "dispute-evidence" as const;
