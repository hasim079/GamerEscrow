use anchor_lang::prelude::*;

use crate::constants::{ESCROW_LOCK_PERIOD, VAULT_SEED};
use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus};

#[derive(Accounts)]
pub struct CancelListing<'info> {
    #[account(mut)]
    pub listing_account: Account<'info, ListingAccount>,
    #[account(mut, address = listing_account.seller)]
    pub seller: Signer<'info>,
    #[account(
        mut,
        seeds = [VAULT_SEED, listing_account.key().as_ref()],
        bump = listing_account.vault_bump
    )]
    /// CHECK: Vault PDA if funds were deposited in escrow
    pub escrow_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_cancel_listing(ctx: Context<CancelListing>) -> Result<()> {
    let listing = &mut ctx.accounts.listing_account;
    require_keys_eq!(listing.seller, ctx.accounts.seller.key(), ErrorCode::UnauthorizedSeller);

    match listing.status {
        ListingStatus::Listed => {
            // Seller can freely cancel if item has not been purchased
            listing.status = ListingStatus::Cancelled;
        }
        ListingStatus::InEscrow => {
            // SECURITY: 24h Lock Mechanism check.
            // Seller cannot cancel while the buyer is in the active inspection window.
            let clock = Clock::get()?;
            let elapsed = clock.unix_timestamp.saturating_sub(listing.escrow_start_time);
            require!(elapsed >= ESCROW_LOCK_PERIOD, ErrorCode::LockPeriodActive);

            // Checks-Effects: Update status BEFORE transferring lamports (CEI)
            listing.status = ListingStatus::Cancelled;

            let amount = ctx.accounts.escrow_vault.to_account_info().lamports();
            if amount > 0 {
                // Manual lamport transfer instead of CPI since vault is owned by the program
                **ctx.accounts.escrow_vault.to_account_info().try_borrow_mut_lamports()? -= amount;
                **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += amount;
                
                // Assign to SystemProgram so the zero-balance account can be securely purged
                ctx.accounts.escrow_vault.to_account_info().assign(&system_program::ID);
            }
        }
        _ => return Err(ErrorCode::InvalidStatus.into()),
    }

    Ok(())
}
