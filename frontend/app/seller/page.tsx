'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { Plus, Link as LinkIcon, Package, Clock, TrendingUp, Upload, CheckCircle2 } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';
import { fetchSellerListings, ListingRecord, fetchDisputesByListing, updateDisputeSellerResponse, DisputeRecord, supabase, deleteListingRecord } from '../../lib/supabaseClient';
import { decryptCredentials } from '../../lib/crypto';
import { PublishingWizardModal } from '../../components/modals/PublishingWizardModal';
import { SellerDisputeResponseModal } from '../../components/modals/SellerDisputeResponseModal';
import { AlertTriangle } from 'lucide-react';

export default function SellerDashboardPage() {
  const [activeTab, setActiveTab] = useState<'drafts' | 'active' | 'escrow' | 'completed'>('drafts');
  const [publishedIds, setPublishedIds] = useState<string[]>([]);
  const [dbListings, setDbListings] = useState<ListingRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [publishingDraft, setPublishingDraft] = useState<ListingRecord | null>(null);
  const [publishingCredentials, setPublishingCredentials] = useState<any>(null);
  
  // Dispute Handling States
  const [respondingListing, setRespondingListing] = useState<ListingRecord | null>(null);
  const [activeDispute, setActiveDispute] = useState<DisputeRecord | null>(null);
  const { publicKey } = useWallet();

  useEffect(() => {
    async function load() {
      if (publicKey) {
        try {
          const list = await fetchSellerListings(publicKey.toBase58());
          setDbListings(list || []);
        } catch (err) {
          console.error("Error fetching seller listings:", err);
        }
      }
      setLoading(false);
    }
    
    // Initial load
    load();

    // Poll every 3 seconds
    const interval = setInterval(load, 3000);
    return () => clearInterval(interval);
  }, [publicKey]);

  const handlePublish = (draft: ListingRecord) => {
    // Draft'ta gerçek credential yoksa (eski placeholder verili kayıtlar) kullanıcıyı uyar
    if (!draft.encrypted_credentials || draft.encrypted_credentials === 'draft_no_credentials') {
      alert('This draft has no encrypted credentials. Please re-create the listing with account credentials before publishing.');
      return;
    }
    
    try {
      const parsed = decryptCredentials(draft.encrypted_credentials, "gamer_escrow_secret_key", draft.encryption_iv);
      setPublishingCredentials(parsed);
      setPublishingDraft(draft);
    } catch (e) {
      console.error(e);
      alert("Failed to decrypt draft credentials. They might be corrupted.");
    }
  };

  const handleRespondDisputeClick = async (listing: ListingRecord) => {
    if (!publicKey) return;
    const dispute = await fetchDisputesByListing(listing.id, publicKey.toBase58());
    if (dispute) {
      setActiveDispute(dispute);
      setRespondingListing(listing);
    } else {
      alert("No active dispute found in the database for this listing.");
    }
  };

  const handleSubmitDisputeResponse = async (response: string, file: File | null) => {
    if (!activeDispute || !publicKey) return;
    
    let evidenceUrl = '';
    if (file) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${activeDispute.id}_seller_${Date.now()}.${fileExt}`;
      const { data, error } = await supabase.storage.from('disputes').upload(fileName, file);
      if (!error && data) {
        const { data: { publicUrl } } = supabase.storage.from('disputes').getPublicUrl(data.path);
        evidenceUrl = publicUrl;
      } else {
        console.warn('File upload failed', error);
      }
    }
    
    const success = await updateDisputeSellerResponse(
      activeDispute.id,
      response,
      evidenceUrl ? [evidenceUrl] : undefined,
      publicKey.toBase58()
    );
    
    if (success) {
      alert("Your response has been submitted successfully.");
    } else {
      alert("Failed to submit response.");
    }
  };

  // Derived lists by status
  const draftListings = dbListings.filter((l) => l.status === 'Draft');
  const activeListings = dbListings.filter((l) => l.status === 'Listed');
  const escrowListings = dbListings.filter((l) => l.status === 'InEscrow' || l.status === 'InDispute');
  const completedListings = dbListings.filter((l) => l.status === 'Completed');
  const totalEarnings = completedListings.reduce((sum, l) => sum + l.price_sol, 0);
  const escrowTotal = escrowListings.reduce((sum, l) => sum + l.price_sol, 0);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Seller Dashboard
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Manage your listings, escrows, and payouts.
          </p>
        </div>

        <Link
          href="/create-listing"
          className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-brand px-5 py-2.5 text-xs font-bold text-black hover:bg-brand-hover active:scale-[0.98] transition-all shadow-sm self-start sm:self-auto"
        >
          <Plus className="size-4" />
          <span>New Listing</span>
        </Link>
      </div>

      {/* 4 Metric Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        {/* Total Earnings */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground mb-3">
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
              <LinkIcon className="size-3.5" />
            </span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-foreground">{loading ? '—' : `${totalEarnings.toFixed(2)} SOL`}</div>
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase mt-1">Total earnings</div>
        </div>

        {/* Active Listings */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground mb-3">
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
              <Package className="size-3.5" />
            </span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-foreground">{loading ? '—' : activeListings.length}</div>
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase mt-1">Active listings</div>
        </div>

        {/* In Escrow */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground mb-3">
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
              <Clock className="size-3.5" />
            </span>
            <span className="text-[11px] font-medium text-muted-foreground">{loading ? '' : `${escrowListings.length} order`}</span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-foreground">{loading ? '—' : `${escrowTotal.toFixed(2)} SOL`}</div>
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase mt-1">ON ESCROW</div>
        </div>

        {/* Completed */}
        <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
          <div className="flex items-center justify-between text-muted-foreground mb-3">
            <span className="flex size-7 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground">
              <TrendingUp className="size-3.5" />
            </span>
          </div>
          <div className="font-mono text-2xl font-extrabold text-foreground">{loading ? '—' : completedListings.length}</div>
          <div className="text-[10px] font-bold tracking-wider text-muted-foreground uppercase mt-1">COMPLETED</div>
        </div>
      </div>


      {/* Tabs */}
      <div className="mb-6 flex items-center gap-1 rounded-xl border border-border bg-muted/20 p-1 w-fit">
        <button
          type="button"
          onClick={() => setActiveTab('drafts')}
          className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
            activeTab === 'drafts'
              ? 'bg-card text-foreground font-bold shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Drafts
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('active')}
          className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
            activeTab === 'active'
              ? 'bg-card text-foreground font-bold shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('escrow')}
          className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
            activeTab === 'escrow'
              ? 'bg-card text-foreground font-bold shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Escrow
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('completed')}
          className={`rounded-lg px-4 py-1.5 text-xs font-semibold transition-all ${
            activeTab === 'completed'
              ? 'bg-card text-foreground font-bold shadow-sm'
              : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Completed
        </button>
      </div>

      {/* Tab: Drafts */}
      {activeTab === 'drafts' && (
        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">LOADING...</p>
          ) : draftListings.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              You don't have a draft listing.{' '}
              <Link href="/create-listing" className="text-brand font-semibold hover:underline">Create a new listing →</Link>
            </div>
          ) : (
            draftListings.map((draft) => {
              const isPublished = publishedIds.includes(draft.id);
              return (
                <div key={draft.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 rounded-2xl border border-border bg-card p-4 shadow-sm">
                  <div className="flex items-center gap-4">
                    <div className="size-14 sm:size-16 rounded-xl bg-muted border border-border shrink-0 flex items-center justify-center text-2xl font-bold text-muted-foreground">
                      {draft.game.slice(0, 1)}
                    </div>
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="rounded-md border border-border/80 bg-muted/50 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Draft</span>
                        <span className="font-mono text-xs font-bold text-foreground">{draft.price_sol} SOL</span>
                      </div>
                      <h3 className="text-sm font-bold text-foreground">{draft.title}</h3>
                    </div>
                  </div>
                  <div className="flex items-center justify-end">
                    {isPublished ? (
                      <div className="inline-flex items-center gap-1.5 text-xs font-bold text-brand bg-brand/10 px-4 py-2 rounded-xl border border-brand/20">
                        <CheckCircle2 className="size-4" />
                        <span>Published on Solana</span>
                      </div>
                    ) : (
                      <button type="button" onClick={() => handlePublish(draft)}
                        className="inline-flex items-center gap-1.5 rounded-xl bg-brand px-5 py-2 text-xs font-bold text-black hover:bg-brand-hover active:scale-[0.98] transition-all shadow-sm">
                        <Upload className="size-3.5" />
                        <span>Publish</span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      )}


      {/* Tab: Active */}
      {activeTab === 'active' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {loading ? (
            <p className="text-sm text-muted-foreground col-span-3">...</p>
          ) : activeListings.length === 0 ? (
            <div className="col-span-3 rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              You don't have any active listing.{' '}
              <Link href="/create-listing" className="text-brand font-semibold hover:underline">Create a listing →</Link>
            </div>
          ) : (
            activeListings.map((listing) => (
              <div key={listing.id} className="rounded-2xl border border-border bg-card overflow-hidden shadow-sm flex flex-col justify-between">
                <div className="h-36 w-full bg-muted flex items-center justify-center text-4xl font-bold text-muted-foreground">
                  {listing.game.slice(0, 1)}
                </div>
                <div className="p-4 flex-1 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-muted-foreground">{listing.game}</span>
                      <span className="font-mono font-bold text-brand">{listing.price_sol} SOL</span>
                    </div>
                    <h4 className="text-sm font-bold text-foreground line-clamp-1">{listing.title}</h4>
                  </div>
                  <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-xs">
                    <span className="text-brand font-semibold text-[11px]">Active in the vault</span>
                    <Link href="/orders" className="text-muted-foreground hover:text-foreground font-medium">view →</Link>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tab: Escrow */}
      {activeTab === 'escrow' && (
        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : escrowListings.length === 0 ? (
            <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
              You don't have any listing in escrow right now.
            </div>
          ) : (
            escrowListings.map((order) => (
              <div key={order.id} className="flex flex-col gap-3 rounded-2xl border border-brand/20 bg-card p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-xs font-bold text-brand">{order.id.slice(0, 8)}…</span>
                      <span className="text-xs font-bold text-foreground">{order.title}</span>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      Buyer: {order.buyer_pubkey ? `${order.buyer_pubkey.slice(0, 6)}…` : '—'} · Vault: {order.vault_pda ?? '—'}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm font-extrabold text-foreground">{order.price_sol} SOL</div>
                    {order.status === 'InDispute' ? (
                      <span className="text-xs font-bold text-rose-500 uppercase mt-1 inline-block">Disputed</span>
                    ) : (
                      <Link href="/orders" className="text-xs text-brand hover:underline font-semibold">Follow →</Link>
                    )}
                  </div>
                </div>
                
                {/* Dispute Alert Block */}
                {order.status === 'InDispute' && (
                  <div className="mt-2 rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="size-5 text-rose-500 shrink-0 mt-0.5" />
                      <div>
                        <h4 className="text-sm font-bold text-rose-500">Buyer Opened a Dispute!</h4>
                        <p className="text-xs text-rose-500/80 mt-1 max-w-lg">
                          Vault funds are locked. Please provide your counter-evidence so our moderators can review both sides fairly.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRespondDisputeClick(order)}
                      className="shrink-0 rounded-xl bg-rose-500 px-5 py-2.5 text-xs font-bold text-white hover:bg-rose-600 transition-all shadow-sm"
                    >
                      Upload Evidence
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}


      {/* Tab: Completed */}
      {activeTab === 'completed' && (
        <div className="space-y-3">
          {loading ? (
            <p className="text-sm text-muted-foreground">Loading...</p>
          ) : completedListings.length === 0 ? (
            <div className="rounded-2xl border border-border bg-card p-8 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand mx-auto mb-3">
                <CheckCircle2 className="size-6" />
              </div>
              <h3 className="text-sm font-bold text-foreground">Completed Handovers</h3>
              <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
                No completed escrow releases yet.
              </p>
            </div>
          ) : (
            completedListings.map((order) => (
              <div key={order.id} className="flex items-center justify-between rounded-2xl border border-emerald-500/20 bg-card p-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-bold text-emerald-500">{order.id.slice(0, 8)}…</span>
                    <span className="text-xs font-bold text-foreground">{order.title}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    Buyer: {order.buyer_pubkey ? `${order.buyer_pubkey.slice(0, 6)}…` : '—'} · Vault: {order.vault_pda ?? '—'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-mono text-sm font-extrabold text-foreground">{order.price_sol} SOL</div>
                  <span className="text-[10px] font-bold text-emerald-500 uppercase mt-1 inline-block">Released</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
      {publishingDraft && publishingCredentials && (
        <PublishingWizardModal
          isOpen={!!publishingDraft}
          onClose={() => {
            setPublishingDraft(null);
            setPublishingCredentials(null);
          }}
          onSuccess={async () => {
            if (publicKey) {
              await deleteListingRecord(publishingDraft.id, publicKey.toBase58());
              setDbListings(prev => prev.filter(d => d.id !== publishingDraft.id));
            }
            setPublishedIds((prev) => [...prev, publishingDraft.id]);
            setPublishingDraft(null);
            setPublishingCredentials(null);
            // Optionally fetch new listings to show the newly published one in 'Active' immediately
            if (publicKey) {
              const list = await fetchSellerListings(publicKey.toBase58());
              setDbListings(list || []);
            }
          }}
          listingTitle={publishingDraft.title}
          priceSol={publishingDraft.price_sol}
          credentialsData={{
            username: publishingCredentials.username,
            password: publishingCredentials.password,
            email: publishingCredentials.email,
            securityKeys: publishingCredentials.securityKeys,
            game: publishingDraft.game,
            description: publishingDraft.description,
            rank: publishingDraft.rank,
          }}
        />
      )}

      {activeDispute && respondingListing && (
        <SellerDisputeResponseModal
          isOpen={!!activeDispute}
          onClose={() => {
            setActiveDispute(null);
            setRespondingListing(null);
          }}
          onSubmit={handleSubmitDisputeResponse}
          disputeReason={activeDispute.reason}
          buyerClaim={activeDispute.details || ''}
          listingTitle={respondingListing.title}
        />
      )}
    </div>
  );
}
