
use {
    anchor_lang::{
        prelude::Pubkey,
        solana_program::{instruction::Instruction, system_program},
        AccountDeserialize, InstructionData, ToAccountMetas,
    },
    litesvm::LiteSVM,
    solana_keypair::Keypair,
    solana_message::{Message, VersionedMessage},
    solana_signer::Signer,
    solana_transaction::versioned::VersionedTransaction,
};

#[test]
fn test_create_listing() {
    let program_id = anchor::id();
    let payer = Keypair::new();
    let data_hash = [7_u8; 32];
    let listing = Pubkey::find_program_address(
        &[
            anchor::constants::LISTING_SEED,
            payer.pubkey().as_ref(),
            &data_hash,
        ],
        &program_id,
    )
    .0;
    let vault = Pubkey::find_program_address(
        &[
            anchor::constants::VAULT_SEED,
            listing.as_ref(),
        ],
        &program_id,
    )
    .0;
    
    let mut svm = LiteSVM::new();
    let bytes = include_bytes!(concat!(
        env!("CARGO_TARGET_TMPDIR"),
        "/../deploy/anchor.so"
    ));
    svm.add_program(program_id, bytes).unwrap();
    svm.airdrop(&payer.pubkey(), 1_000_000_000).unwrap();

    let instruction = Instruction::new_with_bytes(
        program_id,
        &anchor::instruction::CreateListing {
            price: 123_000,
            data_hash,
        }
        .data(),
        anchor::accounts::CreateListing {
            listing_account: listing,
            escrow_vault: vault,
            seller: payer.pubkey(),
            system_program: system_program::ID,
        }
        .to_account_metas(None),
    );

    let blockhash = svm.latest_blockhash();
    let msg = Message::new_with_blockhash(&[instruction], Some(&payer.pubkey()), &blockhash);
    let tx = VersionedTransaction::try_new(VersionedMessage::Legacy(msg), &[&payer]).unwrap();

    let res = svm.send_transaction(tx);
    assert!(res.is_ok());

    let listing_account = svm.get_account(&listing).unwrap();
    let mut data: &[u8] = &listing_account.data;
    let listing_state = anchor::state::ListingAccount::try_deserialize(&mut data).unwrap();
    assert_eq!(listing_state.seller, payer.pubkey());
    assert_eq!(listing_state.price, 123_000);
    assert_eq!(listing_state.data_hash, data_hash);
    assert_eq!(listing_state.status, anchor::state::ListingStatus::Listed);
    assert_eq!(listing_state.escrow_start_time, 0);
}
