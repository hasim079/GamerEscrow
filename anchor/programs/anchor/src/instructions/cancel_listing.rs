use anchor_lang::prelude::*;

use crate::constants::{ESCROW_LOCK_PERIOD, VAULT_SEED};
use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus, EscrowVault};

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub listing_account: Account<'info, ListingAccount>,

    #[account(mut, address = listing_account.seller)]
    pub seller: Signer<'info>,

    /// Vault is closed and lamports are returned to the seller.
    /// In Listed state, the vault is always open (initialized in create_listing).
    #[account(
        mut,
        seeds = [VAULT_SEED, listing_account.key().as_ref()],
        bump = listing_account.vault_bump,
        close = seller,
    )]
    pub escrow_vault: Account<'info, EscrowVault>,

    pub system_program: Program<'info, System>,
}

pub fn handle_cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
    let listing = &mut ctx.accounts.listing_account;
    require_keys_eq!(listing.seller, ctx.accounts.seller.key(), ErrorCode::UnauthorizedSeller);

    match listing.status {
        ListingStatus::Listed => {
            // Seller can freely cancel if item has not been purchased.
            // Anchor `close = seller` constraint handles vault lamport transfer.
            listing.status = ListingStatus::Cancelled;
        }
        ListingStatus::InEscrow => {
            // SECURITY: 24h Lock Mechanism check.
            // Seller cannot cancel while the buyer is in the active inspection window.
            let clock = Clock::get()?;
            let elapsed = clock.unix_timestamp.saturating_sub(listing.escrow_start_time);
            require!(elapsed >= ESCROW_LOCK_PERIOD, ErrorCode::LockPeriodActive);

            // Checks-Effects: Update status BEFORE `close` constraint executes (CEI)
            listing.status = ListingStatus::Cancelled;
        }
        _ => return Err(ErrorCode::InvalidStatus.into()),
    }

    Ok(())
}
