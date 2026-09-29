use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus, EscrowVault};

#[derive(Accounts)]
pub struct ReleaseFunds<'info> {
    #[account(mut)]
    pub listing_account: Account<'info, ListingAccount>,

    /// CHECK: Seller address is validated via listing_account.seller.
    #[account(
        mut,
        address = listing_account.seller,
    )]
    pub seller: UncheckedAccount<'info>,

    /// Vault is closed and all lamports are transferred to the seller (Anchor `close` constraint).
    #[account(
        mut,
        seeds = [VAULT_SEED, listing_account.key().as_ref()],
        bump = listing_account.vault_bump,
        close = seller,
    )]
    pub escrow_vault: Account<'info, EscrowVault>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_release_funds(ctx: Context<ReleaseFunds>) -> Result<()> {
    let listing = &mut ctx.accounts.listing_account;

    // 1. Checks
    require!(listing.status == ListingStatus::InEscrow, ErrorCode::InvalidStatus);
    require_keys_eq!(
        listing.buyer.ok_or(ErrorCode::BuyerRequired)?,
        ctx.accounts.buyer.key(),
        ErrorCode::UnauthorizedBuyer
    );

    // 2. Effects — Anchor `close = seller` transfers vault lamports to seller and closes the account
    listing.status = ListingStatus::Completed;

    Ok(())
}
