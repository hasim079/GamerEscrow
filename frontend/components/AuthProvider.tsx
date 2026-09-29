'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';
import { getStoredToken } from '../lib/supabaseClient';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, signMessage, connected, disconnect } = useWallet();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const handleAuth = async () => {
      // ── Wallet disconnected — clean up ────────────────────────────────────
      if (!connected || !publicKey || !signMessage) {
        setIsAuthenticated(false);
        localStorage.removeItem('gamer_escrow_jwt');
        return;
      }

      // ── Valid token already exists (includes expiry check) ────────────────
      const existingToken = getStoredToken();
      if (existingToken) {
        setIsAuthenticated(true);
        return;
      }

      // ── Token missing or expired — authenticate ───────────────────────────
      if (isAuthenticating) return;
      setIsAuthenticating(true);

      try {
        // Use a fixed format message to keep it deterministic and reproducible
        const message = `Sign this message to login to GamerEscrow.\nTimestamp: ${Date.now()}`;
        const messageBytes = new TextEncoder().encode(message);

        const signatureBytes = await signMessage(messageBytes);
        const signature = bs58.encode(signatureBytes);

        const res = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            publicKey: publicKey.toBase58(),
            signature,
            message,
          }),
        });

        const data = await res.json();
        if (data.success && data.token) {
          localStorage.setItem('gamer_escrow_jwt', data.token);
          setIsAuthenticated(true);
        } else {
          console.error('[AuthProvider] Login failed:', data.error);
          disconnect();
        }
      } catch (err) {
        console.error('[AuthProvider] Signature rejected or network error:', err);
        disconnect();
      } finally {
        setIsAuthenticating(false);
      }
    };

    handleAuth();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, publicKey, signMessage, disconnect]);

  return (
    <>
      {children}
      {isAuthenticating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl shadow-2xl flex flex-col items-center max-w-sm w-full mx-4">
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mb-4" />
            <h3 className="text-xl font-bold text-white mb-2">Authenticating...</h3>
            <p className="text-slate-400 text-center text-sm">
              Please sign the message in your wallet to securely log in to GamerEscrow.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
