use anchor_lang::prelude::*;

use crate::errors::ErrorCode;
use crate::state::{ListingAccount, ListingStatus};

#[derive(Accounts)]
pub struct OpenDispute<'info> {
    #[account(mut)]
    pub listing_account: Account<'info, ListingAccount>,

    /// The person initiating the dispute — must be the buyer or seller (validated in the handler).
    #[account(mut)]
    pub initiator: Signer<'info>,
}

pub fn handle_open_dispute(ctx: Context<OpenDispute>) -> Result<()> {
    let listing = &mut ctx.accounts.listing_account;

    // 1. Checks
    require!(listing.status == ListingStatus::InEscrow, ErrorCode::InvalidStatus);

    let is_buyer = listing.buyer.map_or(false, |b| b == ctx.accounts.initiator.key());
    let is_seller = listing.seller == ctx.accounts.initiator.key();
    require!(is_buyer || is_seller, ErrorCode::UnauthorizedBuyer);

    // 2. Effects
    listing.status = ListingStatus::InDispute;

    Ok(())
}
