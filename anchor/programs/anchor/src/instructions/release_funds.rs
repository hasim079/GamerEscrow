use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus};

#[derive(Accounts)]
pub struct ReleaseFunds<'info> {
    #[account(mut)]
    pub listing_account: Account<'info, ListingAccount>,
    #[account(mut, address = listing_account.seller)]
    /// CHECK: The seller address is stored in the listing account.
    pub seller: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAULT_SEED, listing_account.key().as_ref()], bump = listing_account.vault_bump)]
    /// CHECK: The vault PDA is validated by its seeds and owned by this program.
    pub escrow_vault: UncheckedAccount<'info>,
    #[account(mut, address = crate::constants::TREASURY_PUBKEY)]
    /// CHECK: Treasury account to receive developer fees
    pub treasury: UncheckedAccount<'info>,
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_release_funds(ctx: Context<ReleaseFunds>) -> Result<()> {
    let listing = &mut ctx.accounts.listing_account;
    require!(listing.status == ListingStatus::InEscrow, ErrorCode::InvalidStatus);
    require_keys_eq!(
        listing.buyer.ok_or(ErrorCode::BuyerRequired)?,
        ctx.accounts.buyer.key(),
        ErrorCode::UnauthorizedBuyer
    );

    // 1. CHECKS & EFFECTS (CEI Pattern): Update state BEFORE transferring funds to prevent Reentrancy
    listing.status = ListingStatus::Completed;

    let amount = ctx.accounts.escrow_vault.to_account_info().lamports();
    
    // Calculate fees
    let buyer_fee = (listing.price as u128 * crate::constants::BUYER_FEE_BPS as u128 / 10000) as u64;
    let seller_fee = (listing.price as u128 * crate::constants::SELLER_FEE_BPS as u128 / 10000) as u64;
    let total_fee = buyer_fee.checked_add(seller_fee).unwrap();

    let seller_amount = amount.saturating_sub(total_fee);

    // Manual lamport transfer instead of CPI since vault is owned by the program
    **ctx.accounts.escrow_vault.to_account_info().try_borrow_mut_lamports()? -= amount;
    **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += total_fee;
    **ctx.accounts.seller.to_account_info().try_borrow_mut_lamports()? += seller_amount;

    // Assign to SystemProgram so the zero-balance account can be securely purged
    ctx.accounts.escrow_vault.to_account_info().assign(&system_program::ID);

    Ok(())
}
