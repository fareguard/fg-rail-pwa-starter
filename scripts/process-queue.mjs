// scripts/process-queue.mjs
// Pulls one queued claim, runs provider, updates both claim_queue and claims.
// Assumes Supabase service key via env.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

// Provider entry points (drop these files into /scripts/)
import { submitAvantiClaim } from './provider-avanti.mjs';
import { submitWMTClaim }    from './provider-wmt.mjs';
import { submitGWRClaim }    from './provider-gwr.mjs';
import { submitLNERClaim }   from './provider-lner.mjs';
import { submitGTRClaim }    from './provider-gtr.mjs';

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SUBMIT_LIVE = String(process.env.SUBMIT_LIVE || '').toLowerCase();

if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(supabaseUrl, serviceKey);

async function nextQueueItem() {
  const { data, error } = await db
    .from('claim_queue')
    .select('id, claim_id, provider, payload, status, created_at')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function updateQueue(id, patch) {
  const { error } = await db.from('claim_queue').update(patch).eq('id', id);
  if (error) throw error;
}

async function updateClaim(claimId, patch) {
  const { error } = await db.from('claims').update(patch).eq('id', claimId);
  if (error) throw error;
}

function isLive() {
  // Treat "true", "1", "yes", "y" as live; anything else is dry-run
  return ['true', '1', 'yes', 'y'].includes(SUBMIT_LIVE);
}

async function runProvider(providerId, payload) {
  const submitOpts = { submitLive: isLive() };

  // Normalize just in case
  const p = String(providerId || '').trim().toLowerCase();

  let result;
  if (p === 'avanti') {
    result = await submitAvantiClaim(payload || {}, submitOpts);
  } else if (p === 'wmt') {
    result = await submitWMTClaim(payload || {}, submitOpts);
  } else if (p === 'gwr') {
    result = await submitGWRClaim(payload || {}, submitOpts);
  } else if (p === 'lner') {
    result = await submitLNERClaim(payload || {}, submitOpts);
  } else if (p === 'gtr') {
    result = await submitGTRClaim(payload || {}, submitOpts);
  } else {
    result = { ok: false, error: `Unknown provider ${providerId}` };
  }

  return result;
}

async function main() {
  const item = await nextQueueItem();
  if (!item) {
    console.log(JSON.stringify({ ok: true, processed: 0, source: 'queue.none' }));
    return;
  }

  // Mark as processing right away
  await updateQueue(item.id, { status: 'processing', error: null });

  let result;
  try {
    result = await runProvider(item.provider, item.payload || {});
  } catch (e) {
    // Normalize unexpected errors to a failed result
    result = { ok: false, error: e?.message || 'Provider threw an error' };
  }

  const ok = !!result?.ok;

  // Update queue row
  await updateQueue(item.id, {
    status: ok ? 'submitted' : 'failed',
    error: ok ? null : (result?.error || null),
    meta: result?.screenshots ? result.screenshots : null,
  });

  // Update claim row
  await updateClaim(item.claim_id, {
    status: ok ? 'submitted' : 'failed',
    provider_ref: result?.provider_ref || null,
    submitted_at: ok ? new Date().toISOString() : null,
    error: ok ? null : (result?.error || null),
  });

  // Emit a compact, useful log
  console.log(
    JSON.stringify({
      ok: true,
      processed: 1,
      provider: item.provider,
      live: isLive(),
      source: 'queue.provider',
      result: {
        ok,
        provider: item.provider,
        submitted_at: ok ? new Date().toISOString() : null,
        provider_ref: result?.provider_ref || null,
        screenshots: result?.screenshots || null,
        payload: item.payload || null,
        error: result?.error || null,
      },
    })
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
