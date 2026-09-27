use anchor_lang::prelude::*;

use crate::constants::VAULT_SEED;
use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus};

#[derive(Accounts)]
pub struct BuyItem<'info> {
    #[account(mut)]
    pub listing_account: Account<'info, ListingAccount>,
    #[account(
        init,
        payer = buyer,
        space = 0,
        seeds = [VAULT_SEED, listing_account.key().as_ref()],
        bump,
    )]
    /// CHECK: This PDA is created and controlled by this program as the escrow vault.
    pub escrow_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub buyer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn handle_buy_item(ctx: Context<BuyItem>) -> Result<()> {
    let listing = &mut ctx.accounts.listing_account;
    require!(listing.status == ListingStatus::Listed, ErrorCode::InvalidStatus);
    let (expected_vault, expected_bump) = Pubkey::find_program_address(
        &[VAULT_SEED, listing.key().as_ref()],
        ctx.program_id,
    );
    require_keys_eq!(expected_vault, ctx.accounts.escrow_vault.key());
    require!(expected_bump == listing.vault_bump, ErrorCode::InvalidStatus);

    let buyer_fee = (listing.price as u128 * crate::constants::BUYER_FEE_BPS as u128 / 10000) as u64;
    let total_to_transfer = listing.price.checked_add(buyer_fee).unwrap();

    anchor_lang::system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.key(),
            anchor_lang::system_program::Transfer {
                from: ctx.accounts.buyer.to_account_info(),
                to: ctx.accounts.escrow_vault.to_account_info(),
            },
        ),
        total_to_transfer,
    )?;

    listing.buyer = Some(ctx.accounts.buyer.key());
    listing.status = ListingStatus::InEscrow;
    listing.escrow_start_time = Clock::get()?.unix_timestamp;
    Ok(())
}
