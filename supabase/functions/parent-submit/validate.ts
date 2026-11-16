/**
 * validate.ts — تحقق خادمي خالص (بلا شبكة) لمشاركات «بعيون أهالينا»
 * يُختبر عبر: deno test supabase/functions/parent-submit/
 */

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_NAME_CHARS = 80;
export const MAX_COMMENT_CHARS = 2000;
export const MIN_ELAPSED_MS = 2500;
/** 5 صور + فيديو + صوت + هامش multipart */
export const MAX_BODY_BYTES =
  MAX_IMAGES * MAX_IMAGE_BYTES + MAX_VIDEO_BYTES + MAX_AUDIO_BYTES + 1024 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export type MediaKind = 'image' | 'video' | 'audio';
export type SniffedMedia = { mime: string; ext: string; kind: MediaKind };

const ascii = (bytes: Uint8Array, from: number, to: number) =>
  String.fromCharCode(...bytes.subarray(from, to));

function findFtypBrand(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (ascii(bytes, 4, 8) !== 'ftyp') return null;
  return ascii(bytes, 8, 12);
}

/** نوع المرفق من البايتات الفعلية لا من اسم الملف أو ترويسة المتصفح */
export function sniffMedia(bytes: Uint8Array, expect?: MediaKind): SniffedMedia | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return expect && expect !== 'image' ? null : { mime: 'image/jpeg', ext: 'jpg', kind: 'image' };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) {
    return expect && expect !== 'image' ? null : { mime: 'image/png', ext: 'png', kind: 'image' };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WEBP') {
    return expect && expect !== 'image' ? null : { mime: 'image/webp', ext: 'webp', kind: 'image' };
  }
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 12) === 'WAVE') {
    return expect && expect !== 'audio' ? null : { mime: 'audio/wav', ext: 'wav', kind: 'audio' };
  }
  if (bytes.length >= 4 && ascii(bytes, 0, 4) === 'OggS') {
    return expect && expect !== 'audio' ? null : { mime: 'audio/ogg', ext: 'ogg', kind: 'audio' };
  }
  if (bytes.length >= 3 && ascii(bytes, 0, 3) === 'ID3') {
    return expect && expect !== 'audio' ? null : { mime: 'audio/mpeg', ext: 'mp3', kind: 'audio' };
  }
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) {
    // إطار MPEG audio
    return expect && expect !== 'audio' ? null : { mime: 'audio/mpeg', ext: 'mp3', kind: 'audio' };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) {
    // WebM / Matroska — يُقبل فيديو أو صوت حسب الحقل
    if (expect === 'audio') return { mime: 'audio/webm', ext: 'webm', kind: 'audio' };
    if (expect === 'video' || !expect) return { mime: 'video/webm', ext: 'webm', kind: 'video' };
    return null;
  }

  const brand = findFtypBrand(bytes);
  if (brand) {
    const b = brand.replace(/\0/g, ' ').trim();
    const audioBrands = new Set(['M4A', 'M4B', 'M4P', 'mp4a']);
    const qtBrands = new Set(['qt  ', 'qt']);
    if (audioBrands.has(b) || (expect === 'audio' && ['isom', 'mp41', 'mp42', 'M4A '].includes(brand))) {
      if (expect && expect !== 'audio') return null;
      return { mime: 'audio/mp4', ext: 'm4a', kind: 'audio' };
    }
    if (qtBrands.has(brand) || b === 'qt') {
      if (expect && expect !== 'video') return null;
      return { mime: 'video/quicktime', ext: 'mov', kind: 'video' };
    }
    // MP4 عام (آيفون/أندرويد): يُقبل فيديو أو صوت حسب حقل النموذج
    if (expect === 'audio') return { mime: 'audio/mp4', ext: 'm4a', kind: 'audio' };
    if (expect === 'video' || !expect) return { mime: 'video/mp4', ext: 'mp4', kind: 'video' };
    return null;
  }

  // ADTS AAC
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) {
    return expect && expect !== 'audio' ? null : { mime: 'audio/aac', ext: 'aac', kind: 'audio' };
  }
  return null;
}

/** توافق خلفي مع اختبارات الصور */
export function sniffImage(bytes: Uint8Array) {
  const s = sniffMedia(bytes, 'image');
  if (!s || s.kind !== 'image') return null;
  return { mime: s.mime as 'image/jpeg' | 'image/png' | 'image/webp', ext: s.ext as 'jpg' | 'png' | 'webp' };
}

export function cleanText(value: unknown, { multiline }: { multiline: boolean }): string {
  let s = typeof value === 'string' ? value : '';
  s = s.replace(/\r\n?/g, '\n').replace(CONTROL_RE, '');
  if (multiline) {
    s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{4,}/g, '\n\n\n');
  } else {
    s = s.replace(/\s+/g, ' ');
  }
  return s.trim();
}

export type ValidMedia = {
  bytes: ArrayBuffer;
  mime: string;
  ext: string;
  size: number;
  kind: MediaKind;
};

export type ParseResult =
  | { kind: 'honeypot' }
  | { kind: 'error'; status: number; error: string; message: string }
  | {
      kind: 'ok';
      eventId: string;
      authorName: string;
      comment: string | null;
      media: ValidMedia[];
    };

const fail = (error: string, message: string, status = 400): ParseResult => ({
  kind: 'error',
  status,
  error,
  message,
});

function isFileLike(v: unknown): v is File {
  return typeof v === 'object' && v !== null && typeof (v as File).arrayBuffer === 'function';
}

