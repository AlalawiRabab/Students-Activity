import { assertEquals } from 'jsr:@std/assert@1';
import {
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  cleanText,
  clientIp,
  contentHash,
  hashIp,
  parseSubmission,
  sniffImage,
  sniffMedia,
} from './validate.ts';

const EVENT = '3f6c2a8e-1b4d-4c7a-9e2f-5a6b7c8d9e0f';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');
const WAV = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WAVEfmt ');
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3, 4]);
const MP4 = (() => {
  const b = new Uint8Array(24);
  b.set([0, 0, 0, 24], 0);
  b.set(new TextEncoder().encode('ftypisom'), 4);
  return b;
})();

function form(fields: Record<string, string>, files: Record<string, Blob[]> = {}) {
  const f = new FormData();
  const base = { event_id: EVENT, consent: 'yes', elapsed_ms: '5000', author_name: 'أم سارة', ...fields };
  Object.entries(base).forEach(([k, v]) => f.append(k, v));
  (files.images || []).forEach((b, i) => f.append('images', new File([b], `p${i}.jpg`)));
  (files.video || []).forEach((b, i) => f.append('video', new File([b], `v${i}.mp4`)));
  (files.audio || []).forEach((b, i) => f.append('audio', new File([b], `a${i}.wav`)));
  return f;
}

Deno.test('sniffImage / sniffMedia: يميّز الأنواع من البايتات', () => {
  assertEquals(sniffImage(JPEG)?.mime, 'image/jpeg');
  assertEquals(sniffImage(PNG)?.mime, 'image/png');
  assertEquals(sniffImage(WEBP)?.mime, 'image/webp');
  assertEquals(sniffMedia(WAV, 'audio')?.mime, 'audio/wav');
  assertEquals(sniffMedia(WEBM, 'video')?.mime, 'video/webm');
  assertEquals(sniffMedia(MP4, 'video')?.mime, 'video/mp4');
  assertEquals(sniffMedia(MP4, 'audio')?.mime, 'audio/mp4');
  assertEquals(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), null);
});

Deno.test('cleanText: يزيل محارف التحكم وتجاوز الاتجاه', () => {
  assertEquals(cleanText('  أحمد\u202E\u0000  محمد ', { multiline: false }), 'أحمد محمد');
  assertEquals(cleanText('سطر1\r\n\n\n\n\nسطر2', { multiline: true }), 'سطر1\n\n\nسطر2');
  assertEquals(cleanText(null, { multiline: true }), '');
});

Deno.test('parseSubmission: تعليق فقط مقبول', async () => {
  const r = await parseSubmission(form({ comment: 'فعالية رائعة' }));
  assertEquals(r.kind, 'ok');
  if (r.kind === 'ok') {
    assertEquals(r.comment, 'فعالية رائعة');
    assertEquals(r.authorName, 'أم سارة');
    assertEquals(r.media.length, 0);
  }
});

Deno.test('parseSubmission: صورة وفيديو وصوت مقبولة', async () => {
  const r = await parseSubmission(form({ comment: '' }, {
    images: [new Blob([JPEG])],
    video: [new Blob([MP4])],
    audio: [new Blob([WAV])],
  }));
  assertEquals(r.kind, 'ok');
  if (r.kind === 'ok') {
    assertEquals(r.media.map((m) => m.kind).sort().join(','), 'audio,image,video');
  }
});

Deno.test('parseSubmission: الاسم إلزامي (فارغ أو مسافات)', async () => {
  const empty = await parseSubmission(form({ comment: 'فعالية', author_name: '' }));
  assertEquals(empty.kind === 'error' && empty.error, 'name_required');
  const spaces = await parseSubmission(form({ comment: 'فعالية', author_name: '   ' }));
  assertEquals(spaces.kind === 'error' && spaces.error, 'name_required');
});

Deno.test('parseSubmission: يرفض المشاركة الفارغة', async () => {
  const r = await parseSubmission(form({ comment: '   ' }));
  assertEquals(r.kind === 'error' && r.error, 'empty_submission');
});

