import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const configSrc = readFileSync(resolve(root, 'js/config.js'), 'utf8');
const URL = configSrc.match(/SUPABASE_URL = '([^']+)'/)[1];
const KEY = configSrc.match(/SUPABASE_ANON_KEY = '([^']+)'/)[1];
const art = JSON.parse(readFileSync(resolve(root, 'migrations/verify-logs/live_test_artifact.json'), 'utf8'));
const results = [];
const log = (ok, name, detail) => {
  results.push({ ok, name, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

function sql(q) {
  const out = execSync(`npx supabase db query --yes --remote=rcxcmxaplyzxhhgrmhqj ${JSON.stringify(q)}`, {
    encoding: 'utf8',
    cwd: root,
  });
  const m = out.match(/\{[\s\S]*"rows"[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : { rows: [] };
}

async function dl(path) {
  const res = await fetch(`${URL}/storage/v1/object/parents-eyes/${path}`, {
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}` },
  });
  const buf = res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  return { status: res.status, ok: res.ok, size: buf?.length || 0 };
}

// Approve
sql(`update public.parent_posts set status='approved', published_at=timezone('utc', now()) where id='${art.postId}' returning id, status`);
const aV = await dl(art.videoPath);
const aA = await dl(art.audioPath);
log(aV.ok && aV.size > 0, 'anon download video after approve', `status=${aV.status} size=${aV.size}`);
log(aA.ok && aA.size > 0, 'anon download audio after approve', `status=${aA.status} size=${aA.size}`);

// Unpublish
sql(`update public.parent_posts set status='pending', published_at=null where id='${art.postId}' returning id, status`);
const uV = await dl(art.videoPath);
const uA = await dl(art.audioPath);
log(!uV.ok, 'anon download video denied after unpublish', `status=${uV.status}`);
log(!uA.ok, 'anon download audio denied after unpublish', `status=${uA.status}`);

// Orphan: prepare + upload + age + cleanup via prepare
const prep = await fetch(`${URL}/functions/v1/parent-submit`, {
  method: 'POST',
  headers: {
    Origin: 'http://127.0.0.1:4175',
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    action: 'prepare',
    video: { size: 64, name: 'orphan.mp4', type: 'video/mp4' },
  }),
});
const prepJson = await prep.json();
const up = prepJson.uploads?.[0];
const mp4 = Buffer.alloc(64);
mp4.writeUInt32BE(24, 0);
mp4.write('ftypisom', 4);
const put = await fetch(up.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: mp4 });
log(put.ok, 'orphan file uploaded', `status=${put.status}`);

sql(`update public.parent_upload_intents set created_at = timezone('utc', now()) - interval '3 hours' where storage_path='${up.path}'`);

// also age storage updated_at isn't controllable easily; objectUpdatedAt uses list metadata.
// Force cleanup by setting objectUpdatedAt skip: our cleanup skips if updated within 30m.
// For live test, remove the 30m guard by deleting via listing orphan paths + storage remove through a second prepare
// after waiting isn't practical. Call SQL list orphans then use service... we don't have service key.
// Workaround: use db to confirm orphan listed, then edge cleanup — if object is fresh, cleanup skips storage but should still...
// Looking at cleanupOrphanUploads: if objectUpdatedAt says fresh, it continues (skips). So fresh upload won't be deleted.
// For test: we need either to wait 30m OR temporarily the objectUpdatedAt returns old.
// Simpler live proof: list orphan paths via SQL (intent aged) = candidate, and delete intents+objects via SQL + storage API with... 
// Actually storage remove needs service role. Edge prepare cleanup will skip fresh objects.
// Document: orphan INTENT is aged and listed; full object delete verified in unit tests; for live, call parent_list_orphan_upload_paths and parent_delete_upload_intents, and remove storage via edge by making objectUpdatedAt think it's old — can't.
// Alternative: add ?force for tests — no.
// Best live approach: delete the orphan object using supabase storage management... 
// Check if list orphan returns the path (intent side), then manually invoke cleanup by removing via SQL function delete intents, and use a small edge-only cleanup that ignores freshness when updated_at missing.
// Looking at objectUpdatedAt - if list doesn't return updated_at properly, updatedAt is null, then:
// `if (meta.exists && meta.updatedAt && meta.updatedAt.getTime() > freshCutoff) continue`
// If updatedAt is null, we DON'T skip — we remove! Good.

await fetch(`${URL}/functions/v1/parent-submit`, {
  method: 'POST',
  headers: {
    Origin: 'http://127.0.0.1:4175',
    apikey: KEY,
    Authorization: `Bearer ${KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    action: 'prepare',
    audio: { size: 44, name: 'trigger.wav', type: 'audio/wav' },
  }),
});

const left = sql(
  `select exists(select 1 from public.parent_upload_intents where storage_path='${up.path}') as intent_left, exists(select 1 from storage.objects where bucket_id='parents-eyes' and name='${up.path}') as object_left`,
);
const row = left.rows?.[0] || {};
log(!row.intent_left, 'orphan intent cleaned', JSON.stringify(row));
log(!row.object_left, 'orphan storage object cleaned', JSON.stringify(row));

// cleanup trigger prepare leftovers
sql(`delete from public.parent_upload_intents where consumed_at is null and created_at > timezone('utc', now()) - interval '10 minutes'`);

writeFileSync(resolve(root, 'migrations/verify-logs/live_privacy_orphan.json'), JSON.stringify(results, null, 2));
if (results.some((r) => !r.ok)) process.exit(1);
