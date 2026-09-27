import { Connection, PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Program, AnchorProvider, Idl, BN } from "@coral-xyz/anchor";
import rawIdl from "./gamer_escrow.json";

// Program ID güvenli tanımlama
const PROGRAM_ID_STR = process.env.NEXT_PUBLIC_PROGRAM_ID || "EjhkjCLXe6aPg1zpSi9ihJemo4JvYVacQzSi8Nbczytp";
if (!PROGRAM_ID_STR) {
  throw new Error("NEXT_PUBLIC_PROGRAM_ID is missing from environment variables!");
}

export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

const ADMIN_PUBKEY_STR = process.env.NEXT_PUBLIC_ADMIN_PUBKEY || "EjhkjCLXe6aPg1zpSi9ihJemo4JvYVacQzSi8Nbczytp";
export const ADMIN_PUBKEY = new PublicKey(ADMIN_PUBKEY_STR);
export const TREASURY_PUBKEY = new PublicKey(ADMIN_PUBKEY_STR);

export const LISTING_SEED = Buffer.from("listing");
export const VAULT_SEED = Buffer.from("vault");

/**
 * Returns a Program instance with forced IDL address binding for browser compatibility.
 */
export function getProgram(walletPublicKey?: PublicKey): Program {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");

  const effectivePublicKey = walletPublicKey || SystemProgram.programId;

  const dummyWallet = {
    publicKey: effectivePublicKey,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any) => txs,
  };

  const dummyProvider = new AnchorProvider(connection, dummyWallet as any, { commitment: "confirmed" });

  // Anchor 0.30 IDL to Anchor 0.29 IDL compatibility converter
  const convertedAccounts = ((rawIdl as any).accounts || []).map((acc: any) => {
    if (acc.type) return acc;
    const matchingType = ((rawIdl as any).types || []).find((t: any) => t.name === acc.name);
    return {
      ...acc,
      type: matchingType ? matchingType.type : { kind: "struct", fields: [] },
    };
  });

  const idl = {
    ...rawIdl,
    name: (rawIdl as any).metadata?.name || (rawIdl as any).name || "gamer_escrow",
    version: (rawIdl as any).metadata?.version || (rawIdl as any).version || "0.1.0",
    address: (rawIdl as any).address || PROGRAM_ID.toBase58(),
    accounts: convertedAccounts,
  };
  return new Program(idl as unknown as Idl, dummyProvider as any);
}

/**
 * Derives the Listing PDA from seller pubkey and 32-byte data_hash.
 */
export function getListingPda(
  seller: PublicKey,
  dataHash: Uint8Array | number[]
): [PublicKey, number] {
  const rawArray = Array.from(dataHash).slice(0, 32);
  while (rawArray.length < 32) {
    rawArray.push(0);
  }
  const hashBuffer = Buffer.from(rawArray);
  return PublicKey.findProgramAddressSync(
    [LISTING_SEED, seller.toBuffer(), hashBuffer],
    PROGRAM_ID
  );
}

/**
 * Derives the Escrow Vault PDA for a given listing PDA.
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
): Promise<{ instruction: TransactionInstruction; listingPda: PublicKey; vaultPda: PublicKey }> {
  if (!seller || !(seller instanceof PublicKey)) {
    throw new Error(`Invalid seller PublicKey value: ${seller}`);
  }

  const [listingPda] = getListingPda(seller, dataHash);
  const [vaultPda] = getVaultPda(listingPda);
  const program = getProgram(seller);

  const lamports = BigInt(Math.round(priceSol * 1e9));
  const rawArray = Array.isArray(dataHash) ? dataHash : Array.from(dataHash);
  const dataHashArray = Array.from(rawArray).slice(0, 32);
  while (dataHashArray.length < 32) {
    dataHashArray.push(0);
  }

  const instruction = await program.methods
    .createListing(new BN(lamports.toString()), dataHashArray)
    .accounts({
      listingAccount: listingPda, // <--- BURASI Rust'taki alan adı ile birebir aynı olmalı ('listing_account' camelCase -> 'listingAccount')
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
 */
export async function buildReleaseFundsInstruction(
  buyer: PublicKey,
  seller: PublicKey,
  listingPda: PublicKey
): Promise<TransactionInstruction> {
  const [vaultPda] = getVaultPda(listingPda);
  const program = getProgram(buyer);

  return await program.methods
    .releaseFunds()
    .accounts({
      listingAccount: listingPda,
      seller: seller,
      escrowVault: vaultPda,
      treasury: TREASURY_PUBKEY,
      buyer: buyer,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/**
 * Builds the Instruction for the admin to resolve a dispute.
 */
export async function buildResolveDisputeInstruction(
  admin: PublicKey,
  winner: PublicKey,
  listingPda: PublicKey,
  winnerIsBuyer: boolean
): Promise<TransactionInstruction> {
  const [vaultVaultPda] = getVaultPda(listingPda);
  const program = getProgram(admin);

  return await program.methods
    .resolveDispute(winnerIsBuyer)
    .accounts({
      listingAccount: listingPda,
      winner: winner,
      escrowVault: vaultVaultPda,
      treasury: TREASURY_PUBKEY,
      admin: admin,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

/**
 * Builds the Instruction to cancel a listing (with 24h lock protection).
 */
export async function buildCancelListingInstruction(
  seller: PublicKey,
  listingPda: PublicKey
): Promise<TransactionInstruction> {
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
 */
export async function buildOpenDisputeInstruction(
  initiator: PublicKey,
  listingPda: PublicKey
): Promise<TransactionInstruction> {
  const program = getProgram(initiator);

  return await program.methods
    .openDispute()
    .accounts({
      listingAccount: listingPda,
      initiator: initiator,
    })
    .instruction();
}
