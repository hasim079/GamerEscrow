import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Program, AnchorProvider, Idl, BN } from "@coral-xyz/anchor";
import rawIdl from "./gamer_escrow.json";
import { PROGRAM_ID, LISTING_SEED, VAULT_SEED, ADMIN_PUBKEY } from "./constants";

export { PROGRAM_ID, LISTING_SEED, VAULT_SEED, ADMIN_PUBKEY };

/**
 * Returns a Program instance with forced IDL address binding for browser compatibility.
 * wallet.publicKey ZORUNLU — simülasyon fee payer'ının doğru ayarlanması için.
 */
export function getProgram(walletPublicKey: PublicKey): Program {
  const rpcUrl =
    process.env.NEXT_PUBLIC_SOLANA_RPC_URL || "https://api.devnet.solana.com";
  const connection = new Connection(rpcUrl, "confirmed");

  const dummyWallet = {
    publicKey: walletPublicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
  };

  const dummyProvider = new AnchorProvider(connection, dummyWallet as any, {
    commitment: "confirmed",
    skipPreflight: false,
  });

  // Anchor 0.30 IDL → Anchor 0.29 compatibility shim
  const convertedAccounts = ((rawIdl as any).accounts || []).map((acc: any) => {
    if (acc.type) return acc;
    const matchingType = ((rawIdl as any).types || []).find(
      (t: any) => t.name === acc.name
    );
    return {
      ...acc,
      type: matchingType
        ? matchingType.type
        : { kind: "struct", fields: [] },
    };
  });

  const idl = {
    ...rawIdl,
    name:
      (rawIdl as any).metadata?.name ||
      (rawIdl as any).name ||
      "gamer_escrow",
    version:
      (rawIdl as any).metadata?.version ||
      (rawIdl as any).version ||
      "0.1.0",
    address: (rawIdl as any).address || PROGRAM_ID.toBase58(),
    accounts: convertedAccounts,
  };

  return new Program(idl as unknown as Idl, dummyProvider as any);
}

/**
 * Derives the Listing PDA from seller pubkey and 32-byte data_hash.
 * Seeds: ["listing", seller, data_hash] — matches create_listing.rs exactly.
 */
export function getListingPda(
  seller: PublicKey,
  dataHash: Uint8Array | number[]
): [PublicKey, number] {
  const rawArray = Array.from(dataHash).slice(0, 32);
  while (rawArray.length < 32) rawArray.push(0);
  const hashBuffer = Buffer.from(rawArray);

  return PublicKey.findProgramAddressSync(
    [LISTING_SEED, seller.toBuffer(), hashBuffer],
    PROGRAM_ID
  );
}

/**
 * Derives the Escrow Vault PDA for a given listing PDA.
 * Seeds: ["vault", listing_account] — matches buy_item.rs / release_funds.rs exactly.
 */
