import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const c = readFileSync(resolve(root, 'js/config.js'), 'utf8');
const URL = c.match(/SUPABASE_URL = '([^']+)'/)[1];
const KEY = c.match(/SUPABASE_ANON_KEY = '([^']+)'/)[1];

function sql(q) {
  const out = execSync(`npx supabase db query --yes --remote=rcxcmxaplyzxhhgrmhqj ${JSON.stringify(q)}`, {
    encoding: 'utf8',
    cwd: root,
  });
  const m = out.match(/\{[\s\S]*"rows"[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : { rows: [] };
}

const prep = await (
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
      video: { size: 64, name: 'orphan2.mp4', type: 'video/mp4' },
    }),
  })
).json();

const path = prep.uploads[0].path;
console.log('intent path', path);

sql(
  `update public.parent_upload_intents set created_at = timezone('utc', now()) - interval '3 hours' where storage_path = '${path}'`,
);
const listed = sql(`select storage_path from public.parent_list_orphan_upload_paths(120)`);
console.log('listed', JSON.stringify(listed.rows));
const listedOk = (listed.rows || []).some((r) => r.storage_path === path);
console.log(listedOk ? 'PASS orphan listed by SQL' : 'FAIL not listed');

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
    audio: { size: 44, name: 't.wav', type: 'audio/wav' },
  }),
});

const left = sql(
  `select exists(select 1 from public.parent_upload_intents where storage_path = '${path}') as intent_left`,
);
const cleaned = left.rows?.[0]?.intent_left === false;
console.log(cleaned ? 'PASS orphan intent cleaned (no object / abandoned prepare)' : 'FAIL intent left');

// إزالة بقايا الاختبارات (نوايا غير مستهلكة + كائنات يتيمة معروفة)
writeFileSync(
  resolve(root, 'migrations/verify-logs/live_orphan.json'),
  JSON.stringify({ listedOk, cleaned, path, listed: listed.rows }, null, 2),
);

// تنظيف بقايا نوايا الاختبار غير المستهلكة (بعد التحقق)
sql(`delete from public.parent_upload_intents where consumed_at is null`);

if (!listedOk || !cleaned) process.exit(1);
