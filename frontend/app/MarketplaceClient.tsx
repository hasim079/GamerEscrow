'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { Search, ShieldCheck, ChevronDown } from 'lucide-react';
import { fetchMarketplaceListings, ListingRecord } from '../lib/supabaseClient';
import { ListingCard } from '../components/ui/ListingCard';
import { BuyEscrowModal } from '../components/modals/BuyEscrowModal';

const CATEGORIES = [
  'All',
  'VALORANT',
  'Fortnite',
  'League of Legends',
  'Counter-Strike 2 (CS2)',
  'EA Sports FC 26',
  'PUBG: BATTLEGROUNDS',
];

export default function MarketplaceClient({ initialListings }: { initialListings: ListingRecord[] }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('All');
  const [sortBy, setSortBy] = useState('featured');
  const [selectedBuyListing, setSelectedBuyListing] = useState<ListingRecord | null>(null);
  const [listings, setListings] = useState<ListingRecord[]>(initialListings);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const loadListings = async () => {
      try {
        const freshListings = await fetchMarketplaceListings();
        if (isMounted) {
          setListings(freshListings);
        }
      } catch (err) {
        console.error("Error polling marketplace listings:", err);
      }
    };
    
    const interval = setInterval(loadListings, 3000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  // Calculate stats dynamically using current listings state, not initialListings
  const totalListings = listings.length;
  const totalVolume = listings.reduce((sum, item) => sum + item.price_sol, 0);

  const filteredListings = useMemo(() => {
    return listings.filter((item) => {
      const q = searchQuery.toLowerCase();
      const matchesSearch =
        !q ||
        item.title.toLowerCase().includes(q) ||
        item.game.toLowerCase().includes(q) ||
        (item.tags ?? []).some((t) => t.toLowerCase().includes(q));

      const g = item.game.toLowerCase();
      const cat = (item.category ?? '').toLowerCase();
      const sel = selectedCategory.toLowerCase();

      const matchesCategory =
        selectedCategory === 'All' ||
        cat === sel ||
        g === sel ||
        (selectedCategory === 'Counter-Strike 2 (CS2)' && (g.includes('cs2') || g.includes('counter-strike'))) ||
        (selectedCategory === 'League of Legends' && (g === 'lol' || g.includes('league'))) ||
        (selectedCategory === 'VALORANT' && g.includes('valorant')) ||
        (selectedCategory === 'Fortnite' && g.includes('fortnite')) ||
        (selectedCategory === 'EA Sports FC 26' && (g.includes('fc') || g.includes('fifa'))) ||
        (selectedCategory === 'PUBG: BATTLEGROUNDS' && g.includes('pubg'));

      return matchesSearch && matchesCategory;
    }).sort((a, b) => {
      if (sortBy === 'price-asc') return a.price_sol - b.price_sol;
      if (sortBy === 'price-desc') return b.price_sol - a.price_sol;
      return 0;
    });
  }, [listings, searchQuery, selectedCategory, sortBy]);

  return (
    <main>
      <section style={{ borderBottom: '1px solid var(--card-border)' }}>
        <div style={{ maxWidth: '80rem', margin: '0 auto', padding: '4rem 1.5rem' }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: 'var(--brand)',
            }}
          >
            <ShieldCheck size={16} />
            On-chain escrow | zero counterparty risk
          </div>

          <h1
            style={{
              marginTop: '1rem',
              maxWidth: '48rem',
              fontSize: 'clamp(2rem, 5vw, 3rem)',
              fontWeight: 700,
              letterSpacing: '-0.025em',
              lineHeight: 1.15,
              color: 'var(--fg)',
            }}
          >
            The trustless marketplace for premium gaming assets
          </h1>

          <p
            style={{
              marginTop: '1rem',
              maxWidth: '40rem',
              fontSize: '1rem',
              color: 'var(--muted-fg)',
              lineHeight: 1.6,
            }}
          >
            Buy and sell verified accounts, skins, and in-game assets. Funds stay locked in a Solana escrow vault until both sides confirm the handoff.
          </p>

          <dl
            style={{
              marginTop: '2.5rem',
              display: 'grid',
              gridTemplateColumns: 'repeat(3, 1fr)',
              maxWidth: '32rem',
              borderRadius: '0.75rem',
              border: '1px solid var(--card-border)',
              overflow: 'hidden',
              gap: '1px',
              backgroundColor: 'var(--card-border)',
            }}
          >
            {[
              { value: `${(totalVolume + 184920).toFixed(0)} SOL`, label: 'Volume Secured' },
              { value: `${totalListings + 47318}`, label: 'Assets Traded' },
              { value: '0.4%', label: 'Dispute Rate' },
            ].map((stat) => (
              <div key={stat.label} className="ge-stat-cell">
                <dd style={{ fontFamily: 'monospace', fontSize: '1.5rem', fontWeight: 600, letterSpacing: '-0.025em', color: 'var(--fg)' }}>
                  {stat.value}
                </dd>
                <dt style={{ marginTop: '0.25rem', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--muted-fg)' }}>
                  {stat.label}
                </dt>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <div
        className="header-blur"
        style={{
          position: 'sticky',
          top: '4rem',
          zIndex: 30,
          borderBottom: '1px solid var(--card-border)',
        }}
      >
        <div
          style={{
            maxWidth: '80rem',
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
            padding: '0.75rem 1.5rem',
          }}
        >
          <div style={{ position: 'relative', width: '100%', maxWidth: '20rem' }}>
            <Search
              size={16}
              style={{
                position: 'absolute',
                left: '0.75rem',
                top: '50%',
                transform: 'translateY(-50%)',
                color: 'var(--muted-fg)',
                pointerEvents: 'none',
              }}
            />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search accounts, games, skins"
              className="ge-input"
              style={{ paddingLeft: '2.25rem' }}
            />
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', overflowX: 'auto' }}>
            <div className="scrollbar-none" style={{ display: 'flex', gap: '0.375rem', overflowX: 'auto', paddingBottom: '2px' }}>
              {CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setSelectedCategory(cat)}
                  className={selectedCategory === cat ? 'ge-pill-active' : 'ge-pill'}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div style={{ position: 'relative', flexShrink: 0, width: '10rem' }}>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
                className="ge-select"
              >
                <option value="featured">Featured</option>
                <option value="price-asc">Price: Low to High</option>
                <option value="price-desc">Price: High to Low</option>
                <option value="rating">Top Rated</option>
              </select>
              <ChevronDown
                size={16}
                style={{
                  position: 'absolute',
                  right: '0.75rem',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  pointerEvents: 'none',
                  color: 'var(--muted-fg)',
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <section style={{ maxWidth: '80rem', margin: '0 auto', padding: '2rem 1.5rem' }}>
        <div style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '0.875rem', color: 'var(--muted-fg)', margin: 0 }}>
            {loading ? 'Loading...' : `${filteredListings.length} listings`}
          </h2>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--muted-fg)' }}>
            Loading listings...
          </div>
        ) : filteredListings.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--muted-fg)' }}>
            No listings found.
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: '1.25rem',
            }}
          >
            {filteredListings.map((item) => (
              <ListingCard
                key={item.id}
                listing={item as any}
                onBuyClick={(l) => setSelectedBuyListing(l as any)}
              />
            ))}
          </div>
        )}
      </section>

      <BuyEscrowModal
        isOpen={!!selectedBuyListing}
        onClose={() => setSelectedBuyListing(null)}
        listing={selectedBuyListing as any}
      />
    </main>
  );
}
