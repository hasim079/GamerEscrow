use anchor_lang::prelude::*;

pub const ADMIN_PUBKEY: Pubkey = pubkey!("3trynVPFszVYU4UavqhUJpe1RyhkV5icAcmJ77mArNzP");
pub const LISTING_SEED: &[u8] = b"listing";
pub const VAULT_SEED: &[u8] = b"vault";
pub const ESCROW_LOCK_PERIOD: i64 = 86400; // 24 hours lock/inspection period
