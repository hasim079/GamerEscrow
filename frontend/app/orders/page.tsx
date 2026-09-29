'use client';

import React, { useState, useEffect } from 'react';
import { fetchBuyerOrders, ListingRecord, updateListingStatus } from '../../lib/supabaseClient';
import { PublicKey } from '@solana/web3.js';
import { buildReleaseFundsInstruction, buildOpenDisputeInstruction } from '../../lib/anchorClient';
import { buildAndSendVersionedTx } from '../../lib/txUtils';
import { Stepper } from '../../components/ui/Stepper';
import { CountdownTimer } from '../../components/ui/CountdownTimer';
import { DecryptBox } from '../../components/ui/DecryptBox';
import { DisputeModal } from '../../components/modals/DisputeModal';
import { Shield, Copy, Check, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';

export default function OrdersPage() {
  const { publicKey, sendTransaction } = useWallet();
  const { connection } = useConnection();
  const [ordersList, setOrdersList] = useState<ListingRecord[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<ListingRecord | null>(null);
  const [isDisputeOpen, setIsDisputeOpen] = useState(false);
  const [isReleasing, setIsReleasing] = useState(false);
  const [releasedSuccess, setReleasedSuccess] = useState(false);
  const [copiedVault, setCopiedVault] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!publicKey) { setLoading(false); return; }
    
    const loadOrders = async () => {
      try {
        const orders = await fetchBuyerOrders(publicKey.toBase58());
        const active = orders.filter((o) => o.status === 'InEscrow' || o.status === 'InDispute' || o.status === 'Completed');
        setOrdersList(active);
        
        // Only auto-select the first order if none is selected
        setSelectedOrder((prev) => {
          if (!prev && active.length > 0) return active[0];
          // If we already have a selected order, update its data
          if (prev) {
            const updated = active.find(o => o.id === prev.id);
            return updated || prev;
          }
          return null;
        });
        setLoading(false);
      } catch (err) {
        console.error("Error fetching orders:", err);
      }
    };

    // Initial load
    loadOrders();

    // Poll every 3 seconds
    const interval = setInterval(loadOrders, 3000);
    return () => clearInterval(interval);
  }, [publicKey]);

  const handleCopyVault = () => {
    if (!selectedOrder?.vault_pda) return;
    navigator.clipboard.writeText(selectedOrder.vault_pda);
    setCopiedVault(true);
    setTimeout(() => setCopiedVault(false), 2000);
  };

  const handleReleaseFunds = async () => {
    if (!selectedOrder || !publicKey || !sendTransaction) return;
    setIsReleasing(true);
    try {
      if (!selectedOrder.escrow_pda || !selectedOrder.seller_pubkey)
        throw new Error('Missing PDA or seller address.');
      const listingPda = new PublicKey(selectedOrder.escrow_pda);
      const sellerPubkey = new PublicKey(selectedOrder.seller_pubkey);
      const ix = await buildReleaseFundsInstruction(publicKey, sellerPubkey, listingPda);

      const { signature, latestBlockhash } = await buildAndSendVersionedTx(
        connection,
        publicKey,
        sendTransaction as any,
        [ix]
      );
      const confirmation = await connection.confirmTransaction(
        { signature, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight },
        'confirmed'
      );
      if (confirmation.value.err) {
        throw new Error('Transaction failed on blockchain: ' + JSON.stringify(confirmation.value.err));
      }
      await updateListingStatus(selectedOrder.id, 'Completed');
      setReleasedSuccess(true);
      const updated = { ...selectedOrder, status: 'Completed' as const };
      setSelectedOrder(updated);
      setOrdersList((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    } catch (err: any) {
      console.error(err);
      alert('Could not release funds: ' + err.message);
    } finally {
      setIsReleasing(false);
    }
  };

  const handleDisputeSubmit = async (reason: string, details: string, file: File | null) => {
    if (!selectedOrder || !publicKey || !sendTransaction) return;
    try {
      if (!selectedOrder.escrow_pda) throw new Error('Escrow PDA not found. Cannot open dispute.');
      const listingPda = new PublicKey(selectedOrder.escrow_pda);
      const ix = await buildOpenDisputeInstruction(publicKey, listingPda);

      const { signature, latestBlockhash } = await buildAndSendVersionedTx(
        connection,
        publicKey,
        sendTransaction as any,
        [ix]
      );
      const confirmation = await connection.confirmTransaction(
        { signature, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight },
        'confirmed'
      );
      if (confirmation.value.err) {
        throw new Error('Transaction failed on blockchain: ' + JSON.stringify(confirmation.value.err));
      }
      await updateListingStatus(selectedOrder.id, 'InDispute');

      // Backend API for dispute record
      const formData = new FormData();
      formData.append('listing_id', selectedOrder.id);
      formData.append('initiator_pubkey', publicKey.toBase58());
      formData.append('reason', reason);
      if (details) formData.append('details', details);
      if (file) formData.append('file', file);

      const res = await fetch('/api/create-dispute', { method: 'POST', body: formData });
      const result = await res.json();

      if (!result.success) {
        if (result.error?.toLowerCase().includes('upload') || result.error?.toLowerCase().includes('storage')) {
          throw new Error(`File upload failed: ${result.error}`);
        }
        throw new Error(`Could not save dispute: ${result.error}`);
      }

      const updated = { ...selectedOrder, status: 'InDispute' as const };
      setSelectedOrder(updated);
      setOrdersList((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    } catch (err: any) {
      console.error(err);
      alert(err.message || 'An error occurred while opening dispute. Please try again.');
    }
  };

  // Null guard — cüzdan yoksa veya yükleniyor
  if (!publicKey) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 text-center">
        <p className="text-muted-foreground text-sm font-semibold">Connect your wallet to see your orders.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 text-center">
        <p className="text-muted-foreground text-sm">Orders are loading...</p>
      </div>
    );
  }

  if (!selectedOrder || ordersList.length === 0) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 text-center">
        <p className="text-muted-foreground text-sm">You don't have any active orders yet.</p>
      </div>
    );
  }

  const assetPrice = selectedOrder.price_sol;

  const isCompleted = selectedOrder.status === 'Completed';
  const isDisputed = selectedOrder.status === 'InDispute';

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
      {/* Order switcher tabs if multiple orders exist */}
      {ordersList.length > 1 && (
        <div className="mb-6 flex items-center gap-2 overflow-x-auto pb-2 scrollbar-none">
          {ordersList.map((order) => {
            const isSelected = selectedOrder.id === order.id;
            return (
              <button
                key={order.id}
                type="button"
                onClick={() => {
                  setSelectedOrder(order);
                  setReleasedSuccess(false);
                }}
                className={`rounded-xl px-3.5 py-1.5 text-xs font-semibold whitespace-nowrap transition-all ${isSelected
                    ? 'bg-brand text-black font-bold shadow-sm'
                    : 'bg-card border border-border text-muted-foreground hover:text-foreground'
                  }`}
              >
                {order.id.slice(0, 8)}… · {order.game}
              </button>
            );
          })}
        </div>
      )}

      <div className="space-y-6">
        {/* Hero Banner: Escrow Active */}
        <div className="rounded-2xl border border-brand/20 bg-brand/[0.04] dark:bg-brand/[0.07] p-6 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="flex size-11 items-center justify-center rounded-xl bg-brand/15 text-brand shrink-0">
                <Shield className="size-6 stroke-[2.2]" />
              </div>
              <div>
                <div className="flex items-center gap-2.5">
                  <h1 className="text-xl font-bold tracking-tight text-foreground">Escrow is active</h1>
                  <span className="rounded-md bg-brand/15 px-2.5 py-0.5 text-xs font-mono font-bold text-brand">
                    {selectedOrder.id.slice(0, 8)}…
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span>Vault</span>
                  <span className="font-mono text-foreground">{selectedOrder.vault_pda ?? '—'}</span>
                  <button
                    type="button"
                    onClick={handleCopyVault}
                    className="p-1 text-muted-foreground hover:text-foreground transition-colors"
                    title="Copy the vault adress"
                  >
                    {copiedVault ? <Check className="size-3.5 text-brand" /> : <Copy className="size-3.5" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="flex flex-col sm:items-end">
              <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">LOCKED AMOUNT</span>
              <div className="font-mono text-3xl font-extrabold text-foreground">
                {selectedOrder.price_sol.toFixed(2)} SOL
              </div>
            </div>
          </div>
        </div>

        {/* Stepper Progress Bar */}
        <div className="px-2">
          <Stepper currentStep={isCompleted ? 4 : isDisputed ? 3 : 2} />
        </div>

        {/* Middle Two-Column Grid */}
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
          {/* Left: Countdown Timer or Status */}
          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col items-center justify-center">
            {!isCompleted && !isDisputed ? (
              (() => {
                const startedAt = selectedOrder.updated_at ? new Date(selectedOrder.updated_at).getTime() : Date.now();
                const elapsedSec = Math.floor((Date.now() - startedAt) / 1000);
                const remainingSec = Math.max(3600 - elapsedSec, 0); // 60 minutes escrow
                return <CountdownTimer key={selectedOrder.id} initialSeconds={remainingSec} />;
              })()
            ) : isCompleted ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-brand/15 text-brand mb-3">
                  <CheckCircle2 className="size-8" />
                </div>
                <h3 className="text-base font-bold text-foreground">Escrow is completed</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  The funds have been transferred to the seller and the account transfer is completed.
                </p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <div className="flex size-14 items-center justify-center rounded-full bg-rose-500/15 text-rose-500 mb-3">
                  <AlertTriangle className="size-8" />
                </div>
                <h3 className="text-base font-bold text-rose-500">The dispute is being reviewed</h3>
                <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                  Vault funds have been frozen. Moderator arbitration is ongoing.
                </p>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-card p-6 shadow-sm flex flex-col justify-between">
            <div>
              <h3 className="text-sm font-bold text-foreground mb-4">Escrow details</h3>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between text-muted-foreground">
                  <span>Asset price</span>
                  <span className="font-mono font-medium text-foreground">{assetPrice.toFixed(4)} SOL</span>
                </div>
                <div className="border-t border-border pt-3">
                  <div className="flex items-center justify-between text-sm font-bold text-foreground">
                    <span>Total locked</span>
                    <span className="font-mono text-base">{assetPrice.toFixed(4)} SOL</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Seller info */}
            <div className="mt-6 rounded-xl border border-border/80 bg-muted/30 px-4 py-3 text-xs text-muted-foreground flex items-center justify-between">
              <span>
                Seller: <strong className="font-semibold text-foreground">
                  {selectedOrder.seller_pubkey
                    ? `${selectedOrder.seller_pubkey.slice(0, 6)}…${selectedOrder.seller_pubkey.slice(-4)}`
                    : '—'}
                </strong>
              </span>
            </div>
          </div>
        </div>

        {/* Bottom Card: Account Credentials */}
        <DecryptBox
          username=""
          passwordReal=""
          email=""
          securityKeys={undefined}
          listingId={selectedOrder.id}
        />

        {/* Action Buttons */}
        {!isCompleted && !isDisputed && (
          <div className="flex flex-col sm:flex-row sm:items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => setIsDisputeOpen(true)}
              className="rounded-xl border border-border bg-card px-5 py-2.5 text-xs font-semibold text-muted-foreground hover:text-rose-500 hover:border-rose-500/40 transition-colors"
            >
              Report a problem / Dispute
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
                  <span>Vault funds are being released...</span>
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
            <span>The funds have been transferred to the seller! The escrow transaction was completed on Solana.</span>
          </div>
        )}
      </div>

      {/* Dispute Modal */}
      <DisputeModal
        isOpen={isDisputeOpen}
        onClose={() => setIsDisputeOpen(false)}
        onSubmit={handleDisputeSubmit}
        orderId={selectedOrder.id}
      />
    </div>
  );
}
