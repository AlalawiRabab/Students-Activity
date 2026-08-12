/**
 * utils.js — أدوات عامة
 */

export function debounce(fn, wait = 300) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} بايت`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} ك.ب`;
  return `${(n / (1024 * 1024)).toFixed(1)} م.ب`;
}

export function formatDate(value) {
  if (!value) return '—';
  try {
    const d = value instanceof Date ? value : new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat('ar-SA-u-ca-gregory', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return String(value);
  }
}

export function toISODate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** مفتاح يوم محلي YYYY-MM-DD بدون UTC / toISOString */
export function localDateKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * توحيد تاريخ قادم من PostgreSQL DATE / Supabase إلى YYYY-MM-DD
 * لا يمرّر date-only عبر new Date() لتفادي إزاحة المنطقة الزمنية.
 */
export function normalizeDbDate(value) {
  if (value == null || value === '') return '';
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return localDateKey(value);
  }
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  return '';
}

/** توافق خلفي — يفضّل normalizeDbDate / localDateKey */
export function toDateKey(value) {
  if (value instanceof Date) return localDateKey(value);
  const fromDb = normalizeDbDate(value);
  if (fromDb) return fromDb;
  return '';
}

export function formatHijri(date) {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('ar-SA-u-ca-islamic', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}

export function arabicIncludes(haystack, needle) {
  const h = normalizeArabic(haystack);
  const n = normalizeArabic(needle);
  if (!n) return true;
  return h.includes(n);
}

export function normalizeArabic(text) {
  return String(text ?? '')
    .toLowerCase()
    .replace(/[أإآا]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getFileExtension(filename) {
  const parts = String(filename || '').split('.');
  if (parts.length < 2) return '';
  return parts.pop().toLowerCase().replace(/[^a-z0-9]/g, '');
}

export function mimeToFileType(mime) {
  if (mime === 'application/pdf') return 'pdf';
  if (String(mime).startsWith('image/')) return 'image';
  return 'other';
}

export function recipientTypeLabel(type) {
  const map = { student: 'طالبة', teacher: 'معلمة', other: 'أخرى' };
  return map[type] || type || '—';
}

export function createEl(tag, attrs = {}, children = []) {
  const el = document.createElement(tag);
  Object.entries(attrs).forEach(([key, val]) => {
    if (val == null || val === false) return;
    if (key === 'className') el.className = val;
    else if (key === 'textContent') el.textContent = val;
    else if (key === 'dataset') {
      Object.entries(val).forEach(([dk, dv]) => {
        el.dataset[dk] = dv;
      });
    } else if (key.startsWith('on') && typeof val === 'function') {
      el.addEventListener(key.slice(2).toLowerCase(), val);
    } else if (key === 'disabled') el.disabled = Boolean(val);
    else el.setAttribute(key, val === true ? '' : String(val));
  });
  (Array.isArray(children) ? children : [children]).forEach((child) => {
    if (child == null) return;
    if (typeof child === 'string') el.appendChild(document.createTextNode(child));
    else el.appendChild(child);
  });
  return el;
}

export function clearElement(el) {
  if (!el) return;
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function isDev() {
  return location.hostname === 'localhost' || location.hostname === '127.0.0.1';
}

export function logDev(...args) {
  if (isDev()) console.error(...args);
}

export function parseYMD(ymd) {
  if (!ymd) return null;
  const [y, m, d] = String(ymd).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
