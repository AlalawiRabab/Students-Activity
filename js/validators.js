/**
 * validators.js — التحقق من المدخلات والملفات
 */
import {
  MAX_IMAGE_SIZE,
  MAX_PDF_SIZE,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_DOCUMENT_TYPES,
} from './config.js';
import { getFileExtension } from './utils.js';

const EXT_BY_MIME = {
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

export function validateRequired(value, label = 'الحقل') {
  if (value == null || String(value).trim() === '') {
    return `${label} مطلوب`;
  }
  return null;
}

export function validateLength(value, label, min, max) {
  const len = String(value ?? '').trim().length;
  if (len < min || len > max) {
    return `${label} يجب أن يكون بين ${min} و ${max} حرفاً`;
  }
  return null;
}

export function validatePassword(password) {
  const p = String(password || '');
  if (p.length < 8) return 'كلمة المرور يجب ألا تقل عن 8 أحرف';
  if (!/[A-Za-z]/.test(p) || !/[0-9]/.test(p)) {
    return 'كلمة المرور يجب أن تحتوي على حروف وأرقام';
  }
  return null;
}

export function validateEmail(email) {
  const e = String(email || '').trim();
  if (!e) return 'البريد الإلكتروني مطلوب';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)) return 'صيغة البريد غير صحيحة';
  return null;
}

/** اسم مستخدم لتسجيل الدخول: 3–32 حرفاً، أحرف إنجليزية/أرقام/_ . - */
export function validateUsername(username) {
  const u = String(username || '').trim();
  if (!u) return 'اسم المستخدم مطلوب';
  if (u.length < 3 || u.length > 32) {
    return 'اسم المستخدم يجب أن يكون بين 3 و 32 حرفاً';
  }
  if (!/^[A-Za-z0-9._-]+$/.test(u)) {
    return 'اسم المستخدم يقبل أحرفاً إنجليزية وأرقاماً و . _ - فقط';
  }
  return null;
}

/**
 * @param {File} file
 * @param {'image'|'document'} mode
 */
export function validateFile(file, mode = 'document') {
  if (!file) return { ok: false, error: 'لم يتم اختيار ملف' };

  const mime = file.type;
  const ext = getFileExtension(file.name);
  const allowed =
    mode === 'image' ? ALLOWED_IMAGE_TYPES : ALLOWED_DOCUMENT_TYPES;

  if (!allowed.includes(mime)) {
    return {
      ok: false,
      error: 'نوع الملف غير مسموح. المسموح: JPG, PNG, WEBP' + (mode === 'image' ? '' : ', PDF'),
    };
  }

  const expectedExts = EXT_BY_MIME[mime] || [];
  if (!expectedExts.includes(ext)) {
    return {
      ok: false,
      error: 'امتداد الملف لا يطابق نوعه الحقيقي',
    };
  }

  const max = mime === 'application/pdf' ? MAX_PDF_SIZE : MAX_IMAGE_SIZE;
  if (file.size <= 0) return { ok: false, error: 'الملف فارغ' };
  if (file.size > max) {
    const mb = max / (1024 * 1024);
    return {
      ok: false,
      error: `حجم الملف يتجاوز الحد المسموح (${mb} م.ب)`,
    };
  }

  return { ok: true, mime, ext, max };
}

export function sanitizeBackupDetails(obj) {
  if (!obj || typeof obj !== 'object') return {};
  const forbidden = [
    'password',
    'passwd',
    'token',
    'access_token',
    'refresh_token',
    'secret',
    'service_role',
    'role',
    'authorization',
    'jwt',
  ];
  const out = {};
  Object.keys(obj).forEach((key) => {
    if (forbidden.includes(key.toLowerCase())) return;
    out[key] = obj[key];
  });
  return out;
}
