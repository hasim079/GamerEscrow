use anchor_lang::prelude::*;

use crate::constants::{ADMIN_PUBKEY, VAULT_SEED};
use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus};

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub listing_account: Account<'info, ListingAccount>,
    #[account(mut)]
    /// CHECK: The destination is selected from the listing's recorded buyer/seller.
    pub winner: UncheckedAccount<'info>,
    #[account(mut, seeds = [VAULT_SEED, listing_account.key().as_ref()], bump = listing_account.vault_bump)]
    /// CHECK: The vault PDA is validated by its seeds and owned by this program.
    pub escrow_vault: UncheckedAccount<'info>,
    #[account(mut, address = crate::constants::TREASURY_PUBKEY)]
    /// CHECK: Treasury account to receive developer fees
    pub treasury: UncheckedAccount<'info>,
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_resolve_dispute(ctx: Context<ResolveDispute>, winner_is_buyer: bool) -> Result<()> {
    require_keys_eq!(ctx.accounts.admin.key(), ADMIN_PUBKEY, ErrorCode::UnauthorizedAdmin);
    let listing = &mut ctx.accounts.listing_account;
    require!(listing.status == ListingStatus::InDispute, ErrorCode::InvalidStatus);

    let expected_winner = if winner_is_buyer {
        listing.buyer.ok_or(ErrorCode::BuyerRequired)?
    } else {
        listing.seller
    };
    require_keys_eq!(expected_winner, ctx.accounts.winner.key(), ErrorCode::InvalidWinner);

    // 1. CHECKS & EFFECTS (CEI Pattern): State transition executed BEFORE transfer to prevent Reentrancy
    listing.status = if winner_is_buyer {
        ListingStatus::Completed
    } else {
        ListingStatus::Cancelled
    };

    let amount = ctx.accounts.escrow_vault.to_account_info().lamports();
    
    // Calculate fees
    let buyer_fee = (listing.price as u128 * crate::constants::BUYER_FEE_BPS as u128 / 10000) as u64;
    let seller_fee = (listing.price as u128 * crate::constants::SELLER_FEE_BPS as u128 / 10000) as u64;
    let total_fee = buyer_fee.checked_add(seller_fee).unwrap();

    let (treasury_amount, winner_amount) = if winner_is_buyer {
        // Full refund to buyer, no fees taken
        (0, amount)
    } else {
        // Seller wins, take both fees
        (total_fee, amount.saturating_sub(total_fee))
    };

    // Manual lamport transfer instead of CPI since vault is owned by the program
    **ctx.accounts.escrow_vault.to_account_info().try_borrow_mut_lamports()? -= amount;
    
    if treasury_amount > 0 {
        **ctx.accounts.treasury.to_account_info().try_borrow_mut_lamports()? += treasury_amount;
    }
    
    **ctx.accounts.winner.to_account_info().try_borrow_mut_lamports()? += winner_amount;
    
    // Assign to SystemProgram so the zero-balance account can be securely purged
    ctx.accounts.escrow_vault.to_account_info().assign(&system_program::ID);

    Ok(())
}
