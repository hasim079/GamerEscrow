import { createClient } from "@supabase/supabase-js";
import bs58 from "bs58";
import { buildChallengeMessage, generateNonce } from "./crypto";

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
  status: "Draft" | "Listed" | "InEscrow" | "Completed" | "InDispute" | "Cancelled";
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
  status: "Open" | "UnderReview" | "Resolved_Refunded" | "Resolved_Released" | "Dismissed";
  resolution?: string;
  resolved_by?: string;
  created_at?: string;
  updated_at?: string;
}

const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321";
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key";

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

/**
 * Creates a Supabase client that injects the user's JWT into the headers
 * so that Row Level Security (RLS) policies can correctly identify the user.
 */
export function getAuthClient(jwtToken?: string) {
  if (!jwtToken) {
    // Attempt to get token from localStorage if not provided
    if (typeof window !== 'undefined') {
      jwtToken = localStorage.getItem('gamer_escrow_jwt') || undefined;
    }
  }
  
  if (!jwtToken) return supabase;
  
  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${jwtToken}`,
      },
    },
  });
}

/**
 * Fetch all publicly available listings currently listed in the marketplace.
 */
export async function fetchMarketplaceListings(): Promise<ListingRecord[]> {
  try {
    const { data, error } = await supabase
      .from("listings")
      .select("*")
      .eq("status", "Listed")
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[supabase] fetchMarketplaceListings warning:", error.message);
      return [];
    }
    return (data as ListingRecord[]) || [];
  } catch (err) {
    console.error("[supabase] Error fetching marketplace listings:", err);
    return [];
  }
}

/**
 * Fetch all listings belonging to a specific seller (Drafts, Listed, InEscrow, Completed).
 */
export async function fetchSellerListings(sellerPubkey: string): Promise<ListingRecord[]> {
  try {
    const client = getAuthClient();
    const { data, error } = await client
      .from("listings")
      .select("*")
      .eq("seller_pubkey", sellerPubkey)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[supabase] fetchSellerListings warning:", error.message);
      return [];
    }
    return (data as ListingRecord[]) || [];
  } catch (err) {
    console.error("[supabase] Error fetching seller listings:", err);
    return [];
  }
}

/**
 * Fetch all orders for a buyer wallet (InEscrow, Completed, InDispute).
 */
export async function fetchBuyerOrders(buyerPubkey: string): Promise<ListingRecord[]> {
  try {
    const client = getAuthClient();
    const { data, error } = await client
      .from("listings")
      .select("*")
      .eq("buyer_pubkey", buyerPubkey)
      .order("created_at", { ascending: false });

    if (error) {
      console.warn("[supabase] fetchBuyerOrders warning:", error.message);
      return [];
    }
    return (data as ListingRecord[]) || [];
  } catch (err) {
    console.error("[supabase] Error fetching buyer orders:", err);
    return [];
  }
}

/**
 * Fetch a single listing by its primary ID.
 */
export async function fetchListingById(id: string): Promise<ListingRecord | null> {
  try {
    const { data, error } = await supabase
      .from("listings")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error) {
      console.warn("[supabase] fetchListingById warning:", error.message);
      return null;
    }
    return data as ListingRecord;
  } catch (err) {
    console.error("[supabase] Error fetching listing by id:", err);
    return null;
  }
}

/**
 * Create a new listing record in Supabase.
 */
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
      console.error("[supabase] createListingRecord error:", error.message);
      return null;
    }
    return data as ListingRecord;
  } catch (err) {
    console.error("[supabase] Error creating listing:", err);
    return null;
  }
}

/**
 * Delete a listing record from Supabase (e.g. after successfully publishing a draft).
 */
export async function deleteListingRecord(id: string, sellerPubkey: string): Promise<boolean> {
  try {
    const res = await fetch('/api/delete-listing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, seller_pubkey: sellerPubkey })
    });
    
    const data = await res.json();
    if (!data.success) {
      console.error("[Backend API] deleteListingRecord error:", data.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Backend API] Network/Fetch error:", err);
    return false;
  }
}

/**
 * Update the status of a listing (e.g. after on-chain transaction).
 */
export async function updateListingStatus(
  id: string,
  status: ListingRecord["status"],
  buyerPubkey?: string,
  vaultPda?: string
): Promise<boolean> {
  try {
    const res = await fetch('/api/update-listing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status, buyerPubkey, vaultPda })
    });
    
    const data = await res.json();
    if (!data.success) {
      console.error("[Backend API] updateListingStatus error:", data.error);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[Backend API] Network/Fetch error:", err);
    return false;
  }
}

/**
 * Check if a given wallet address is in the admin whitelist from Supabase.
 */
export async function checkIsAdmin(walletPubkey: string): Promise<boolean> {
  if (!walletPubkey) return false;

  try {
    // Cüzdan adresindeki olası boşlukları temizle
    const cleanPubkey = walletPubkey.trim();
    const client = getAuthClient();

    const { data, error } = await client
      .from("admin_whitelist")
      .select("role")
      .eq("wallet_pubkey", cleanPubkey)
      .maybeSingle();

    if (error) {
      console.warn("[supabase] checkIsAdmin warning:", error.message);
      return false;
    }

    return !!data;
  } catch (err) {
    console.error("[supabase] Error checking admin status:", err);
    return false;
  }
}

/**
 * Fetch disputes. If isAdmin is true, fetches all disputes; otherwise user-related.
 */
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

    const { data, error } = await query.order("created_at", { ascending: false });
    if (error) {
      console.warn("[supabase] fetchDisputes warning:", error.message);
      return [];
    }
    return (data as DisputeRecord[]) || [];
  } catch (err) {
    console.error("[supabase] Error fetching disputes:", err);
    return [];
  }
}

/**
 * Create a new dispute record.
 */
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
      console.error("[supabase] createDisputeRecord error:", error.message);
      return null;
    }
    return data as DisputeRecord;
  } catch (err) {
    console.error("[supabase] Error creating dispute:", err);
    return null;
  }
}

/**
 * Request credentials decryption from Supabase Edge Function via wallet Ed25519 signature.
 */

/**
 * Update a dispute with seller's response and evidence.
 */
export async function updateDisputeSellerResponse(
  disputeId: string,
  sellerResponse: string,
  sellerEvidenceUrls?: string[],
  walletPubkey?: string
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
      console.error("[supabase] updateDisputeSellerResponse error:", error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[supabase] Error updating dispute seller response:", err);
    return false;
  }
}

/**
 * Fetch disputes for a specific listing (used by seller to see if their listing has a dispute).
 */
export async function fetchDisputesByListing(
  listingId: string,
  walletPubkey?: string
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
      console.warn("[supabase] fetchDisputesByListing warning:", error.message);
      return null;
    }
    return data as DisputeRecord | null;
  } catch (err) {
    console.error("[supabase] Error fetching dispute by listing:", err);
    return null;
  }
}
export async function requestCredentialsDecryption(
  listingId: string,
  buyerPubkey: string,
  signMessage: (message: Uint8Array) => Promise<Uint8Array>
): Promise<{ success: boolean; encryptedCredentials?: string; encryptionIv?: string; error?: string }> {
  try {
    const timestamp = Date.now();
    const nonce = generateNonce();
    const challengeText = buildChallengeMessage(listingId, nonce, timestamp);
    const messageBytes = new TextEncoder().encode(challengeText);

    // Prompt user wallet to sign challenge
    const signatureBytes = await signMessage(messageBytes);
    const signatureBase58 = bs58.encode(signatureBytes);

    // Call Supabase Edge Function
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
      return { success: false, error: result.error || "Failed to decrypt credentials" };
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
