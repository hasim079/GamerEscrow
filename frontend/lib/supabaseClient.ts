import { createClient, SupabaseClient } from "@supabase/supabase-js";
import bs58 from "bs58";
import { buildChallengeMessage, generateNonce } from "./crypto";
import { DISPUTE_BUCKET } from "./constants";

export { DISPUTE_BUCKET };

// ─── Environment ─────────────────────────────────────────────────────────────
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are required."
  );
}

// ─── Types ───────────────────────────────────────────────────────────────────
export interface ListingRecord {
  id: string;
  seller_pubkey: string;
  buyer_pubkey: string | null;
  title: string;
  game: string;
  game_slug?: string;
  category?: string;
  image?: string;
  image_url?: string;
  price_sol: number;
  price_usd?: number;
  data_hash: string;
  encrypted_credentials?: string;
  encryption_iv?: string;
  status:
    | "Draft"
    | "Listed"
    | "InEscrow"
    | "Completed"
    | "InDispute"
    | "Cancelled";
  escrow_pda?: string;
  vault_pda?: string;
  tags?: string[];
  rank?: string;
  description?: string;
  created_at?: string;
  updated_at?: string;
}

export interface DisputeRecord {
  id: string;
  listing_id: string;
  initiator_pubkey: string;
  reason: string;
  details?: string;
  evidence_urls?: string[];
  seller_response?: string;
  seller_evidence_urls?: string[];
  status:
    | "Open"
    | "UnderReview"
    | "Resolved_Refunded"
    | "Resolved_Released"
    | "Dismissed";
  resolution?: string;
  resolved_by?: string;
  created_at?: string;
  updated_at?: string;
}

// ─── Singleton Supabase Client ────────────────────────────────────────────────
/**
 * Global singleton — only ONE GoTrueClient instance is created.
 * auth.persistSession: false because we use wallet-based JWT, not Supabase Auth sessions.
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: false },
});

// ─── JWT Token Helpers ────────────────────────────────────────────────────────
/**
 * Reads the stored JWT from localStorage and checks if it is still valid.
 * Returns null if missing or expired.
 */
export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  const token = localStorage.getItem("gamer_escrow_jwt");
  if (!token) return null;

  try {
    const [, payloadB64] = token.split(".");
    const payload = JSON.parse(atob(payloadB64));
    // Treat as invalid 60 seconds before actual expiry (clock-skew tolerance)
    if (payload.exp && payload.exp > Math.floor(Date.now() / 1000) + 60) {
      return token;
    }
  } catch {
    // malformed token
  }

  // Token is expired or malformed — clean up
  localStorage.removeItem("gamer_escrow_jwt");
  return null;
}

/**
 * Returns a Supabase client with the user's JWT injected for RLS.
 * Creates a new client instance only when a valid token exists.
 * Falls back to the public singleton when there is no valid token.
 */
export function getAuthClient(jwtToken?: string): SupabaseClient {
  const token = jwtToken ?? getStoredToken();

  if (!token) return supabase;

  // A new client is required to override the Authorization header.
  // persistSession: false ensures no additional GoTrueClient state is created.
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
}

// ─── Listings ─────────────────────────────────────────────────────────────────

/** Fetch all publicly available listings currently listed in the marketplace. */
export async function fetchMarketplaceListings(): Promise<ListingRecord[]> {
  try {
    const { data, error } = await supabase
      .from("listings")
      .select("*")
      .eq("status", "Listed")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[supabase] fetchMarketplaceListings:", error.message);
      return [];
    }
    return (data as ListingRecord[]) || [];
  } catch (err) {
    console.error("[supabase] fetchMarketplaceListings exception:", err);
    return [];
  }
}

/** Fetch all listings belonging to a specific seller. */
export async function fetchSellerListings(
  sellerPubkey: string
): Promise<ListingRecord[]> {
  try {
    const client = getAuthClient();
    const { data, error } = await client
      .from("listings")
      .select("*")
      .eq("seller_pubkey", sellerPubkey)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[supabase] fetchSellerListings:", error.message);
      return [];
    }
    return (data as ListingRecord[]) || [];
  } catch (err) {
    console.error("[supabase] fetchSellerListings exception:", err);
    return [];
  }
}

/** Fetch all orders for a buyer wallet. */
export async function fetchBuyerOrders(
  buyerPubkey: string
): Promise<ListingRecord[]> {
  try {
    const client = getAuthClient();
    const { data, error } = await client
      .from("listings")
      .select("*")
      .eq("buyer_pubkey", buyerPubkey)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[supabase] fetchBuyerOrders:", error.message);
      return [];
    }
    return (data as ListingRecord[]) || [];
  } catch (err) {
    console.error("[supabase] fetchBuyerOrders exception:", err);
    return [];
  }
}

/** Fetch a single listing by its primary ID. */
export async function fetchListingById(
  id: string
): Promise<ListingRecord | null> {
  try {
    const client = getAuthClient();
    const { data, error } = await client
      .from("listings")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.warn("[supabase] fetchListingById:", error.message);
      return null;
    }
    return data as ListingRecord;
  } catch (err) {
    console.error("[supabase] fetchListingById exception:", err);
    return null;
  }
}

/** Create a new listing record in Supabase. */
export async function createListingRecord(
  payload: Omit<ListingRecord, "id" | "created_at" | "updated_at">
): Promise<ListingRecord | null> {
  try {
    const client = getAuthClient();
    const { data, error } = await client
      .from("listings")
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("[supabase] createListingRecord:", error.message);
      return null;
    }
    return data as ListingRecord;
  } catch (err) {
    console.error("[supabase] createListingRecord exception:", err);
    return null;
  }
}

