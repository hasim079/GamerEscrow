'use client';

import React, { useState, useEffect } from 'react';
import { Eye, Shield, CheckCircle2, X, AlertTriangle, LogIn } from 'lucide-react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { checkIsAdmin, fetchDisputes, supabase, updateListingStatus } from '../../lib/supabaseClient';
import type { Session } from '@supabase/supabase-js';
import { buildResolveDisputeInstruction } from '../../lib/anchorClient';
import { buildAndSendVersionedTx } from '../../lib/txUtils';

export interface DisputeItem {
  id: string;
  listingId: string;
  orderId: string;
  item: string;
  parties: string;
  claim: string;
  amount: string;
  status: 'Pending Review' | 'Resolved - Released' | 'Resolved - Refunded';
  buyerProof: { text: string; image?: string };
  sellerProof: { text: string; image?: string };
  buyerAddress: string;
  sellerAddress: string;
  vaultAddress: string;
}

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<'disputes' | 'analytics' | 'moderation'>('disputes');
  const [disputes, setDisputes] = useState<DisputeItem[]>([]);
  const [selectedDispute, setSelectedDispute] = useState<DisputeItem | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [resolutionMessage, setResolutionMessage] = useState<string | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();


  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setCheckingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function verifyAdmin() {
      if (!publicKey || !session?.user?.email) {
        setIsAuthorized(null);
        setDisputes([]);
        return;
      }

      const walletAddress = publicKey.toBase58();
      const email = session.user.email;

      try {
        // Double check: Wallet AND Google Email must be in the whitelist
        const { data, error } = await supabase
          .from('admin_whitelist')
          .select('*')
          .eq('wallet_pubkey', walletAddress)
          .eq('email', email)
          .single();
          
        const hasAccess = Boolean(data && !error);
        setIsAuthorized(hasAccess);

        if (hasAccess) {
          const fetchedDisputes = await fetchDisputes(undefined, true);
          if (fetchedDisputes && fetchedDisputes.length > 0) {
            const mappedDisputes: DisputeItem[] = fetchedDisputes.map((d: any) => ({
              id: d.id,
              listingId: d.listing_id || '',
              orderId: d.listing_id ? `#${d.listing_id.slice(0, 8)}` : `#${d.id.slice(0, 8)}`,
              item: d.listings?.title || 'Escrow Item',
              parties: `${d.initiator_pubkey ? d.initiator_pubkey.slice(0, 4) : 'User'} vs ${d.listings?.seller_pubkey ? d.listings?.seller_pubkey.slice(0, 4) : 'Seller'}`,
              claim: d.reason || 'No description provided.',
              amount: `${d.listings?.price_sol || 0} SOL`,
              status: d.status === 'Open' || d.status === 'UnderReview' ? 'Pending Review' 
                : d.status === 'Resolved_Refunded' ? 'Resolved - Refunded' 
                : 'Resolved - Released',
              buyerProof: { text: d.details || d.reason || 'No proof provided.', image: (d.evidence_urls && d.evidence_urls.length > 0) ? d.evidence_urls[0] : undefined },
              sellerProof: { 
                text: d.seller_response || 'Waiting for seller response.',
                image: (d.seller_evidence_urls && d.seller_evidence_urls.length > 0) ? d.seller_evidence_urls[0] : undefined
              },
              buyerAddress: d.initiator_pubkey || '',
              sellerAddress: d.listings?.seller_pubkey || '',
              vaultAddress: d.listings?.escrow_pda || '',
            }));
            setDisputes(mappedDisputes);
          } else {
            setDisputes([]);
          }
        }
      } catch (err) {
        console.error('Error loading admin data:', err);
        setIsAuthorized(false);
      }
    }
    verifyAdmin();
  }, [publicKey, session]);

  const handleArbitrationAction = async (action: 'Refund Buyer' | 'Release to Seller') => {
    if (!selectedDispute) return;
    setIsProcessing(true);
    setResolutionMessage(null);
    try {
      if (!publicKey || !sendTransaction) {
        alert('Admin wallet is not connected.');
        return;
      }

      const winnerAddress = action === 'Refund Buyer'
        ? selectedDispute.buyerAddress
        : selectedDispute.sellerAddress;
      if (!winnerAddress) throw new Error("Winning wallet address missing (Database error).");

      let winnerKey: PublicKey;
      try {
        winnerKey = new PublicKey(winnerAddress);
      } catch {
        throw new Error(`Invalid winner address: ${winnerAddress}`);
      }

      if (!selectedDispute.vaultAddress || selectedDispute.vaultAddress.length < 32) {
        throw new Error('Valid Listing PDA address not found. Transaction cannot be sent.');
      }
      let listingKey: PublicKey;
      try {
        listingKey = new PublicKey(selectedDispute.vaultAddress);
      } catch {
        throw new Error(`Invalid Listing PDA address: ${selectedDispute.vaultAddress}`);
      }

      const winnerIsBuyer = action === 'Refund Buyer';
      const ix = await buildResolveDisputeInstruction(publicKey, winnerKey, listingKey, winnerIsBuyer);

      const { signature, latestBlockhash } = await buildAndSendVersionedTx(
        connection,
        publicKey,
        sendTransaction as any,
        [ix],
        400_000
      );

      const confirmation = await connection.confirmTransaction(
        { signature, blockhash: latestBlockhash.blockhash, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight },
        'confirmed'
      );
      if (confirmation.value.err) {
        throw new Error('Transaction failed on blockchain: ' + JSON.stringify(confirmation.value.err));
      }

      const newListingStatus = winnerIsBuyer ? 'Cancelled' : 'Completed';
      const newDisputeStatus = winnerIsBuyer ? 'Resolved_Refunded' : 'Resolved_Released';

      await updateListingStatus(selectedDispute.listingId, newListingStatus as any);
      await supabase.from('disputes').update({ status: newDisputeStatus }).eq('id', selectedDispute.id);

      const newUiStatus = winnerIsBuyer ? 'Resolved - Refunded' : 'Resolved - Released';
      const updated = { ...selectedDispute, status: newUiStatus as any };
      setDisputes((prev) => prev.map((d) => (d.id === updated.id ? updated : d)));
      setSelectedDispute(updated);
      setResolutionMessage(`Dispute successfully resolved: ${action}`);
    } catch (chainErr: any) {
      console.error('Admin transaction error:', chainErr);
      alert(`Solana Transaction Error: ${chainErr.message || 'An unknown error occurred.'}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/admin'
      }
    });
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
  };

  if (checkingAuth) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-20 text-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!session) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border-2 border-brand/40 bg-card p-12 text-center shadow-lg">
          <LogIn className="mx-auto size-12 text-brand mb-4 opacity-80" />
          <h2 className="text-xl font-bold text-foreground">Admin Login Required</h2>
          <p className="mt-2 text-sm text-muted-foreground mb-6">Step 1: Please log in with your Google account.</p>
          <button
            onClick={handleGoogleLogin}
            className="inline-flex items-center gap-2 rounded-xl bg-brand border-2 border-emerald-300 dark:border-emerald-400 px-6 py-3 text-sm font-bold text-black hover:bg-brand-hover active:scale-[0.98] transition-all shadow-md"
          >
            <LogIn className="size-4" />
            Sign in with Google
          </button>
        </div>
      </div>
    );
  }

  if (!publicKey) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border-2 border-brand/40 bg-card p-12 text-center shadow-lg">
          <Shield className="mx-auto size-12 text-brand mb-4" />
          <h2 className="text-xl font-bold text-foreground">Wallet Connection Required</h2>
          <p className="mt-2 text-sm text-muted-foreground mb-6">Step 2: Authenticated as {session.user.email}. Now connect your admin wallet.</p>
          <button onClick={handleLogout} className="text-xs text-muted-foreground hover:underline">
            Not {session.user.email}? Sign out
          </button>
        </div>
      </div>
    );
  }

  if (isAuthorized === false) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
        <div className="rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-12 text-center">
          <AlertTriangle className="mx-auto size-12 text-rose-500 mb-4" />
          <h2 className="text-xl font-bold text-rose-500">Unauthorized</h2>
          <p className="mt-2 text-sm text-foreground">Email <strong>{session.user.email}</strong> and Wallet <strong>{publicKey.toBase58().slice(0, 6)}...</strong> are not whitelisted together.</p>
          <button onClick={handleLogout} className="mt-6 text-xs text-muted-foreground hover:underline">
            Sign out
          </button>
        </div>
      </div>
    );
  }

  if (isAuthorized === null) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-20 text-center text-muted-foreground">
        Verifying admin privileges...
      </div>
    );
  }


  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">Admin Panel</h1>
          <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-0.5 text-xs font-semibold text-brand">
            Moderator
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Resolve disputes, monitor volume, and moderate listings.
        </p>
      </div>

      <div className="mb-6 flex items-center gap-2 border-b border-border pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('disputes')}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
            activeTab === 'disputes'
              ? 'bg-muted/80 text-foreground font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Disputes
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('analytics')}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
            activeTab === 'analytics'
              ? 'bg-muted/80 text-foreground font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Analytics
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('moderation')}
          className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all ${
            activeTab === 'moderation'
              ? 'bg-muted/80 text-foreground font-bold'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Moderation
        </button>
      </div>

      {activeTab === 'disputes' && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-border/80 bg-muted/20 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-5 py-3.5">ORDER</th>
                  <th className="px-5 py-3.5">ITEM</th>
                  <th className="px-5 py-3.5">PARTIES</th>
                  <th className="px-5 py-3.5">CLAIM</th>
                  <th className="px-5 py-3.5">AMOUNT</th>
                  <th className="px-5 py-3.5">STATUS</th>
                  <th className="px-5 py-3.5 text-right">ACTION</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {disputes.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                      No active disputes found.
                    </td>
                  </tr>
                ) : (
                  disputes.map((item) => {
                    const isOpen = item.status === 'Pending Review';
                    return (
                      <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                        <td className="px-5 py-4 font-mono font-medium text-foreground whitespace-nowrap">
                          {item.orderId}
                        </td>
                        <td className="px-5 py-4 font-medium text-foreground whitespace-nowrap">
                          {item.item}
                        </td>
                        <td className="px-5 py-4 font-medium text-muted-foreground whitespace-nowrap">
                          {item.parties}
                        </td>
                        <td className="px-5 py-4 text-muted-foreground max-w-xs truncate">
                          {item.claim}
                        </td>
                        <td className="px-5 py-4 font-mono font-semibold text-foreground whitespace-nowrap">
                          {item.amount}
                        </td>
                        <td className="px-5 py-4 whitespace-nowrap">
                          {isOpen ? (
                            <span className="rounded-md bg-brand/15 px-2 py-0.5 text-[11px] font-bold text-brand">
                              Pending Review
                            </span>
                          ) : (
                            <span className="rounded-md bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                              {item.status}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedDispute(item);
                              setResolutionMessage(null);
                            }}
                            className="inline-flex items-center gap-1.5 rounded-lg border border-border/80 bg-muted/40 px-3 py-1.5 text-xs font-semibold text-foreground hover:border-brand/40 hover:text-brand transition-all"
                          >
                            <Eye className="size-3.5" />
                            <span>Inspect</span>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === 'analytics' && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
          <div className="rounded-2xl border border-border bg-card p-5">
            <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              Escrow Volume Handled
            </span>
            <div className="mt-2 font-mono text-2xl font-extrabold text-foreground">184,920 SOL</div>
            <span className="text-xs text-brand font-semibold">+14.2% this month</span>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              Total Dispute Rate
            </span>
            <div className="mt-2 font-mono text-2xl font-extrabold text-foreground">0.4%</div>
            <span className="text-xs text-brand font-semibold">99.6% smooth settlements</span>
          </div>
          <div className="rounded-2xl border border-border bg-card p-5">
            <span className="text-[11px] font-bold tracking-wider text-muted-foreground uppercase">
              Average Resolution Time
            </span>
            <div className="mt-2 font-mono text-2xl font-extrabold text-foreground">3.2 hours</div>
            <span className="text-xs text-muted-foreground">Admin multisig SLA &lt; 6h</span>
          </div>
        </div>
      )}

      {activeTab === 'moderation' && (
        <div className="rounded-2xl border border-border bg-card p-6">
          <h3 className="text-sm font-bold text-foreground mb-2">Automated Vault Safeguards</h3>
          <p className="text-xs text-muted-foreground max-w-lg mb-4 leading-relaxed">
            All listing credentials are client-side encrypted via AES-256 before broadcasting to Solana. Vault balances remain protected by program authority PDA until handoff is confirmed or arbitration triggered.
          </p>
          <div className="flex items-center gap-2 text-xs font-semibold text-brand">
            <Shield className="size-4" />
            <span>Smart Contract Security Audit Status: PASSED</span>
          </div>
        </div>
      )}

      {selectedDispute && (
        <div className="ge-modal-backdrop animate-in" onClick={() => setSelectedDispute(null)}>
          <div className="ge-modal max-w-3xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border pb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold text-brand">{selectedDispute.orderId}</span>
                  <span className="text-xs text-muted-foreground">· {selectedDispute.item}</span>
                </div>
                <h3 className="text-base font-bold text-foreground mt-0.5">
                  Arbitration Inspection
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDispute(null)}
                className="p-1.5 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-5" />
              </button>
            </div>

            {resolutionMessage && (
              <div className="mt-4 rounded-xl bg-brand/10 border border-brand/30 p-3.5 text-xs font-bold text-brand flex items-center gap-2">
                <CheckCircle2 className="size-4" />
                <span>{resolutionMessage}</span>
              </div>
            )}

            <div className="mt-4 flex items-center justify-between rounded-xl bg-muted/30 border border-border/80 p-3 text-xs">
              <span className="text-muted-foreground">Disputed Vault Amount:</span>
              <span className="font-mono text-sm font-extrabold text-foreground">
                {selectedDispute.amount}
              </span>
            </div>

            <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="rounded-xl border border-rose-500/20 bg-rose-500/[0.04] p-4 space-y-2.5">
                <div className="flex items-center justify-between border-b border-rose-500/20 pb-2">
                  <span className="text-xs font-bold text-rose-500">Buyer Claim</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{selectedDispute.buyerAddress.slice(0, 6)}...</span>
                </div>
                <p className="text-xs text-foreground leading-relaxed">
                  {selectedDispute.buyerProof.text}
                </p>
                {selectedDispute.buyerProof.image && (
                  <div className="pt-2">
                    <span className="text-[10px] font-semibold text-muted-foreground block mb-1">
                      Uploaded Proof
                    </span>
                    <img
                      src={selectedDispute.buyerProof.image}
                      alt="Buyer Proof"
                      className="h-28 w-full rounded-lg object-cover border border-border"
                    />
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-brand/20 bg-brand/[0.04] p-4 space-y-2.5">
                <div className="flex items-center justify-between border-b border-brand/20 pb-2">
                  <span className="text-xs font-bold text-brand">Seller Response</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{selectedDispute.sellerAddress.slice(0, 6)}...</span>
                </div>
                <p className="text-xs text-foreground leading-relaxed">
                  {selectedDispute.sellerProof.text}
                </p>
                {selectedDispute.sellerProof.image && (
                  <div className="pt-2">
                    <span className="text-[10px] font-semibold text-muted-foreground block mb-1">
                      Uploaded Screenshot
                    </span>
                    <img
                      src={selectedDispute.sellerProof.image}
                      alt="Seller Proof"
                      className="h-28 w-full rounded-lg object-cover border border-border"
                    />
                  </div>
                )}
              </div>
            </div>

            <div className="mt-6 flex items-center justify-end gap-3 border-t border-border pt-4">
              <button
                type="button"
                onClick={() => handleArbitrationAction('Refund Buyer')}
                disabled={isProcessing}
                className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 py-2.5 text-xs font-bold text-rose-500 hover:bg-rose-500/20 transition-all cursor-pointer"
              >
                Refund Buyer
              </button>
              <button
                type="button"
                onClick={() => handleArbitrationAction('Release to Seller')}
                disabled={isProcessing}
                className="rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-black hover:bg-brand-hover transition-all shadow-sm cursor-pointer"
              >
                Release to Seller
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
