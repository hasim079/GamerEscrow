use anchor_lang::prelude::*;

use crate::constants::{LISTING_SEED, VAULT_SEED};
use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus, EscrowVault};

#[derive(Accounts)]
#[instruction(price: u64, data_hash: [u8; 32])]
pub struct CreateListing<'info> {
    #[account(
        init,
        payer = seller,
        space = ListingAccount::SPACE,
        seeds = [LISTING_SEED, seller.key().as_ref(), data_hash.as_ref()],
        bump,
    )]
    pub listing_account: Account<'info, ListingAccount>,

    #[account(
        init,
        payer = seller,
        space = 8,
        seeds = [VAULT_SEED, listing_account.key().as_ref()],
        bump
    )]
    pub escrow_vault: Account<'info, EscrowVault>,

    #[account(mut)]
    pub seller: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_create_listing(
    ctx: Context<CreateListing>,
    price: u64,
    data_hash: [u8; 32],
) -> Result<()> {
    require!(price > 0, ErrorCode::InvalidPrice);

    let listing = &mut ctx.accounts.listing_account;
    listing.seller = ctx.accounts.seller.key();
    listing.buyer = None;
    listing.price = price;
    listing.data_hash = data_hash;
    listing.status = ListingStatus::Listed;
    listing.created_at = Clock::get()?.unix_timestamp;
    listing.bump = ctx.bumps.listing_account;
    listing.vault_bump = ctx.bumps.escrow_vault;
    listing.escrow_start_time = 0;

    Ok(())
}
