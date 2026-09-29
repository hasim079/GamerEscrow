'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { X, Lock, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import { ListingRecord } from '../../lib/supabaseClient';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { buildBuyItemInstruction } from '../../lib/anchorClient';
import { buildAndSendVersionedTx } from '../../lib/txUtils';
import { updateListingStatus } from '../../lib/supabaseClient';

interface BuyEscrowModalProps {
  isOpen: boolean;
  onClose: () => void;
  listing: ListingRecord | null;
}

export function BuyEscrowModal({ isOpen, onClose, listing }: BuyEscrowModalProps) {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  if (!isOpen || !listing) return null;

  const handleConfirmLock = async () => {
    setErrorMessage(null);

    if (!publicKey || !sendTransaction) {
      setErrorMessage('Please connect your Solana wallet first.');
      return;
    }

    if (!listing.escrow_pda) {
      setErrorMessage('Invalid listing: Escrow PDA address not found.');
      return;
    }

    setIsProcessing(true);

    try {
      // 1. Get Listing PDA
      const listingPdaPublicKey = new PublicKey(listing.escrow_pda);

      // 2. Build Buy instruction
      const { instruction, vaultPda } = await buildBuyItemInstruction(
        publicKey,
        listingPdaPublicKey
      );

      // 3. Send with VersionedTransaction (includes ComputeBudget + retry)
      const { signature, latestBlockhash } = await buildAndSendVersionedTx(
        connection,
        publicKey,
        sendTransaction as any,
        [instruction]
      );

      // 4. Wait for confirmation
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        'confirmed'
      );

      if (confirmation.value.err) {
        throw new Error(
          `Transaction failed on blockchain: ${JSON.stringify(confirmation.value.err)}`
        );
      }

      // 5. Update Supabase
      const success = await updateListingStatus(
        listing.id,
        'InEscrow',
        publicKey.toBase58(),
        vaultPda.toBase58()
      );

      if (!success) {
        setErrorMessage(
          'Blockchain transaction successful but database update failed. Please contact support.'
        );
        return;
      }

      onClose();
      router.push(`/orders/${listing.id}`);
    } catch (err: any) {
      console.error('[BuyEscrow] Error:', err);
      setErrorMessage(err.message || 'An error occurred during the transaction.');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="ge-modal-backdrop" onClick={onClose}>
      <div className="ge-modal" style={{ maxWidth: '28rem' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', paddingBottom: '1rem', borderBottom: '1px solid var(--card-border)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ display: 'flex', width: '2.5rem', height: '2.5rem', alignItems: 'center', justifyContent: 'center', borderRadius: '0.75rem', backgroundColor: 'rgba(16,185,129,0.1)', color: 'var(--brand)' }}>
              <Lock size={18} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--fg)' }}>
                Lock Funds in Solana Vault
              </h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted-fg)' }}>
                Order Escrow Initialization
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="ge-btn-icon">
            <X size={18} />
          </button>
        </div>

        {/* Listing summary */}
        <div style={{ border: '1px solid var(--card-border)', borderRadius: '0.75rem', padding: '1rem', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div style={{ width: '3rem', height: '3rem', borderRadius: '0.5rem', backgroundColor: 'var(--card-border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold' }}>
              {listing.game ? listing.game.slice(0, 1) : '?'}
            </div>
            <div>
              <span style={{ fontSize: '0.6875rem', fontWeight: 600, textTransform: 'uppercase', color: 'var(--brand)' }}>
                {listing.game} · {listing.rank || 'N/A'}
              </span>
              <h4 style={{ margin: 0, fontSize: '0.75rem', fontWeight: 700, color: 'var(--fg)' }}>
                {listing.title}
              </h4>
            </div>
          </div>

          <div style={{ borderTop: '1px solid var(--card-border)', paddingTop: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem' }}>
              <span style={{ color: 'var(--muted-fg)' }}>Listing Price</span>
              <span style={{ fontFamily: 'monospace', fontWeight: 600, color: 'var(--fg)' }}>
                {listing.price_sol} SOL
              </span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem', borderTop: '1px solid var(--card-border)', fontSize: '0.875rem', fontWeight: 700 }}>
              <span style={{ color: 'var(--fg)' }}>Total to Lock</span>
              <span style={{ fontFamily: 'monospace', color: 'var(--brand)' }}>
                {listing.price_sol} SOL
              </span>
            </div>
          </div>
        </div>

        {/* Hata bildirimi */}
        {errorMessage && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', color: '#ef4444', backgroundColor: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1rem' }}>
            <AlertCircle size={16} style={{ flexShrink: 0 }} />
            <span>{errorMessage}</span>
          </div>
        )}

        {/* Güven göstergesi */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.6875rem', color: 'var(--brand)', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '0.5rem', padding: '0.75rem', marginBottom: '1.25rem' }}>
          <ShieldCheck size={14} style={{ flexShrink: 0, marginTop: 2 }} />
          <span>
            Funds are locked safely in a Solana smart contract vault. The seller receives SOL only after you confirm the account handoff.
          </span>
        </div>

        {/* Butonlar */}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={isProcessing}
            style={{ flex: 1, borderRadius: '0.75rem', border: '1px solid var(--card-border)', backgroundColor: 'var(--bg)', padding: '0.75rem', fontSize: '0.75rem', fontWeight: 700, color: 'var(--muted-fg)', cursor: 'pointer' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirmLock}
            disabled={isProcessing}
            className="ge-btn-primary"
            style={{ flex: 2, height: 'auto', padding: '0.75rem', borderRadius: '0.75rem' }}
          >
            {isProcessing ? (
              <>
                <span style={{ width: '0.875rem', height: '0.875rem', border: '2px solid rgba(255,255,255,0.5)', borderTop: '2px solid #fff', borderRadius: '9999px', animation: 'spin 0.7s linear infinite', display: 'inline-block' }} />
                Depositing...
              </>
            ) : (
              <>
                Confirm & Deposit SOL <ArrowRight size={14} />
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