export function getVaultPda(listingPda: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [VAULT_SEED, listingPda.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Builds the Instruction for creating a new listing.
 */
export async function buildCreateListingInstruction(
  seller: PublicKey,
  priceSol: number,
  dataHash: Uint8Array | number[]
): Promise<{
  instruction: TransactionInstruction;
  listingPda: PublicKey;
  vaultPda: PublicKey;
}> {
  if (!seller || !(seller instanceof PublicKey)) {
    throw new Error(`Invalid seller PublicKey: ${seller}`);
  }

  const [listingPda] = getListingPda(seller, dataHash);
  const [vaultPda] = getVaultPda(listingPda);
  const program = getProgram(seller);

  const lamports = BigInt(Math.round(priceSol * 1e9));
  if (lamports <= 0n) {
    throw new Error("Price must be greater than zero");
  }

  const rawArray = Array.isArray(dataHash) ? dataHash : Array.from(dataHash);
  const dataHashArray = rawArray.slice(0, 32);
  while (dataHashArray.length < 32) dataHashArray.push(0);

  const instruction = await program.methods
    .createListing(new BN(lamports.toString()), dataHashArray)
    .accounts({
      listingAccount: listingPda,
      escrowVault: vaultPda,
      seller: seller,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { instruction, listingPda, vaultPda };
}

/**
 * Builds the Instruction for buying an item and locking SOL in the escrow vault.
 */
export async function buildBuyItemInstruction(
  buyer: PublicKey,
  listingPda: PublicKey
): Promise<{ instruction: TransactionInstruction; vaultPda: PublicKey }> {
  if (!buyer || !(buyer instanceof PublicKey)) {
    throw new Error(`Invalid buyer PublicKey: ${buyer}`);
  }
  if (!listingPda || !(listingPda instanceof PublicKey)) {
    throw new Error(`Invalid listingPda: ${listingPda}`);
  }

  const [vaultPda] = getVaultPda(listingPda);
  const program = getProgram(buyer);

  const instruction = await program.methods
    .buyItem()
    .accounts({
      listingAccount: listingPda,
      escrowVault: vaultPda,
      buyer: buyer,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  return { instruction, vaultPda };
}

/**
 * Builds the Instruction for releasing escrow funds to the seller.
 * On-chain: buyer is the signer — seller is UncheckedAccount validated via listing.seller.
 * vault is closed atomically via Anchor `close = seller` constraint.
 */
export async function buildReleaseFundsInstruction(
  buyer: PublicKey,
  seller: PublicKey,
  listingPda: PublicKey
): Promise<TransactionInstruction> {
  if (!buyer || !(buyer instanceof PublicKey)) {
    throw new Error(`Invalid buyer PublicKey: ${buyer}`);
  }
  if (!seller || !(seller instanceof PublicKey)) {
    throw new Error(`Invalid seller PublicKey: ${seller}`);
  }
  if (!listingPda || !(listingPda instanceof PublicKey)) {
    throw new Error(`Invalid listingPda: ${listingPda}`);
  }

  const [vaultPda] = getVaultPda(listingPda);
  const program = getProgram(buyer);

  return await program.methods
    .releaseFunds()
    .accounts({
      listingAccount: listingPda,
      seller: seller,
      escrowVault: vaultPda,
      buyer: buyer,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/**
 * Builds the Instruction for the admin to resolve a dispute.
 * winnerIsBuyer=true → funds go to buyer (refund)
 * winnerIsBuyer=false → funds go to seller (release)
 */
export async function buildResolveDisputeInstruction(
  admin: PublicKey,
  winner: PublicKey,
  listingPda: PublicKey,
  winnerIsBuyer: boolean
): Promise<TransactionInstruction> {
  if (!admin || !(admin instanceof PublicKey)) {
    throw new Error(`Invalid admin PublicKey: ${admin}`);
  }

  const [vaultPda] = getVaultPda(listingPda);
  const program = getProgram(admin);

  return await program.methods
    .resolveDispute(winnerIsBuyer)
    .accounts({
      listingAccount: listingPda,
      winner: winner,
      escrowVault: vaultPda,
      admin: admin,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/**
 * Builds the Instruction to cancel a listing.
 * vault is closed atomically via Anchor `close = seller` constraint.
 */
export async function buildCancelListingInstruction(
  seller: PublicKey,
  listingPda: PublicKey
): Promise<TransactionInstruction> {
  if (!seller || !(seller instanceof PublicKey)) {
    throw new Error(`Invalid seller PublicKey: ${seller}`);
  }

  const [vaultPda] = getVaultPda(listingPda);
  const program = getProgram(seller);

  return await program.methods
    .cancelListing()
    .accounts({
      listingAccount: listingPda,
      seller: seller,
      escrowVault: vaultPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/**
 * Builds the Instruction to open a dispute on an active escrow.
 * NOTE: open_dispute only has listing_account + initiator — no vault, no system_program.
 */
export async function buildOpenDisputeInstruction(
  initiator: PublicKey,
  listingPda: PublicKey
): Promise<TransactionInstruction> {
  if (!initiator || !(initiator instanceof PublicKey)) {
    throw new Error(`Invalid initiator PublicKey: ${initiator}`);
  }

  const program = getProgram(initiator);

  return await program.methods
    .openDispute()
    .accounts({
      listingAccount: listingPda,
      initiator: initiator,
    })
    .instruction();
}
