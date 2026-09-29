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
    // The Anchor `space` parameter AUTOMATICALLY adds the 8-byte discriminator.
    // This value is only the sum of the struct fields (excluding discriminator):
    // 32 (seller) + 1+32 (Option<buyer>) + 8 (price) + 32 (data_hash)
    // + 1 (status) + 8 (created_at) + 1 (bump) + 1 (vault_bump) + 8 (escrow_start_time)
    // = 124 data bytes → Anchor adds +8 disc → on-chain: 132 bytes
    pub const SPACE: usize = 32 + (1 + 32) + 8 + 32 + 1 + 8 + 1 + 1 + 8; // = 124
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
