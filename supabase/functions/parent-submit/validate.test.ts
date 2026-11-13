import { assertEquals } from 'jsr:@std/assert@1';
import { MAX_IMAGE_BYTES, cleanText, clientIp, contentHash, hashIp, parseSubmission, sniffImage } from './validate.ts';

const EVENT = '3f6c2a8e-1b4d-4c7a-9e2f-5a6b7c8d9e0f';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
const WEBP = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WEBPVP8 ');

function form(fields: Record<string, string>, files: Blob[] = []) {
  const f = new FormData();
  const base = { event_id: EVENT, consent: 'yes', elapsed_ms: '5000', ...fields };
  Object.entries(base).forEach(([k, v]) => f.append(k, v));
  files.forEach((b, i) => f.append('images', new File([b], `p${i}.jpg`)));
  return f;
}

Deno.test('sniffImage: يميّز الأنواع من البايتات', () => {
  assertEquals(sniffImage(JPEG)?.mime, 'image/jpeg');
  assertEquals(sniffImage(PNG)?.mime, 'image/png');
  assertEquals(sniffImage(WEBP)?.mime, 'image/webp');
  assertEquals(sniffImage(new TextEncoder().encode('<svg onload=alert(1)>')), null);
  assertEquals(sniffImage(new TextEncoder().encode('%PDF-1.7')), null);
});

Deno.test('cleanText: يزيل محارف التحكم وتجاوز الاتجاه', () => {
  assertEquals(cleanText('  أحمد\u202E\u0000  محمد ', { multiline: false }), 'أحمد محمد');
  assertEquals(cleanText('سطر1\r\n\n\n\n\nسطر2', { multiline: true }), 'سطر1\n\n\nسطر2');
  assertEquals(cleanText(null, { multiline: true }), '');
});

Deno.test('parseSubmission: تعليق فقط مقبول', async () => {
  const r = await parseSubmission(form({ comment: 'فعالية رائعة', author_name: 'أم سارة' }));
  assertEquals(r.kind, 'ok');
  if (r.kind === 'ok') {
    assertEquals(r.comment, 'فعالية رائعة');
    assertEquals(r.authorName, 'أم سارة');
    assertEquals(r.images.length, 0);
  }
});

Deno.test('parseSubmission: صورة فقط مقبولة والاسم اختياري', async () => {
  const r = await parseSubmission(form({}, [new Blob([JPEG])]));
  assertEquals(r.kind, 'ok');
  if (r.kind === 'ok') {
    assertEquals(r.authorName, null);
    assertEquals(r.images[0].ext, 'jpg');
  }
});

Deno.test('parseSubmission: يرفض المشاركة الفارغة', async () => {
  const r = await parseSubmission(form({ comment: '   ' }));
  assertEquals(r.kind === 'error' && r.error, 'empty_submission');
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
  const r = await parseSubmission(form({}, six));
  assertEquals(r.kind === 'error' && r.error, 'too_many_images');
});

Deno.test('parseSubmission: صورة أكبر من 5 م.ب مرفوضة', async () => {
  const big = new Uint8Array(MAX_IMAGE_BYTES + 1);
  big.set(JPEG);
  const r = await parseSubmission(form({}, [new Blob([big])]));
  assertEquals(r.kind === 'error' && r.error, 'image_too_large');
});

Deno.test('parseSubmission: ملف بامتداد صورة ومحتوى آخر مرفوض', async () => {
  const r = await parseSubmission(form({}, [new Blob(['<html><script>x</script>'])]));
  assertEquals(r.kind === 'error' && r.error, 'invalid_image');
});

Deno.test('parseSubmission: معرّف مناسبة غير صالح', async () => {
  const r = await parseSubmission(form({ event_id: "1' or '1'='1", comment: 'x' }));
  assertEquals(r.kind === 'error' && r.error, 'invalid_event');
});

Deno.test('contentHash: نفس المحتوى نفس البصمة، وأي اختلاف يغيّرها', async () => {
  const img = { bytes: JPEG.buffer.slice(0) as ArrayBuffer, mime: 'image/jpeg', ext: 'jpg', size: JPEG.length };
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
