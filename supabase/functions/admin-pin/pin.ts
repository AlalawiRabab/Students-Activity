/**
 * pin.ts — أدوات الرقم السري لوضع الإدارة (بدون اعتماديات؛ تُختبر بـ deno test)
 * الصيغة المخزنة: pbkdf2-sha256$<iterations>$<salt base64>$<hash base64>
 * نفس الصيغة يولّدها tools/set-admin-pin.mjs (Node) عند الضبط أول مرة.
 */

export const PBKDF2_ITERATIONS = 210_000;
const KEY_BYTES = 32;
const SALT_BYTES = 16;

/** أي إدخال للدخول: أرقام فقط، 6–12 (لا يُفحص غيره ولا يُحتسب محاولة) */
export const PIN_INPUT_RE = /^[0-9]{6,12}$/;

/** شروط الرقم الجديد: 6–12 رقماً، ليس رقماً مكرراً ولا تسلسلاً بسيطاً */
export function validateNewPin(pin: unknown): string | null {
  if (typeof pin !== 'string' || !PIN_INPUT_RE.test(pin)) {
    return 'الرقم السري يجب أن يكون من 6 إلى 12 رقماً';
  }
  if (/^(\d)\1+$/.test(pin)) return 'اختر رقماً سرياً غير مكوّن من رقم واحد مكرر';
  const digits = [...pin].map(Number);
  const step = digits[1] - digits[0];
  if (Math.abs(step) === 1 && digits.every((d, i) => i === 0 || d - digits[i - 1] === step)) {
    return 'اختر رقماً سرياً غير متسلسل';
  }
  return null;
}

function toB64(bytes: Uint8Array): string {
  let s = '';
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    KEY_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPin(pin: string, iterations = PBKDF2_ITERATIONS): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const dk = await derive(pin, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${toB64(salt)}$${toB64(dk)}`;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function verifyPin(pin: string, encoded: string | null | undefined): Promise<boolean> {
  if (!encoded) return false;
  const parts = encoded.split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 2_000_000) return false;
  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromB64(parts[2]);
    expected = fromB64(parts[3]);
  } catch {
    return false;
  }
  const actual = await derive(pin, salt, iterations);
  return timingSafeEqual(actual, expected);
}

export function clientIp(headers: Headers): string {
  const direct = headers.get('cf-connecting-ip') || headers.get('x-real-ip');
  if (direct) return direct.trim();
  const xff = headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0].trim();
  return 'unknown';
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hashIp(ip: string, salt: string): Promise<string> {
  return sha256Hex(`admin-pin|${salt}|${ip}`);
}

/** رمز الجهاز الموثوق: 32 بايت عشوائية base64url (43 حرفاً). يُخزَّن في الخادم كبصمة فقط. */
export const DEVICE_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export function newDeviceToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function deviceTokenHash(token: string): Promise<string> {
  return sha256Hex(`admin-device|${token}`);
}

/** معرّف جلسة Supabase Auth من حمولة JWT صادر للتو من الخادم نفسه */
export function sessionIdFromJwt(token: string): string | null {
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const json = JSON.parse(atob(part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=')));
    const sid = json?.session_id;
    return typeof sid === 'string' && /^[0-9a-f-]{36}$/i.test(sid) ? sid : null;
  } catch {
    return null;
  }
}

/** قراءة جسم صغير بحد أقصى؛ null عند التجاوز */
export async function readTextLimited(req: Request, max: number): Promise<string | null> {
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    all.set(c, off);
    off += c.length;
  }
  return new TextDecoder().decode(all);
}
