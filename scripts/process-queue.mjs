// scripts/process-queue.mjs
// Pulls one queued claim, runs provider, updates both claim_queue and claims.
// Assumes Supabase service key via env.

import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import avanti from './providers/avanti.ts'; // default export run(payload)

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceKey) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const db = createClient(supabaseUrl, serviceKey);

// map provider id -> runner
const providers = {
  avanti, // { default export }
  // add others here: wmt, gwr, ...
};

async function nextQueueItem() {
  const { data, error } = await db
    .from('claim_queue')
    .select('id, claim_id, provider, payload, status')
    .eq('status', 'queued')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function updateQueue(id, patch) {
  await db.from('claim_queue').update(patch).eq('id', id);
}

async function updateClaim(claimId, patch) {
  await db.from('claims').update(patch).eq('id', claimId);
}

async function main() {
  const item = await nextQueueItem();
  if (!item) {
    console.log(JSON.stringify({ ok: true, processed: 0, source: 'queue.none' }));
    return;
  }

  const runner = providers[item.provider];
  if (!runner) {
    await updateQueue(item.id, { status: 'failed', error: `Unsupported provider: ${item.provider}` });
    await updateClaim(item.claim_id, { status: 'failed', error: `Unsupported provider: ${item.provider}` });
    console.log(JSON.stringify({ ok: false, processed: 1, provider: item.provider, error: 'unsupported' }));
    return;
  }

  await updateQueue(item.id, { status: 'processing' });

  const result = await runner(item.payload || {});
  const ok = !!result?.ok;

  await updateQueue(item.id, {
    status: ok ? 'submitted' : 'failed',
    error: ok ? null : (result?.error || null),
    meta: result?.screenshots ? result.screenshots : null,
  });

  await updateClaim(item.claim_id, {
    status: ok ? 'submitted' : 'failed',
    provider_ref: result?.provider_ref || null,
    submitted_at: ok ? new Date().toISOString() : null,
    error: ok ? null : (result?.error || null),
  });

  console.log(
    JSON.stringify({
      ok: true,
      processed: 1,
      provider: item.provider,
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