async function readMediaFile(
  file: File,
  expect: MediaKind,
  maxBytes: number,
  tooLargeError: string,
  tooLargeCode: string,
): Promise<ValidMedia | ParseResult> {
  if (file.size <= 0) return fail('empty_media', 'أحد المرفقات فارغ');
  if (file.size > maxBytes) return fail(tooLargeCode, tooLargeError, 413);
  const bytes = await file.arrayBuffer();
  const sniffed = sniffMedia(new Uint8Array(bytes), expect);
  if (!sniffed || sniffed.kind !== expect) {
    return fail(
      'invalid_media',
      expect === 'image'
        ? 'نوع إحدى الصور غير مدعوم (JPG أو PNG أو WEBP فقط)'
        : expect === 'video'
        ? 'نوع الفيديو غير مدعوم (MP4 أو MOV أو WEBM)'
        : 'نوع الملف الصوتي غير مدعوم (MP3 أو M4A أو AAC أو WAV أو OGG أو WEBM)',
    );
  }
  return { bytes, mime: sniffed.mime, ext: sniffed.ext, size: bytes.byteLength, kind: sniffed.kind };
}

export async function parseSubmission(form: FormData): Promise<ParseResult> {
  if (cleanText(form.get('website'), { multiline: false })) return { kind: 'honeypot' };

  const elapsed = Number(form.get('elapsed_ms'));
  if (!Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_MS) {
    return fail('too_fast', 'تعذّر إرسال المشاركة، انتظر لحظات ثم أعد المحاولة');
  }

  const eventId = cleanText(form.get('event_id'), { multiline: false });
  if (!UUID_RE.test(eventId)) return fail('invalid_event', 'اختر المناسبة');

  if (form.get('consent') !== 'yes') {
    return fail('consent_required', 'يلزم الإقرار بالموافقة على نشر المرفقات');
  }

  const authorName = cleanText(form.get('author_name'), { multiline: false });
  if (!authorName) {
    return fail('name_required', 'يرجى كتابة اسم الطالبة أو ولية أمر الطالبة');
  }
  if (authorName.length > MAX_NAME_CHARS) {
    return fail('name_too_long', `الاسم يجب ألا يتجاوز ${MAX_NAME_CHARS} حرفاً`);
  }

  const comment = cleanText(form.get('comment'), { multiline: true });
  if (comment.length > MAX_COMMENT_CHARS) {
    return fail('comment_too_long', `التعليق يجب ألا يتجاوز ${MAX_COMMENT_CHARS} حرف`);
  }

  const imageFiles = form.getAll('images').filter(isFileLike);
  if (imageFiles.length > MAX_IMAGES) {
    return fail('too_many_images', `الحد الأقصى ${MAX_IMAGES} صور`);
  }

  const videoFiles = form.getAll('video').filter(isFileLike);
  if (videoFiles.length > 1) return fail('too_many_videos', 'الحد الأقصى فيديو واحد');

  const audioFiles = form.getAll('audio').filter(isFileLike);
  if (audioFiles.length > 1) return fail('too_many_audios', 'الحد الأقصى ملف صوتي واحد');

  const media: ValidMedia[] = [];

  for (const f of imageFiles) {
    const r = await readMediaFile(
      f,
      'image',
      MAX_IMAGE_BYTES,
      'حجم كل صورة يجب ألا يتجاوز 5 ميجابايت',
      'image_too_large',
    );
    if ('kind' in r && r.kind === 'error') return r;
    if ('kind' in r && r.kind === 'honeypot') return r;
    media.push(r as ValidMedia);
  }

  if (videoFiles[0]) {
    const r = await readMediaFile(
      videoFiles[0],
      'video',
      MAX_VIDEO_BYTES,
      'حجم الفيديو يجب ألا يتجاوز 50 ميجابايت',
      'video_too_large',
    );
    if ('kind' in r && (r.kind === 'error' || r.kind === 'honeypot')) return r;
    media.push(r as ValidMedia);
  }

  if (audioFiles[0]) {
    const r = await readMediaFile(
      audioFiles[0],
      'audio',
      MAX_AUDIO_BYTES,
      'حجم الملف الصوتي يجب ألا يتجاوز 15 ميجابايت',
      'audio_too_large',
    );
    if ('kind' in r && (r.kind === 'error' || r.kind === 'honeypot')) return r;
    media.push(r as ValidMedia);
  }

  const hasLargePath =
    !!cleanText(form.get('video_path'), { multiline: false }) ||
    !!cleanText(form.get('audio_path'), { multiline: false });

  if (!comment && !media.length && !hasLargePath) {
    return fail('empty_submission', 'أضف تعليقاً أو مرفقاً على الأقل');
  }

  return {
    kind: 'ok',
    eventId: eventId.toLowerCase(),
    authorName,
    comment: comment || null,
    media,
  };
}

export async function readBodyLimited(req: Request, limit: number): Promise<ArrayBuffer | null> {
  if (!req.body) return new ArrayBuffer(0);
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.byteLength;
  }
  return out.buffer as ArrayBuffer;
}

export function clientIp(headers: Headers): string {
  const direct = headers.get('cf-connecting-ip') || headers.get('x-real-ip');
  if (direct) return direct.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

async function sha256Hex(data: ArrayBuffer | Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function contentHash(
  eventId: string,
  comment: string | null,
  media: ValidMedia[],
): Promise<string> {
  const hashes = await Promise.all(media.map((i) => sha256Hex(i.bytes)));
  const normalized = (comment || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const kinds = media.map((m) => m.kind).sort().join(',');
  return sha256Hex(new TextEncoder().encode([eventId, normalized, kinds, ...hashes.sort()].join('\n')));
}

export function hashIp(ip: string, salt: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(`${salt}|${ip}`));
}
