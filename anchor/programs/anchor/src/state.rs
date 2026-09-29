use anchor_lang::prelude::*;

#[account]
pub struct ListingAccount {
    pub seller: Pubkey,
    pub buyer: Option<Pubkey>,
    pub price: u64,
    pub data_hash: [u8; 32],
    pub status: ListingStatus,
    pub created_at: i64,
    pub bump: u8,
    pub vault_bump: u8,
    pub escrow_start_time: i64,
}

impl ListingAccount {
    // The Anchor `space` parameter requires the 8-byte discriminator to be included MANUALLY.
    // Anchor does NOT add it automatically — the full on-chain allocation must be:
    // 8 (discriminator) + struct fields:
    // 32 (seller) + 1+32 (Option<buyer>) + 8 (price) + 32 (data_hash)
    // + 1 (status) + 8 (created_at) + 1 (bump) + 1 (vault_bump) + 8 (escrow_start_time)
    // = 8 + 124 = 132 bytes total
    pub const SPACE: usize = 8 + 32 + (1 + 32) + 8 + 32 + 1 + 8 + 1 + 1 + 8; // = 132
}

#[derive(Debug, AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ListingStatus {
    Listed,
    InEscrow,
    Completed,
    InDispute,
    Cancelled,
}

#[account]
pub struct EscrowVault {}
