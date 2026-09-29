'use client';

import React, { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Stepper } from '../../../components/ui/Stepper';
import { CountdownTimer } from '../../../components/ui/CountdownTimer';
import { DecryptBox } from '../../../components/ui/DecryptBox';
import { DisputeModal } from '../../../components/modals/DisputeModal';
import { Shield, Copy, Check, CheckCircle2, AlertTriangle, ArrowLeft } from 'lucide-react';
import Link from 'next/link';

import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import {
  buildReleaseFundsInstruction,
  buildOpenDisputeInstruction,
} from '../../../lib/anchorClient';
import { buildAndSendVersionedTx } from '../../../lib/txUtils';
import {
  fetchListingById,
  updateListingStatus,
  ListingRecord,
} from '../../../lib/supabaseClient';

export default function OrderDetailPage() {
  const params = useParams();
  const orderIdParam = params?.id as string;

  const [selectedOrder, setSelectedOrder] = useState<ListingRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [isDisputeOpen, setIsDisputeOpen] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [releasedSuccess, setReleasedSuccess] = useState(false);
  const [copiedVault, setCopiedVault] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();

  useEffect(() => {
    async function loadOrder() {
      if (!orderIdParam) {
        setLoading(false);
        return;
      }
      try {
        const dbListing = await fetchListingById(orderIdParam);
        setSelectedOrder(dbListing);
      } catch (err) {
        console.error('[OrderDetail] Error fetching order:', err);
      } finally {
        setLoading(false);
      }
    }

    loadOrder();

    // Poll every 5 seconds for status updates
    const interval = setInterval(loadOrder, 5000);
    return () => clearInterval(interval);
  }, [orderIdParam]);

  const handleCopyVault = () => {
    if (!selectedOrder?.vault_pda) return;
    navigator.clipboard.writeText(selectedOrder.vault_pda);
    setCopiedVault(true);
    setTimeout(() => setCopiedVault(false), 2000);
  };

  // ── Release Funds ───────────────────────────────────────────────────────────
  const handleReleaseFunds = async () => {
    setActionError(null);

    if (!publicKey || !sendTransaction) {
      setActionError('Please connect your wallet.');
      return;
    }
    if (!selectedOrder) return;

    // Guard: escrow_pda is required — never use a fake fallback
    if (!selectedOrder.escrow_pda) {
      setActionError(
        'Listing PDA address for this order could not be found. Please contact support.'
      );
      return;
    }
    if (!selectedOrder.seller_pubkey) {
      setActionError('Seller address not found.');
      return;
    }

    setIsReleasing(true);
    try {
      const sellerKey = new PublicKey(selectedOrder.seller_pubkey);
      const listingKey = new PublicKey(selectedOrder.escrow_pda);

      const ix = await buildReleaseFundsInstruction(publicKey, sellerKey, listingKey);

      const { signature, latestBlockhash } = await buildAndSendVersionedTx(
        connection,
        publicKey,
        sendTransaction as any,
        [ix]
      );

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
          'Transaction failed on-chain: ' + JSON.stringify(confirmation.value.err)
        );
      }

      await updateListingStatus(selectedOrder.id, 'Completed');
      setReleasedSuccess(true);
      setSelectedOrder((prev) =>
        prev ? { ...prev, status: 'Completed' as const } : prev
      );
    } catch (err: any) {
      console.error('[ReleaseFunds]', err);
      setActionError(err.message || 'Transaction failed. Please try again.');
    } finally {
      setIsReleasing(false);
    }
  };

  // ── Dispute Submit ──────────────────────────────────────────────────────────
  const handleDisputeSubmit = async (
    reason: string,
    details: string,
    file: File | null
  ) => {
    setActionError(null);

    if (!publicKey || !sendTransaction) {
      throw new Error('Wallet not connected.');
    }
    if (!selectedOrder) return;

    // Guard: escrow_pda is required — never use a fake fallback
    if (!selectedOrder.escrow_pda) {
      throw new Error(
        'Listing PDA address is missing. Cannot open dispute on-chain.'
      );
    }

    const listingKey = new PublicKey(selectedOrder.escrow_pda);

    // ── 1. On-chain: openDispute instruction ─────────────────────────────────
    const ix = await buildOpenDisputeInstruction(publicKey, listingKey);

    const { signature, latestBlockhash } = await buildAndSendVersionedTx(
      connection,
      publicKey,
      sendTransaction as any,
      [ix]
    );

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
        'On-chain dispute transaction failed: ' +
          JSON.stringify(confirmation.value.err)
      );
    }

    // ── 2. Backend API: create dispute record + update listing status ─────────
    // Using the API route (FormData) so the server can handle storage upload
    // and use the service_role key to bypass RLS atomically.
    const formData = new FormData();
    formData.append('listing_id', selectedOrder.id);
    formData.append('initiator_pubkey', publicKey.toBase58());
    formData.append('reason', reason);
    formData.append('details', details);
    if (file) formData.append('file', file);

    const res = await fetch('/api/create-dispute', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();
    if (!data.success) {
      throw new Error(
        data.error || 'Failed to create dispute record in database.'
      );
    }

    // ── 3. Update local state ─────────────────────────────────────────────────
    // The API route already updated the listing status in the DB.
    // Update local state to reflect immediately.
    setSelectedOrder((prev) =>
      prev ? { ...prev, status: 'InDispute' as const } : prev
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 text-center">
        <p className="text-muted-foreground text-sm">Orders are loading...</p>
      </div>
    );
  }

  if (!selectedOrder) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 text-center">
        <p className="text-muted-foreground text-sm">Order not found.</p>
        <Link
          href="/orders"
          className="mt-4 inline-block text-brand text-xs font-semibold hover:underline"
        >
          Return to Orders
        </Link>
      </div>
    );
  }

  const assetPrice = selectedOrder.price_sol;
  const isCompleted = selectedOrder.status === 'Completed';
  const isDisputed = selectedOrder.status === 'InDispute';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      <div className="mb-6 flex items-center justify-between">
        <Link
          href="/orders"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="size-4" />Return to Orders
        </Link>
      </div>

      <div className="space-y-6">
        {/* Escrow header */}
        <div className="rounded-2xl border border-brand/20 bg-brand/[0.04] dark:bg-brand/[0.07] p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex size-11 items-center justify-center rounded-xl bg-brand/15 text-brand shrink-0">
                <Shield className="size-6 stroke-[2.2]" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-bold tracking-tight text-foreground">
                    Active Escrow
                  </h1>
                  <span className="rounded-md bg-brand/15 px-2.5 py-0.5 text-xs font-mono font-bold text-brand">
                    Order {selectedOrder.id.slice(0, 8)}...
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>Vault</span>
                  <span className="font-mono text-foreground">
                    {selectedOrder.vault_pda
                      ? `${selectedOrder.vault_pda.slice(0, 8)}...${selectedOrder.vault_pda.slice(-6)}`
                      : '—'}
                  </span>
                  {selectedOrder.vault_pda && (
                    <button
                      type="button"
                      onClick={handleCopyVault}
                      className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copiedVault ? (
                        <Check className="size-3.5 text-brand" />
                      ) : (
                        <Copy className="size-3.5" />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:items-end">
              <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
                Locked amount
              </span>
              <div className="font-mono text-3xl font-extrabold text-foreground">
                {assetPrice.toFixed(2)} SOL
              </div>
            </div>
          </div>
        </div>

        <div className="px-2">
          <Stepper currentStep={isCompleted ? 4 : isDisputed ? 3 : 2} />
        </div>

        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Status / Timer */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col items-center justify-center">
            {!isCompleted && !isDisputed ? (
              <CountdownTimer initialSeconds={2570} />
            ) : isCompleted ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-brand/15 text-brand mb-3">
                  <CheckCircle2 className="size-8" />
                </div>
                <h3 className="text-base font-bold text-foreground">
                  Escrow completed
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  The funds have been transferred to the seller and the account
                  transfer is complete.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-rose-500/15 text-rose-500 mb-3">
                  <AlertTriangle className="size-8" />
                </div>
                <h3 className="text-base font-bold text-rose-500">
                  Dispute in Progress
                </h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  The escrow is currently in dispute. Please wait for the
                  resolution process to complete.
                </p>
              </div>
            )}
          </div>

          {/* Escrow details */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground mb-4">
                Escrow details
              </h3>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Asset Price</span>
                  <span className="font-mono font-medium text-foreground">
                    {assetPrice.toFixed(4)} SOL
                  </span>
                </div>
                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between text-sm font-bold text-foreground">
                    <span>Total locked</span>
                    <span className="font-mono text-base">
                      {assetPrice.toFixed(4)} SOL
                    </span>
                  </div>
                </div>
              </div>
            </div>

            <div className="mt-6 rounded-xl border border-border/80 bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex items-center justify-between">
              <span>
                Seller:{' '}
                <strong className="font-semibold text-foreground">
                  {selectedOrder.seller_pubkey
                    ? `${selectedOrder.seller_pubkey.slice(0, 6)}...`
                    : 'unknown'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        <DecryptBox
          username=""
          passwordReal=""
          email=""
          securityKeys={undefined}
          listingId={selectedOrder.id}
        />

        {/* Action error */}
        {actionError && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3 text-xs font-medium text-rose-500 flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {/* Action buttons */}
        {!isCompleted && !isDisputed && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setActionError(null);
                setIsDisputeOpen(true);
              }}
              className="rounded-xl border border-border bg-card px-5 py-2.5 text-xs font-semibold text-muted-foreground hover:text-rose-500 hover:border-rose-500/40 transition-colors"
            >
              Report a problem / dispute
            </button>

            <button
              type="button"
              onClick={handleReleaseFunds}
              disabled={isReleasing}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-brand px-6 py-2.5 text-xs font-bold text-black hover:bg-brand-hover active:scale-[0.98] transition-all shadow-sm"
            >
              {isReleasing ? (
                <>
                  <span className="size-3.5 border-2 border-black border-t-transparent rounded-full animate-spin" />
                  <span>Funds are being released...</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="size-4" />
                  <span>Confirm &amp; Release the funds</span>
                </>
              )}
            </button>
          </div>
        )}

        {releasedSuccess && (
          <div className="rounded-xl bg-brand/10 border border-brand/30 p-4 text-center text-xs font-bold text-brand flex items-center justify-center gap-2">
            <CheckCircle2 className="size-4" />
            <span>
              The funds have been transferred to the seller! Escrow transaction
              was completed on Solana.
            </span>
          </div>
        )}
      </div>

      <DisputeModal
        isOpen={isDisputeOpen}
        onClose={() => setIsDisputeOpen(false)}
        onSubmit={handleDisputeSubmit}
        orderId={selectedOrder.id}
      />
    </div>
  );
}