Deno.test('parseSubmission: video_path يسمح بمشاركة بلا صور في multipart', async () => {
  const f = form({ comment: '' });
  f.append('video_path', `posts/${EVENT}/${EVENT}.mp4`);
  const r = await parseSubmission(f);
  assertEquals(r.kind, 'ok');
  if (r.kind === 'ok') assertEquals(r.media.length, 0);
});

Deno.test('parseSubmission: الإقرار إلزامي', async () => {
  const r = await parseSubmission(form({ consent: '', comment: 'x' }));
  assertEquals(r.kind === 'error' && r.error, 'consent_required');
});

Deno.test('parseSubmission: الحقل الخفي يوقف الحفظ', async () => {
  const r = await parseSubmission(form({ website: 'http://spam', comment: 'x' }));
  assertEquals(r.kind, 'honeypot');
});

Deno.test('parseSubmission: الإرسال الفوري يُرفض', async () => {
  const r = await parseSubmission(form({ elapsed_ms: '300', comment: 'x' }));
  assertEquals(r.kind === 'error' && r.error, 'too_fast');
});

Deno.test('parseSubmission: أكثر من 5 صور مرفوض', async () => {
  const six = Array.from({ length: 6 }, () => new Blob([JPEG]));
  const r = await parseSubmission(form({}, { images: six }));
  assertEquals(r.kind === 'error' && r.error, 'too_many_images');
});

Deno.test('parseSubmission: صورة أكبر من 5 م.ب مرفوضة', async () => {
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(JPEG);
  const r = await parseSubmission(form({}, { images: [new Blob([big])] }));
  assertEquals(r.kind === 'error' && r.error, 'image_too_large');
});

Deno.test('parseSubmission: فيديو أكبر من 50 م.ب مرفوض', async () => {
  const big = new Uint8Array(MAX_VIDEO_BYTES + 1);
  big.set(MP4);
  const r = await parseSubmission(form({}, { video: [new Blob([big])] }));
  assertEquals(r.kind === 'error' && r.error, 'video_too_large');
});

Deno.test('parseSubmission: صوت أكبر من 15 م.ب مرفوض', async () => {
  const big = new Uint8Array(MAX_AUDIO_BYTES + 1);
  big.set(WAV);
  const r = await parseSubmission(form({}, { audio: [new Blob([big])] }));
  assertEquals(r.kind === 'error' && r.error, 'audio_too_large');
});

Deno.test('parseSubmission: ملف بامتداد صورة ومحتوى آخر مرفوض', async () => {
  const r = await parseSubmission(form({}, { images: [new Blob(['<html><script>x</script>'])] }));
  assertEquals(r.kind === 'error' && r.error, 'invalid_media');
});

Deno.test('parseSubmission: معرّف مناسبة غير صالح', async () => {
  const r = await parseSubmission(form({ event_id: "1' or '1'='1", comment: 'x' }));
  assertEquals(r.kind === 'error' && r.error, 'invalid_event');
});

Deno.test('contentHash: نفس المحتوى نفس البصمة، وأي اختلاف يغيّرها', async () => {
  const img = { bytes: JPEG.buffer.slice(0) as ArrayBuffer, mime: 'image/jpeg', ext: 'jpg', size: JPEG.length, kind: 'image' as const };
  const a = await contentHash(EVENT, 'تعليق  رائع', [img]);
  assertEquals(a, await contentHash(EVENT, ' تعليق رائع ', [img]));
  assertEquals(a === (await contentHash(EVENT, 'تعليق آخر', [img])), false);
  assertEquals(a === (await contentHash(EVENT, 'تعليق رائع', [])), false);
  assertEquals(a.length, 64);
});

Deno.test('clientIp: يفضّل ترويسة البنية الوسيطة على x-forwarded-for', () => {
  assertEquals(clientIp(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-forwarded-for': '9.9.9.9' })), '1.1.1.1');
  assertEquals(clientIp(new Headers({ 'x-forwarded-for': '2.2.2.2, 3.3.3.3' })), '2.2.2.2');
  assertEquals(clientIp(new Headers()), 'unknown');
});

Deno.test('hashIp: ثابت ولا يحتوي العنوان', async () => {
  const a = await hashIp('10.0.0.1', 's');
  assertEquals(a, await hashIp('10.0.0.1', 's'));
  assertEquals(a.length, 64);
  assertEquals(a.includes('10.0.0.1'), false);
});
