import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceRole = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!supabaseServiceRole) {
  console.error('[create-dispute] SUPABASE_SERVICE_ROLE_KEY is not set.');
}

// Service role client — bypasses RLS entirely (server-side only)
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRole, {
  auth: { persistSession: false },
});

// Canonical bucket name — must match the bucket created in Supabase Dashboard
const DISPUTE_BUCKET = 'dispute';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const listing_id = formData.get('listing_id') as string;
    const initiator_pubkey = formData.get('initiator_pubkey') as string;
    const reason = formData.get('reason') as string;
    const details = formData.get('details') as string | null;
    const file = formData.get('file') as File | null;

    if (!listing_id || !initiator_pubkey || !reason) {
      return NextResponse.json(
        { success: false, error: 'Missing required parameters: listing_id, initiator_pubkey, reason.' },
        { status: 400 }
      );
    }

    // ── 1. Upload evidence file to storage ────────────────────────────────────
    let evidenceUrl: string | undefined;
    if (file && file.size > 0) {
      const fileExt = file.name.split('.').pop();
      const fileName = `${listing_id}_${Date.now()}.${fileExt}`;
      const fileBuffer = Buffer.from(await file.arrayBuffer());

      const { data: uploadData, error: uploadError } = await supabaseAdmin.storage
        .from(DISPUTE_BUCKET)
        .upload(fileName, fileBuffer, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadError) {
        console.error('[create-dispute] Storage upload error:', uploadError.message);
        return NextResponse.json(
          { success: false, error: `File upload failed: ${uploadError.message}` },
          { status: 500 }
        );
      }

      const { data: urlData } = supabaseAdmin.storage
        .from(DISPUTE_BUCKET)
        .getPublicUrl(uploadData.path);
      evidenceUrl = urlData.publicUrl;
    }

    // ── 2. Insert dispute record ──────────────────────────────────────────────
    const { data, error: dbError } = await supabaseAdmin
      .from('disputes')
      .insert([
        {
          listing_id,
          initiator_pubkey,
          reason,
          details: details || null,
          evidence_urls: evidenceUrl ? [evidenceUrl] : [],
          status: 'Open',
        },
      ])
      .select()
      .single();

    if (dbError) {
      console.error('[create-dispute] DB insert error:', dbError.message);
      return NextResponse.json(
        { success: false, error: dbError.message },
        { status: 500 }
      );
    }

    // ── 3. Update listing status to InDispute ─────────────────────────────────
    const { error: listingError } = await supabaseAdmin
      .from('listings')
      .update({ status: 'InDispute', updated_at: new Date().toISOString() })
      .eq('id', listing_id);

    if (listingError) {
      console.warn('[create-dispute] Listing status update failed:', listingError.message);
      // Non-fatal: dispute was created, listing update can be retried
    }

    return NextResponse.json({ success: true, dispute: data });
  } catch (err: any) {
    console.error('[create-dispute] Unexpected error:', err);
    return NextResponse.json(
      { success: false, error: err.message || 'Internal server error' },
      { status: 500 }
    );
  }
}
