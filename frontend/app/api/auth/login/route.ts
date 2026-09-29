import { NextResponse } from "next/server";
import nacl from "tweetnacl";
import bs58 from "bs58";
import jwt from "jsonwebtoken";

// SUPABASE_JWT_SECRET must match the value in Supabase Dashboard > Settings > API > JWT Secret
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET!;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;

if (!JWT_SECRET) {
  console.error(
    "[auth/login] SUPABASE_JWT_SECRET is not set. JWT generation will fail."
  );
}

// Extract project ref from Supabase URL (e.g. "rlfmuiufxmonzohdhvgt")
const PROJECT_REF = SUPABASE_URL
  ? SUPABASE_URL.replace("https://", "").split(".")[0]
  : "unknown";

export async function POST(req: Request) {
  try {
    const { publicKey, signature, message } = await req.json();

    if (!publicKey || !signature || !message) {
      return NextResponse.json(
        { error: "Missing parameters" },
        { status: 400 }
      );
    }

    // ── Ed25519 signature verification ────────────────────────────────────────
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    const publicKeyBytes = bs58.decode(publicKey);

    const isValid = nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKeyBytes
    );

    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    const now = Math.floor(Date.now() / 1000);

    // ── JWT payload — must satisfy Supabase auth.jwt() expectations ──────────
    // Supabase requires: sub, aud="authenticated", iss matching the project URL,
    // role="authenticated". The custom claim `wallet_address` is used by RLS policies.
    const token = jwt.sign(
      {
        // Standard JWT claims required by Supabase
        sub: publicKey,
        aud: "authenticated",
        iss: `https://${PROJECT_REF}.supabase.co/auth/v1`,
        role: "authenticated",
        iat: now,
        exp: now + 86400, // 24 hours

        // Custom claim — accessed in RLS as: auth.jwt() ->> 'wallet_address'
        wallet_address: publicKey,
      },
      JWT_SECRET,
      { algorithm: "HS256" }
    );

    return NextResponse.json({ success: true, token });
  } catch (error: any) {
    console.error("[auth/login] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
