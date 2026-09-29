
'use client';

import React, { useState, useEffect } from 'react';
import { Shield, KeyRound, Cpu, CheckCircle2, X, AlertCircle } from 'lucide-react';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { encryptCredentials } from '../../lib/crypto';
import { buildCreateListingInstruction } from '../../lib/anchorClient';
import { buildAndSendVersionedTx } from '../../lib/txUtils';
import { createListingRecord } from '../../lib/supabaseClient';

interface PublishingWizardModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  listingTitle: string;
  priceSol: number;
  credentialsData?: {
    username?: string;
    password?: string;
    email?: string;
    securityKeys?: string;
    game?: string;
    description?: string;
    rank?: string;
  };
}

export function PublishingWizardModal({
  isOpen,
  onClose,
  onSuccess,
  listingTitle,
  priceSol,
  credentialsData,
}: PublishingWizardModalProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [isDone, setIsDone] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  useEffect(() => {
    if (!isOpen) {
      setCurrentStep(1);
      setIsDone(false);
      setErrorMessage(null);
      return;
    }

    let isMounted = true;

    async function executeFlow() {
      try {
        setErrorMessage(null);

        if (!publicKey || !sendTransaction) {
          throw new Error('Please connect your Solana wallet.');
        }

        // Step 1: AES-256 Encryption
        setCurrentStep(1);
        if (!credentialsData) {
          throw new Error('Credentials missing. Please enter account details.');
        }
        const encrypted = encryptCredentials(credentialsData, 'gamer_escrow_secret_key');
        if (!isMounted) return;

        // Step 2: Generate Listing PDA
        setCurrentStep(2);
        const { instruction, listingPda, vaultPda } = await buildCreateListingInstruction(
          publicKey,
          priceSol,
          encrypted.dataHashBytes
        );
        if (!isMounted) return;

        // Step 3: Phantom signature + broadcast to blockchain
        setCurrentStep(3);

        const { signature, latestBlockhash } = await buildAndSendVersionedTx(
          connection,
          publicKey,
          sendTransaction as any,
          [instruction]
        );

        // Wait for confirmation
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
            `Blockchain transaction failed: ${JSON.stringify(confirmation.value.err)}`
          );
        }

        if (!isMounted) return;

        // Step 4: Save to Supabase — only after on-chain success
        await createListingRecord({
          seller_pubkey: publicKey.toBase58(),
          buyer_pubkey: null,
          title: listingTitle,
          game: credentialsData.game || '',
          category: 'FPS',
          price_sol: priceSol,
          price_usd: +(priceSol * 145).toFixed(2),
          data_hash: encrypted.dataHashHex,
          encrypted_credentials: encrypted.ciphertext,
          encryption_iv: encrypted.iv,
          status: 'Listed',
          escrow_pda: listingPda.toBase58(),
          vault_pda: vaultPda.toBase58(),
          rank: credentialsData.rank || '',
          description: credentialsData.description || '',
        });

        if (isMounted) {
          setIsDone(true);
        }
      } catch (err: any) {
        console.error('[PublishingWizard] Error:', err);
        if (isMounted) {
          const msg = (err?.message || '').toLowerCase();
          if (msg.includes('rejected') || msg.includes('user denied')) {
            setErrorMessage('Transaction was rejected by the wallet. Please approve the transaction in Phantom.');
          } else if (msg.includes('disconnected') || msg.includes('port')) {
            setErrorMessage(
              'Phantom wallet connection lost. Please open Phantom from your browser toolbar and try again.'
            );
          } else {
            setErrorMessage(err.message || 'Transaction failed or was rejected by wallet.');
          }
        }
      }
    }

    executeFlow();

    return () => {
      isMounted = false;
    };
  }, [isOpen, publicKey, sendTransaction, connection, priceSol, listingTitle, credentialsData]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 animate-in fade-in duration-200">
      <div className="relative w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <button
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
        >
          <X className="size-5" />
        </button>

        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="flex size-10 items-center justify-center rounded-xl bg-brand/10 text-brand">
            <Shield className="size-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-foreground">Solana Escrow Deployment</h3>
            <p className="text-xs text-muted-foreground">Publishing {listingTitle}</p>
          </div>
        </div>

        <div className="my-6 space-y-4">
          {/* Adım 1 */}
          <div className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all ${
            currentStep === 1 && !errorMessage
              ? 'border-brand bg-brand/5 ring-2 ring-brand/20'
              : currentStep > 1
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-border opacity-50'
          }`}>
            <div className={`mt-0.5 flex size-7 items-center justify-center rounded-lg text-xs font-bold ${
              currentStep > 1 ? 'bg-emerald-500 text-white' : 'bg-brand text-brand-foreground'
            }`}>
              {currentStep > 1 ? <CheckCircle2 className="size-4" /> : <KeyRound className="size-4" />}
            </div>
            <div>
              <div className="text-xs font-bold text-foreground">Step 1: AES-256 Client-Side Encryption</div>
              <div className="text-[11px] text-muted-foreground">
                Credentials encrypted locally prior to on-chain vault commitment.
              </div>
            </div>
          </div>

          {/* Adım 2 */}
          <div className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all ${
            currentStep === 2 && !errorMessage
              ? 'border-brand bg-brand/5 ring-2 ring-brand/20'
              : currentStep > 2
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-border opacity-50'
          }`}>
            <div className={`mt-0.5 flex size-7 items-center justify-center rounded-lg text-xs font-bold ${
              currentStep > 2 ? 'bg-emerald-500 text-white' : 'bg-brand text-brand-foreground'
            }`}>
              {currentStep > 2 ? <CheckCircle2 className="size-4" /> : <Cpu className="size-4" />}
            </div>
            <div>
              <div className="text-xs font-bold text-foreground">Step 2: Generate Listing PDA</div>
              <div className="text-[11px] text-muted-foreground">
                Initializing Program Derived Address on Solana.
              </div>
            </div>
          </div>

          {/* Adım 3 */}
          <div className={`flex items-start gap-3 rounded-xl border p-3.5 transition-all ${
            currentStep === 3 && !errorMessage
              ? 'border-brand bg-brand/5 ring-2 ring-brand/20'
              : isDone
              ? 'border-emerald-500/30 bg-emerald-500/5'
              : 'border-border opacity-50'
          }`}>
            <div className={`mt-0.5 flex size-7 items-center justify-center rounded-lg text-xs font-bold ${
              isDone ? 'bg-emerald-500 text-white' : 'bg-brand text-brand-foreground'
            }`}>
              {isDone ? <CheckCircle2 className="size-4" /> : <Shield className="size-4" />}
            </div>
            <div>
              <div className="text-xs font-bold text-foreground">Step 3: Phantom Wallet Approval</div>
              <div className="text-[11px] text-muted-foreground">
                Awaiting transaction sign & broadcast ({priceSol} SOL price listing).
              </div>
            </div>
          </div>
        </div>

        {/* Durum / Butonlar */}
        {errorMessage ? (
          <div className="space-y-3 animate-in zoom-in-95 duration-200">
            <div className="flex items-center gap-2 rounded-xl bg-destructive/10 border border-destructive/30 p-3 text-xs font-medium text-destructive">
              <AlertCircle className="size-4 shrink-0" />
              <span>{errorMessage}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="w-full rounded-xl bg-muted py-2.5 text-xs font-bold text-foreground hover:bg-muted/80 transition-colors"
            >
              Close and Retry
            </button>
          </div>
        ) : isDone ? (
          <div className="space-y-3 animate-in zoom-in-95 duration-200">
            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-3 text-center text-xs font-bold text-emerald-500">
              Listing Successfully Created On-Chain!
            </div>
            <button
              type="button"
              onClick={() => {
                onSuccess();
                onClose();
              }}
              className="w-full rounded-xl bg-emerald-500 py-2.5 text-xs font-bold text-white hover:bg-emerald-600 transition-colors shadow-sm"
            >
              View Listing in Dashboard
            </button>
          </div>
        ) : (
          <div className="flex items-center justify-center gap-2 text-xs font-semibold text-muted-foreground">
            <span className="size-3.5 border-2 border-brand border-t-transparent rounded-full animate-spin" />
            Executing Solana escrow smart contract step {currentStep} of 3...
          </div>
        )}
      </div>
    </div>
  );
}
