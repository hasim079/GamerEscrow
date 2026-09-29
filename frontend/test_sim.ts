import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { buildBuyItemInstruction } from './lib/anchorClient';
import { buildAndSendVersionedTx } from './lib/txUtils';

async function testSimulate() {
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  // random buyer
  const buyer = Keypair.generate();
  
  // request some airdrop just in case
  try {
    const sig = await connection.requestAirdrop(buyer.publicKey, 1e9);
    await connection.confirmTransaction(sig);
  } catch (e) {
    console.log("Airdrop failed, skipping...");
  }

  const programId = new PublicKey('EjhkjCLXe6aPg1zpSi9ihJemo4JvYVacQzSi8Nbczytp');
  const dummyListing = PublicKey.unique();

  try {
    const { instruction } = await buildBuyItemInstruction(buyer.publicKey, dummyListing);
    
    const { ComputeBudgetProgram, TransactionMessage, VersionedTransaction } = require('@solana/web3.js');
    const latestBlockhash = await connection.getLatestBlockhash('confirmed');
    
    const messageV0 = new TransactionMessage({
      payerKey: buyer.publicKey,
      recentBlockhash: latestBlockhash.blockhash,
      instructions: [instruction],
    }).compileToV0Message();
    
    const tx = new VersionedTransaction(messageV0);
    
    const sim = await connection.simulateTransaction(tx);
    console.log("SIMULATION RESULT:");
    console.log(JSON.stringify(sim.value, null, 2));
  } catch (e) {
    console.error("ERROR:", e);
  }
}

testSimulate();