/** Delete a listing record via the trusted backend API route. */
export async function deleteListingRecord(
  id: string,
  sellerPubkey: string
): Promise<boolean> {
  try {
    const res = await fetch("/api/delete-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, seller_pubkey: sellerPubkey }),
    });
    const data = await res.json();
    if (!data.success) {
      console.error("[API] deleteListingRecord:", data.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[API] deleteListingRecord network error:", err);
    return false;
  }
}

/**
 * Update the status of a listing via the trusted backend API route.
 * Uses service_role key server-side to bypass RLS.
 */
export async function updateListingStatus(
  id: string,
  status: ListingRecord["status"],
  buyerPubkey?: string,
  vaultPda?: string
): Promise<boolean> {
  try {
    const res = await fetch("/api/update-listing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status, buyerPubkey, vaultPda }),
    });
    const data = await res.json();
    if (!data.success) {
      console.error("[API] updateListingStatus:", data.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[API] updateListingStatus network error:", err);
    return false;
  }
}

/** Check if a wallet address is in the admin whitelist. */
export async function checkIsAdmin(walletPubkey: string): Promise<boolean> {
  if (!walletPubkey) return false;
  try {
    const cleanPubkey = walletPubkey.trim();
    const { data, error } = await supabase
      .from("admin_whitelist")
      .select("role")
      .eq("wallet_pubkey", cleanPubkey)
      .maybeSingle();

    if (error) {
      console.warn("[supabase] checkIsAdmin:", error.message);
      return false;
    }
    return !!data;
  } catch (err) {
    console.error("[supabase] checkIsAdmin exception:", err);
    return false;
  }
}

// ─── Disputes ─────────────────────────────────────────────────────────────────

/** Fetch disputes. Admin=true fetches all; otherwise user-related only. */
export async function fetchDisputes(
  walletPubkey?: string,
  isAdmin: boolean = false
): Promise<DisputeRecord[]> {
  try {
    const client = getAuthClient();
    let query = client.from("disputes").select("*, listings(*)");

    if (!isAdmin && walletPubkey) {
      query = query.eq("initiator_pubkey", walletPubkey);
    }

    const { data, error } = await query.order("created_at", {
      ascending: false,
    });
    if (error) {
      console.warn("[supabase] fetchDisputes:", error.message);
      return [];
    }
    return (data as DisputeRecord[]) || [];
  } catch (err) {
    console.error("[supabase] fetchDisputes exception:", err);
    return [];
  }
}

/** Create a new dispute record directly (uses authenticated client). */
export async function createDisputeRecord(
  payload: Omit<DisputeRecord, "id" | "created_at" | "updated_at">
): Promise<DisputeRecord | null> {
  try {
    const client = getAuthClient();
    const { data, error } = await client
      .from("disputes")
      .insert([payload])
      .select()
      .single();

    if (error) {
      console.error("[supabase] createDisputeRecord:", error.message);
      return null;
    }
    return data as DisputeRecord;
  } catch (err) {
    console.error("[supabase] createDisputeRecord exception:", err);
    return null;
  }
}

/** Update a dispute with seller's response and evidence. */
export async function updateDisputeSellerResponse(
  disputeId: string,
  sellerResponse: string,
  sellerEvidenceUrls?: string[]
): Promise<boolean> {
  try {
    const client = getAuthClient();
    const { error } = await client
      .from("disputes")
      .update({
        seller_response: sellerResponse,
        seller_evidence_urls: sellerEvidenceUrls || [],
        status: "UnderReview",
      })
      .eq("id", disputeId);

    if (error) {
      console.error("[supabase] updateDisputeSellerResponse:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[supabase] updateDisputeSellerResponse exception:", err);
    return false;
  }
}

/** Fetch the most recent dispute for a specific listing. */
export async function fetchDisputesByListing(
  listingId: string
): Promise<DisputeRecord | null> {
  try {
    const client = getAuthClient();
    const { data, error } = await client
      .from("disputes")
      .select("*")
      .eq("listing_id", listingId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.warn("[supabase] fetchDisputesByListing:", error.message);
      return null;
    }
    return data as DisputeRecord | null;
  } catch (err) {
    console.error("[supabase] fetchDisputesByListing exception:", err);
    return null;
  }
}

// ─── Credentials Decryption ────────────────────────────────────────────────────

/**
 * Request credentials decryption from the Supabase Edge Function.
 * Uses an Ed25519 wallet signature as the authentication challenge.
 */
export async function requestCredentialsDecryption(
  listingId: string,
  buyerPubkey: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<{
  success: boolean;
  encryptedCredentials?: string;
  encryptionIv?: string;
  error?: string;
}> {
  try {
    const timestamp = Date.now();
    const nonce = generateNonce();
    const challengeText = buildChallengeMessage(listingId, nonce, timestamp);
    const messageBytes = new TextEncoder().encode(challengeText);

    const signatureBytes = await signMessage(messageBytes);
    const signatureBase58 = bs58.encode(signatureBytes);

    const edgeFunctionUrl = `${supabaseUrl}/functions/v1/decrypt-credentials`;

    const response = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: supabaseAnonKey,
      },
      body: JSON.stringify({
        listingId,
        buyerPubkey,
        signature: signatureBase58,
        nonce,
        timestamp,
      }),
    });

    const result = await response.json();
    if (!response.ok || !result.success) {
      return {
        success: false,
        error: result.error || "Failed to decrypt credentials",
      };
    }

    return {
      success: true,
      encryptedCredentials: result.encryptedCredentials,
      encryptionIv: result.encryptionIv,
    };
  } catch (err: any) {
    return { success: false, error: err.message || "Failed to sign or decrypt" };
  }
}
