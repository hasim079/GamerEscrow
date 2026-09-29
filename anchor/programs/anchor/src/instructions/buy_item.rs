use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus, EscrowVault};

#[derive(Accounts)]
pub struct BuyItem<'info> {
    #[account(mut)]
    pub listing_account: Account<'info, ListingAccount>,

    #[account(
        mut,
        seeds = [VAULT_SEED, listing_account.key().as_ref()],
        bump = listing_account.vault_bump,
    )]
    pub escrow_vault: Account<'info, EscrowVault>,

    #[account(mut)]
    pub buyer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handle_buy_item(ctx: Context<BuyItem>) -> Result<()> {
    let listing = &mut ctx.accounts.listing_account;

    require!(listing.status == ListingStatus::Listed, ErrorCode::InvalidStatus);

    let price = listing.price;

    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
            },
        ),
        price,
    )?;

    listing.buyer = Some(ctx.accounts.buyer.key());
    listing.status = ListingStatus::InEscrow;
    listing.escrow_start_time = Clock::get()?.unix_timestamp;

    Ok(())
}
