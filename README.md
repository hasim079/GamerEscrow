# GamerEscrow 🎮 — Trustless Account Marketplace

GamerEscrow is a decentralized Web3 marketplace where gamers can securely buy and sell game accounts using Solana smart contracts. The platform utilizes a trustless Escrow Vault system to hold funds securely until the buyer verifies the account credentials, with an Admin Dispute Resolution system for edge cases.

## 🚀 Tech Stack
- **Smart Contract:** Solana, Anchor Framework (Rust)
- **Frontend:** Next.js, React, TailwindCSS
- **Web3 Integration:** `@solana/web3.js`, `@solana/wallet-adapter`
- **Backend / DB:** Supabase (PostgreSQL, Storage)

---

## 🛠️ Setup Instructions for Evaluators

To run this project locally and test the entire flow, you need to set up the Smart Contract, Supabase backend, and the Next.js frontend.

### 1. Prerequisites
- Node.js (v18+)
- Rust & Cargo
- Solana CLI (`v1.17.x` or higher)
- Anchor CLI (`v0.29.x` or higher)
- Phantom Wallet browser extension
- A free [Supabase](https://supabase.com/) account

### 2. Supabase Setup (Database & Storage)
The frontend relies on Supabase for off-chain metadata (titles, images, encrypted credentials). You must configure your Supabase project manually:

**A. Create Database Tables**
Run the following SQL in your Supabase SQL Editor:

```sql
-- 1. Listings Table
CREATE TABLE listings (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    seller_pubkey TEXT NOT NULL,
    buyer_pubkey TEXT,
    title TEXT NOT NULL,
    game TEXT NOT NULL,
    category TEXT,
    price_sol NUMERIC NOT NULL,
    price_usd NUMERIC,
    data_hash TEXT NOT NULL,
    encrypted_credentials TEXT,
    encryption_iv TEXT,
    status TEXT NOT NULL,
    escrow_pda TEXT,
    vault_pda TEXT,
    rank TEXT,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Disputes Table
CREATE TABLE disputes (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    listing_id UUID REFERENCES listings(id),
    initiator_pubkey TEXT NOT NULL,
    reason TEXT NOT NULL,
    details TEXT,
    evidence_urls JSONB,
    seller_response TEXT,
    seller_evidence_urls JSONB,
    status TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

(Note: Disable RLS for local testing, or configure appropriate policies).

B. Create Storage Bucket

Go to Storage in your Supabase dashboard.
Click New Bucket.
Name it exactly: dispute
Important: Check the Public bucket toggle.
Save the bucket and ensure public INSERT/SELECT policies are enabled so evidence images can be uploaded.
3. Smart Contract Deployment (Optional)

The repository already points to a deployed Devnet contract. If you wish to deploy your own instance:

bash
cd anchor
# Ensure your solana config is set to devnet
solana config set --url devnet
# Build the contract
anchor build
# Sync the new program ID to your keypair
anchor keys sync
# Build again and deploy
anchor build
anchor deploy

If you deploy your own contract, remember to update the PROGRAM_ID in frontend/.env.local.

4. Frontend Setup

Navigate to the frontend directory:

bash
cd frontend
npm install

Configure Environment Variables:

Copy .env.example to .env.local
Fill in your Supabase URL, Supabase Anon Key, and Supabase Service Role Key.
Generate a 64-character hex string for ENCRYPTION_SECRET_KEY (e.g., via openssl rand -hex 32).
bash
cp .env.example .env.local

Run the development server:

bash
npm run dev

Open http://localhost:3000 in your browser.

🧪 Testing the Flow
Create a Listing (Seller): Connect Wallet A, go to /create-listing, enter account details (they will be encrypted before saving), and confirm the transaction.
Buy Account (Buyer): Switch to Wallet B, find the listing on the marketplace, click "Buy". Funds will be locked in the PDA Escrow Vault.
Verify & Release: The buyer decrypts the credentials, logs into the game, verifies it, and clicks "Confirm Handoff" (Releases SOL to seller).
Dispute System: If credentials are fake, the buyer can click "Raise Dispute". This locks the vault. The Admin wallet can then resolve it via the /admin dashboard.
