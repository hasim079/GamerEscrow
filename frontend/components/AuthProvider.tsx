'use client';

import { useEffect, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import bs58 from 'bs58';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { publicKey, signMessage, connected, disconnect } = useWallet();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);

  useEffect(() => {
    const handleAuth = async () => {
      if (!connected || !publicKey || !signMessage) {
        setIsAuthenticated(false);
        localStorage.removeItem('gamer_escrow_jwt');
        return;
      }

      const existingToken = localStorage.getItem('gamer_escrow_jwt');
      if (existingToken) {
        // Assume token is valid for now. A robust app would decode and check expiry.
        setIsAuthenticated(true);
        return;
      }

      if (isAuthenticating) return;
      setIsAuthenticating(true);

      try {
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
          console.error('Login failed', data.error);
          disconnect();
        }
      } catch (err) {
        console.error('Signature rejected or failed', err);
        disconnect();
      } finally {
        setIsAuthenticating(false);
      }
    };

    handleAuth();
  }, [connected, publicKey, signMessage, disconnect]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      {children}
      {isAuthenticating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="bg-slate-900 border border-slate-800 p-8 rounded-xl shadow-2xl flex flex-col items-center max-w-sm w-full mx-4">
            <div className="w-12 h-12 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin mb-4"></div>
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
