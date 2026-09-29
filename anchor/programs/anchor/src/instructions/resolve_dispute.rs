use anchor_lang::prelude::*;

use crate::constants::{ADMIN_PUBKEY, VAULT_SEED};
use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus, EscrowVault};

#[derive(Accounts)]
pub struct ResolveDispute<'info> {
    #[account(mut)]
    pub listing_account: Account<'info, ListingAccount>,

    /// CHECK: The winning party must be the buyer or seller in the listing (validated in the handler).
    #[account(mut)]
    pub winner: UncheckedAccount<'info>,

    /// Vault is closed and all lamports are transferred to the winner (Anchor `close` constraint).
    #[account(
        mut,
        seeds = [VAULT_SEED, listing_account.key().as_ref()],
        bump = listing_account.vault_bump,
        close = winner,
    )]
    pub escrow_vault: Account<'info, EscrowVault>,

    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_resolve_dispute(
    ctx: Context<ResolveDispute>,
    winner_is_buyer: bool,
) -> Result<()> {
    // 1. Checks
    require_keys_eq!(
        ctx.accounts.admin.key(),
        ADMIN_PUBKEY,
        ErrorCode::UnauthorizedAdmin
    );

    let listing = &mut ctx.accounts.listing_account;
    require!(listing.status == ListingStatus::InDispute, ErrorCode::InvalidStatus);

    let expected_winner = if winner_is_buyer {
        listing.buyer.ok_or(ErrorCode::BuyerRequired)?
    } else {
        listing.seller
    };
    require_keys_eq!(
        expected_winner,
        ctx.accounts.winner.key(),
        ErrorCode::InvalidWinner
    );

    // 2. Effects — close = winner constraint transfers vault lamports to the winner and closes the account
    listing.status = if winner_is_buyer {
        ListingStatus::Cancelled
    } else {
        ListingStatus::Completed
    };

    Ok(())
}
