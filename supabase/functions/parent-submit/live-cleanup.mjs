import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const c = readFileSync(resolve(root, 'js/config.js'), 'utf8');
const URL = c.match(/SUPABASE_URL = '([^']+)'/)[1];
const art = JSON.parse(readFileSync(resolve(root, 'migrations/verify-logs/live_test_artifact.json'), 'utf8'));

const keysOut = execSync('npx supabase projects api-keys --project-ref rcxcmxaplyzxhhgrmhqj -o json', {
  encoding: 'utf8',
  cwd: root,
});
const keys = JSON.parse(keysOut.slice(keysOut.indexOf('[')));
const service = keys.find((k) => k.name === 'service_role' || k.id === 'service_role')?.api_key;
if (!service) process.exit(1);

function sql(q) {
  const out = execSync(`npx supabase db query --yes --remote=rcxcmxaplyzxhhgrmhqj ${JSON.stringify(q)}`, {
    encoding: 'utf8',
    cwd: root,
  });
  const m = out.match(/\{[\s\S]*"rows"[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : { rows: [] };
}

const pathsRes = sql(`select storage_path from public.parent_post_images where post_id = '${art.postId}'`);
const paths = new Set((pathsRes.rows || []).map((r) => r.storage_path));
paths.add(art.videoPath);
paths.add(art.audioPath);
paths.add('posts/6025ca12-0bb9-4b7e-89d5-0a22436a914c/bdf4e338-ad49-4927-a975-7870bbf2265c.mp4');
const list = [...paths].filter(Boolean);

const del = await fetch(`${URL}/storage/v1/object/parents-eyes`, {
  method: 'DELETE',
  headers: {
    apikey: service,
    Authorization: `Bearer ${service}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({ prefixes: list }),
});
console.log('storage delete', del.status, (await del.text()).slice(0, 200));

sql(`delete from public.parent_upload_intents where post_id = '${art.postId}' or consumed_at is null or storage_path like 'posts/6025ca12%'`);
sql(`delete from public.parent_post_images where post_id = '${art.postId}'`);
sql(`delete from public.parent_posts where id = '${art.postId}' and author_name = 'اختبار آلي فيديو/صوت'`);

const counts = sql(
  `select (select count(*) from public.parent_posts) as posts, (select count(*) from public.parent_post_images) as attachments, (select count(*) from storage.objects where bucket_id = 'parents-eyes') as parents_eyes_objects, (select count(*) from storage.objects where bucket_id = 'student-activity-files') as gallery_bucket_objects, exists(select 1 from public.parent_posts where id = '${art.postId}') as test_post_left`,
);
console.log(JSON.stringify(counts.rows?.[0], null, 2));
writeFileSync(
  resolve(root, 'migrations/verify-logs/007_cleanup_result.json'),
  JSON.stringify({ counts: counts.rows?.[0], removedPaths: list.length }, null, 2),
);
if (counts.rows?.[0]?.test_post_left) process.exit(1);
if (Number(counts.rows?.[0]?.posts) !== 48) {
  console.warn('WARN posts count != 48 baseline', counts.rows?.[0]?.posts);
}
