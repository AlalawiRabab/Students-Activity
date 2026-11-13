/**
 * validate.ts — تحقق خادمي خالص (بلا شبكة) لمشاركات «بعيون أهالينا»
 * يُختبر عبر: deno test supabase/functions/parent-submit/
 */

export const MAX_IMAGES = 5;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_NAME_CHARS = 80;
export const MAX_COMMENT_CHARS = 2000;
export const MIN_ELAPSED_MS = 2500;
/** 5 صور × 5 م.ب + هامش للحقول وترويسات multipart */
export const MAX_BODY_BYTES = MAX_IMAGES * MAX_IMAGE_BYTES + 512 * 1024;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** محارف التحكم ومحارف تجاوز الاتجاه (تُستخدم للتمويه) */
// deno-lint-ignore no-control-regex
const CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u202A-\u202E\u2066-\u2069]/g;

export type SniffedImage = { mime: 'image/jpeg' | 'image/png' | 'image/webp'; ext: 'jpg' | 'png' | 'webp' };

/** نوع الصورة من البايتات الفعلية لا من اسم الملف أو ترويسة المتصفح */
export function sniffImage(bytes: Uint8Array): SniffedImage | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mime: 'image/jpeg', ext: 'jpg' };
  }
  const png = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length >= 8 && png.every((b, i) => bytes[i] === b)) {
    return { mime: 'image/png', ext: 'png' };
  }
  const ascii = (from: number, to: number) => String.fromCharCode(...bytes.subarray(from, to));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    return { mime: 'image/webp', ext: 'webp' };
  }
  return null;
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

export type ValidImage = { bytes: ArrayBuffer; mime: string; ext: string; size: number };

export type ParseResult =
  | { kind: 'honeypot' }
  | { kind: 'error'; status: number; error: string; message: string }
  | {
      kind: 'ok';
      eventId: string;
      authorName: string | null;
      comment: string | null;
      images: ValidImage[];
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

export async function parseSubmission(form: FormData): Promise<ParseResult> {
  if (cleanText(form.get('website'), { multiline: false })) return { kind: 'honeypot' };

  const elapsed = Number(form.get('elapsed_ms'));
  if (!Number.isFinite(elapsed) || elapsed < MIN_ELAPSED_MS) {
    return fail('too_fast', 'تعذّر إرسال المشاركة، انتظر لحظات ثم أعد المحاولة');
  }

  const eventId = cleanText(form.get('event_id'), { multiline: false });
  if (!UUID_RE.test(eventId)) return fail('invalid_event', 'اختر المناسبة');

  if (form.get('consent') !== 'yes') {
    return fail('consent_required', 'يلزم الإقرار بالموافقة على نشر الصور');
  }

  const authorName = cleanText(form.get('author_name'), { multiline: false });
  if (authorName.length > MAX_NAME_CHARS) {
    return fail('name_too_long', `الاسم يجب ألا يتجاوز ${MAX_NAME_CHARS} حرفاً`);
  }

  const comment = cleanText(form.get('comment'), { multiline: true });
  if (comment.length > MAX_COMMENT_CHARS) {
    return fail('comment_too_long', `التعليق يجب ألا يتجاوز ${MAX_COMMENT_CHARS} حرف`);
  }

  const files = form.getAll('images').filter(isFileLike);
  if (files.length > MAX_IMAGES) {
    return fail('too_many_images', `الحد الأقصى ${MAX_IMAGES} صور`);
  }

  const images: ValidImage[] = [];
  for (const f of files) {
    if (f.size <= 0) return fail('empty_image', 'إحدى الصور فارغة');
    if (f.size > MAX_IMAGE_BYTES) {
      return fail('image_too_large', 'حجم كل صورة يجب ألا يتجاوز 5 ميجابايت', 413);
    }
    const bytes = await f.arrayBuffer();
    const sniffed = sniffImage(new Uint8Array(bytes));
    if (!sniffed) return fail('invalid_image', 'نوع إحدى الصور غير مدعوم (JPG أو PNG أو WEBP فقط)');
    images.push({ bytes, mime: sniffed.mime, ext: sniffed.ext, size: bytes.byteLength });
  }

  if (!comment && !images.length) {
    return fail('empty_submission', 'أضف صورة أو تعليقاً على الأقل');
  }

  return {
    kind: 'ok',
    eventId: eventId.toLowerCase(),
    authorName: authorName || null,
    comment: comment || null,
    images,
  };
}

/** قراءة الجسم مع قطع الاتصال عند تجاوز الحد (لا يُعتمد على Content-Length وحده) */
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

/**
 * عنوان العميل لحدّ «لكل جهاز» فقط. الترويسات قد يزوّرها العميل إن لم تكتبها البنية الوسيطة،
 * لذلك هذا الحد طبقة أولى؛ الحدود الحاسمة لا تعتمد على الهوية (إجمالي المنصة، سعة كل مناسبة،
 * ورفض المحتوى المكرر) وتُفرض في قاعدة البيانات.
 */
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

/** بصمة المحتوى لرفض إعادة إرسال المشاركة نفسها (نفس المناسبة والتعليق والصور) */
export async function contentHash(eventId: string, comment: string | null, images: ValidImage[]): Promise<string> {
  const imageHashes = await Promise.all(images.map((i) => sha256Hex(i.bytes)));
  const normalized = (comment || '').replace(/\s+/g, ' ').trim().toLowerCase();
  return sha256Hex(new TextEncoder().encode([eventId, normalized, ...imageHashes.sort()].join('\n')));
}

export function hashIp(ip: string, salt: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(`${salt}|${ip}`));
}
