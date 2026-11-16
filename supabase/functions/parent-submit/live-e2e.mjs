/**
 * اختبار حي ضد مشروع النشاط
 * node supabase/functions/parent-submit/live-e2e.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '../../..');
const configSrc = readFileSync(resolve(root, 'js/config.js'), 'utf8');
const SUPABASE_URL = configSrc.match(/SUPABASE_URL = '([^']+)'/)[1];
const SUPABASE_ANON_KEY = configSrc.match(/SUPABASE_ANON_KEY = '([^']+)'/)[1];
const ORIGIN = 'http://127.0.0.1:4175';
const EVENT_ID = '3e7a2a62-1f61-4160-b318-f433a6682138';
const FN = `${SUPABASE_URL}/functions/v1/parent-submit`;

const results = [];
const log = (ok, name, detail) => {
  results.push({ ok, name, detail: String(detail) });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
};

function makeWav() {
  const rate = 44100;
  const samples = Math.floor(rate * 0.25);
  const dataSize = samples * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + dataSize, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(dataSize, 40);
  return buf;
}

function makeMp4() {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(24, 0);
  b.write('ftypisom', 4);
  b.writeUInt32BE(0, 12);
  b.write('isom', 16);
  b.writeUInt32BE(32, 24);
  b.write('mdat', 28);
  return b;
}

async function fnJson(body) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function fnMultipart(form) {
  const res = await fetch(FN, {
    method: 'POST',
    headers: {
      Origin: ORIGIN,
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: form,
  });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function storageDownload(path) {
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/parents-eyes/${path}`, {
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
  });
  return { ok: res.ok, status: res.status };
}

function save() {
  mkdirSync(resolve(root, 'migrations/verify-logs'), { recursive: true });
  writeFileSync(resolve(root, 'migrations/verify-logs/live_e2e_partial.json'), JSON.stringify(results, null, 2));
}

const videoBuf = makeMp4();
const audioBuf = makeWav();

const prep = await fnJson({
  action: 'prepare',
  video: { size: videoBuf.length, name: 'live-test.mp4', type: 'video/mp4' },
  audio: { size: audioBuf.length, name: 'live-test.wav', type: 'audio/wav' },
});
log(prep.status === 200 && prep.json?.ok, 'prepare signed uploads', prep.json?.error || prep.json?.post_id);
if (!prep.json?.ok) {
  save();
  process.exit(1);
}

const postId = prep.json.post_id;
const uploads = prep.json.uploads || [];

for (const up of uploads) {
  const body = up.kind === 'video' ? videoBuf : audioBuf;
  const type = up.kind === 'video' ? 'video/mp4' : 'audio/wav';
  const put = await fetch(up.signedUrl, { method: 'PUT', headers: { 'Content-Type': type }, body });
  log(put.ok, `direct upload ${up.kind}`, `status=${put.status}`);
}

const videoPath = uploads.find((u) => u.kind === 'video')?.path;
const audioPath = uploads.find((u) => u.kind === 'audio')?.path;

const fd = new FormData();
fd.append('event_id', EVENT_ID);
fd.append('author_name', 'اختبار آلي فيديو/صوت');
fd.append('comment', 'مشاركة اختبار — تُحذف بعد التحقق');
fd.append('consent', 'yes');
fd.append('website', '');
fd.append('elapsed_ms', '5000');
fd.append('post_id', postId);
fd.append('video_path', videoPath);
fd.append('audio_path', audioPath);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
fd.append('images', new Blob([jpeg], { type: 'image/jpeg' }), 't.jpg');

const fin = await fnMultipart(fd);
log(fin.status === 200 && fin.json?.ok, 'finalize create pending post', JSON.stringify(fin.json));

const fin2 = await fnMultipart(fd);
log(fin2.status === 200 && fin2.json?.ok, 'finalize retry idempotent', JSON.stringify(fin2.json));

const pendingDl = await storageDownload(videoPath);
log(!pendingDl.ok, 'anon download denied while pending', `status=${pendingDl.status}`);

writeFileSync(
  resolve(root, 'migrations/verify-logs/live_test_artifact.json'),
  JSON.stringify({ postId, videoPath, audioPath, createdAt: new Date().toISOString() }, null, 2),
);
save();
console.log('\nARTIFACT', { postId, videoPath, audioPath });
if (results.some((r) => !r.ok)) process.exit(1);
