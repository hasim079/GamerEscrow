'use client';

import React from 'react';
import { X, Wallet, ShieldCheck } from 'lucide-react';
import { useWallet } from '@solana/wallet-adapter-react';

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { wallets, select } = useWallet();

  if (!isOpen) return null;

  // Helper object for icon mapping (emojis for popular wallets)
  const getWalletIcon = (name: string) => {
    if (name.toLowerCase().includes('phantom')) return '👻';
    if (name.toLowerCase().includes('solflare')) return '🔥';
    if (name.toLowerCase().includes('backpack')) return '🎒';
    return '💳';
  };

  const handleSelectWallet = async (walletName: string) => {
    try {
      const selectedWallet = wallets.find(w => w.adapter.name === walletName);
      if (selectedWallet) {
        await select(selectedWallet.adapter.name);
        onClose();
      }
    } catch (error) {
      console.error("Error selecting wallet:", error);
    }
  };

  return (
    <div className="ge-modal-backdrop" onClick={onClose}>
      <div className="ge-modal" style={{ maxWidth: '24rem' }} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <span style={{ display: 'flex', width: '2.5rem', height: '2.5rem', alignItems: 'center', justifyContent: 'center', borderRadius: '0.75rem', backgroundColor: 'rgba(16,185,129,0.1)', color: 'var(--brand)' }}>
              <Wallet size={18} />
            </span>
            <div>
              <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 700, color: 'var(--fg)' }}>Connect Solana Wallet</h3>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--muted-fg)' }}>Select a provider to access escrow</p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="ge-btn-icon">
            <X size={18} />
          </button>
        </div>

        {/* Wallet list */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem', marginBottom: '1.25rem' }}>
          {wallets.map((wallet) => {
            const isPopular = wallet.adapter.name.toLowerCase().includes('phantom');
            return (
              <button
                key={wallet.adapter.name}
                type="button"
                onClick={() => handleSelectWallet(wallet.adapter.name)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderRadius: '0.75rem',
                  border: '1px solid var(--card-border)',
                  backgroundColor: 'var(--bg)',
                  padding: '0.875rem',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'border-color 0.15s ease',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                  <span style={{ fontSize: '1.25rem' }}>{getWalletIcon(wallet.adapter.name)}</span>
                  <div>
                    <div style={{ fontSize: '0.875rem', fontWeight: 700, color: 'var(--fg)' }}>{wallet.adapter.name}</div>
                    <div style={{ fontSize: '0.6875rem', color: 'var(--muted-fg)' }}>Solana Devnet</div>
                  </div>
                </div>
                {isPopular && (
                  <span className="ge-badge-brand-soft">Popular</span>
                )}
              </button>
            );
          })}
        </div>

        {/* Trust indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.75rem', fontWeight: 500, color: 'var(--brand)', backgroundColor: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)', borderRadius: '0.5rem', padding: '0.625rem 0.75rem' }}>
          <ShieldCheck size={14} />
          <span>Non-custodial Solana Smart Contract Escrow</span>
        </div>
      </div>
    </div>
  );
}
