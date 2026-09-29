-- ============================================================================
-- GAMERESCROW SUPABASE SCHEMA & RLS POLICIES
-- ============================================================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Enum types
DO $$ BEGIN
    CREATE TYPE listing_status AS ENUM (
        'Draft',
        'Listed',
        'InEscrow',
        'Completed',
        'InDispute',
        'Cancelled'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE dispute_status AS ENUM (
        'Open',
        'UnderReview',
        'Resolved_Refunded',
        'Resolved_Released',
        'Dismissed'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 1. ADMIN WHITELIST TABLE
CREATE TABLE IF NOT EXISTS admin_whitelist (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    wallet_pubkey TEXT UNIQUE NOT NULL,
    email TEXT,
    role TEXT NOT NULL DEFAULT 'moderator',
    added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed initial admin from contract constants
INSERT INTO admin_whitelist (wallet_pubkey, role)
VALUES ('<ADMIN_WALLET_PUBKEY>', 'admin')
ON CONFLICT (wallet_pubkey) DO NOTHING;

-- 2. LISTINGS TABLE
CREATE TABLE IF NOT EXISTS listings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    seller_pubkey TEXT NOT NULL,
    buyer_pubkey TEXT,
    title TEXT NOT NULL,
    game TEXT NOT NULL,
    game_slug TEXT,
    category TEXT,
    price_sol NUMERIC(18, 9) NOT NULL,
    price_usd NUMERIC(12, 2),
    image TEXT,
    image_url TEXT,
    data_hash TEXT NOT NULL,
    encrypted_credentials TEXT NOT NULL,
    encryption_iv TEXT,
    status listing_status NOT NULL DEFAULT 'Draft',
    escrow_pda TEXT UNIQUE,
    vault_pda TEXT,
    tags TEXT[] DEFAULT '{}',
    rank TEXT,
    description TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. DISPUTES TABLE
CREATE TABLE IF NOT EXISTS disputes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
    initiator_pubkey TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT,
    evidence_urls TEXT[] DEFAULT '{}',
    seller_response TEXT,
    seller_evidence_urls TEXT[] DEFAULT '{}',
    status dispute_status NOT NULL DEFAULT 'Open',
    resolution TEXT,
    resolved_by TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. PERFORMANCE INDEXES
CREATE INDEX IF NOT EXISTS idx_listings_seller ON listings(seller_pubkey);
CREATE INDEX IF NOT EXISTS idx_listings_buyer ON listings(buyer_pubkey);
CREATE INDEX IF NOT EXISTS idx_listings_status ON listings(status);
CREATE INDEX IF NOT EXISTS idx_listings_data_hash ON listings(data_hash);
CREATE INDEX IF NOT EXISTS idx_listings_escrow_pda ON listings(escrow_pda);

CREATE INDEX IF NOT EXISTS idx_disputes_listing_id ON disputes(listing_id);
CREATE INDEX IF NOT EXISTS idx_disputes_initiator ON disputes(initiator_pubkey);
CREATE INDEX IF NOT EXISTS idx_disputes_status ON disputes(status);

CREATE INDEX IF NOT EXISTS idx_admin_whitelist_wallet ON admin_whitelist(wallet_pubkey);

-- 5. UPDATED_AT TRIGGER FUNCTION
CREATE OR REPLACE FUNCTION update_timestamp_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_listings_updated_at ON listings;
CREATE TRIGGER trg_listings_updated_at
    BEFORE UPDATE ON listings
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

DROP TRIGGER IF EXISTS trg_disputes_updated_at ON disputes;
CREATE TRIGGER trg_disputes_updated_at
    BEFORE UPDATE ON disputes
    FOR EACH ROW
    EXECUTE FUNCTION update_timestamp_column();

-- ============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ============================================================================

ALTER TABLE admin_whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE disputes ENABLE ROW LEVEL SECURITY;

-- ADMIN WHITELIST POLICIES
-- Anyone can check if a wallet address is in the whitelist (for frontend Auth Gate)
CREATE POLICY "Public read for admin whitelist"
    ON admin_whitelist FOR SELECT
    USING (true);

-- Only service role can modify admin whitelist
CREATE POLICY "Service role modify admin whitelist"
    ON admin_whitelist FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- LISTINGS POLICIES
-- 1. Anyone can view public listings that are currently 'Listed'
CREATE POLICY "Public read for listed items"
    ON listings FOR SELECT
    USING (status = 'Listed');

-- 2. Sellers can view all their own listings (Drafts, Listed, InEscrow, etc.)
CREATE POLICY "Sellers can view own listings"
    ON listings FOR SELECT
    USING (seller_pubkey = (auth.jwt() ->> 'wallet_address'));

-- 3. Buyers can view listings they have purchased in Escrow, Dispute or Completed
CREATE POLICY "Buyers can view their escrows"
    ON listings FOR SELECT
    USING (
        buyer_pubkey = (auth.jwt() ->> 'wallet_address')
        AND status IN ('InEscrow', 'InDispute', 'Completed')
    );

-- 4. Sellers can create listings
CREATE POLICY "Sellers can insert listings"
    ON listings FOR INSERT
    WITH CHECK (true);

-- 5. Sellers can update their own drafts
CREATE POLICY "Sellers can update drafts"
    ON listings FOR UPDATE
    USING (
        seller_pubkey = (auth.jwt() ->> 'wallet_address')
        AND status = 'Draft'
    );

-- 6. Service Role (RPC sync worker and Edge Functions) full bypass
CREATE POLICY "Service role full access on listings"
    ON listings FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- DISPUTES POLICIES
-- 1. Initiators and counterparties can view their dispute
CREATE POLICY "Parties can view dispute"
    ON disputes FOR SELECT
    USING (
        initiator_pubkey = (auth.jwt() ->> 'wallet_address')
        OR EXISTS (
            SELECT 1 FROM listings l
            WHERE l.id = disputes.listing_id
            AND (
                l.seller_pubkey = (auth.jwt() ->> 'wallet_address')
                OR l.buyer_pubkey = (auth.jwt() ->> 'wallet_address')
            )
        )
    );

-- 2. Whitelisted Admins can view all disputes
CREATE POLICY "Admins can view all disputes"
    ON disputes FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM admin_whitelist aw
            WHERE aw.wallet_pubkey = (auth.jwt() ->> 'wallet_address')
        )
    );

-- 3. Initiator can insert dispute
CREATE POLICY "Users can create dispute"
    ON disputes FOR INSERT
    WITH CHECK (true);

-- 4. Service role has full access on disputes
CREATE POLICY "Service role full access on disputes"
    ON disputes FOR ALL
    USING (auth.jwt() ->> 'role' = 'service_role');

-- 5. Sellers can update disputes on their listings (to submit seller_response)
CREATE POLICY "Sellers can update dispute response"
    ON disputes FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM listings l
            WHERE l.id = disputes.listing_id
            AND l.seller_pubkey = (auth.jwt() ->> 'wallet_address')
        )
    );

-- 6. Admins can update all disputes (for resolution)
CREATE POLICY "Admins can update all disputes"
    ON disputes FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM admin_whitelist aw
            WHERE aw.wallet_pubkey = (auth.jwt() ->> 'wallet_address')
        )
    );

-- 6. SAFE PUBLIC VIEW (Omits encrypted_credentials for zero-leakage storefront)
CREATE OR REPLACE VIEW public_listings_view AS
SELECT
    id,
    seller_pubkey,
    buyer_pubkey,
    title,
    game,
    game_slug,
    category,
    price_sol,
    price_usd,
    image,
    image_url,
    data_hash,
    status,
    escrow_pda,
    vault_pda,
    tags,
    rank,
    description,
    created_at,
    updated_at
FROM listings
WHERE status = 'Listed';
-- 7. Whitelisted Admins can view all listings
CREATE POLICY "Admins can view all listings"
    ON listings FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM admin_whitelist aw
            WHERE aw.wallet_pubkey = (auth.jwt() ->> 'wallet_address')
        )
    );
