/**
 * config.js — إعدادات Supabase العامة فقط
 * ضع قيم مشروعك من: Project Settings → API
 * ممنوع وضع service_role أو أي سر هنا.
 */
export const SUPABASE_URL = 'https://rcxcmxaplyzxhhgrmhqj.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_rVKgkQlYmVgRe2KzQv5-Pg_Ij-CC9k9';

export const STORAGE_BUCKET = 'student-activity-files';
export const SCHEMA_VERSION = 1;
export const APP_NAME = 'Student Activity Platform';

export const MAX_IMAGE_SIZE = 5 * 1024 * 1024; // 5 MB
export const MAX_PDF_SIZE = 10 * 1024 * 1024; // 10 MB

export const ALLOWED_IMAGE_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
]);

export const ALLOWED_DOCUMENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
]);

export const SIGNED_URL_EXPIRES_IN = 120; // ثانية
export const THUMB_URL_EXPIRES_IN = 600; // ثانية — صور مصغّرة في بطاقات الملفات

/** ملفات أقسام رائدة النشاط (migrations/002) — حد الـ bucket الحالي 10MB */
export const SECTION_FILE_MAX_SIZE = 10 * 1024 * 1024;

/** امتداد → { mime قياسي، أنواع MIME المقبولة من المتصفح، نوع العرض } */
export const SECTION_FILE_TYPES = Object.freeze({
  pdf: { mime: 'application/pdf', accept: ['application/pdf'], kind: 'pdf' },
  jpg: { mime: 'image/jpeg', accept: ['image/jpeg', 'image/pjpeg'], kind: 'image' },
  jpeg: { mime: 'image/jpeg', accept: ['image/jpeg', 'image/pjpeg'], kind: 'image' },
  png: { mime: 'image/png', accept: ['image/png'], kind: 'image' },
  webp: { mime: 'image/webp', accept: ['image/webp'], kind: 'image' },
  gif: { mime: 'image/gif', accept: ['image/gif'], kind: 'image' },
  doc: { mime: 'application/msword', accept: ['application/msword'], kind: 'word' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    accept: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/octet-stream',
      'application/zip',
    ],
    kind: 'word',
  },
  xls: {
    mime: 'application/vnd.ms-excel',
    accept: ['application/vnd.ms-excel', 'application/octet-stream'],
    kind: 'excel',
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    accept: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
      'application/zip',
    ],
    kind: 'excel',
  },
});

/** ملفات المسابقات (migrations/004): PDF / صور / Word / PowerPoint — حتى 10 م.ب */
export const COMPETITION_FILE_MAX_SIZE = 10 * 1024 * 1024;
export const COMPETITION_FILE_TYPES = Object.freeze({
  pdf: SECTION_FILE_TYPES.pdf,
  jpg: SECTION_FILE_TYPES.jpg,
  jpeg: SECTION_FILE_TYPES.jpeg,
  png: SECTION_FILE_TYPES.png,
  webp: SECTION_FILE_TYPES.webp,
  gif: SECTION_FILE_TYPES.gif,
  doc: SECTION_FILE_TYPES.doc,
  docx: SECTION_FILE_TYPES.docx,
  ppt: {
    mime: 'application/vnd.ms-powerpoint',
    accept: ['application/vnd.ms-powerpoint', 'application/octet-stream'],
    kind: 'powerpoint',
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    accept: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/octet-stream',
      'application/zip',
    ],
    kind: 'powerpoint',
  },
});

/** «بعيون أهالينا» (migrations/004) — bucket خاص؛ القراءة العامة للمعتمد فقط عبر RLS */
export const PARENTS_BUCKET = 'parents-eyes';
export const PARENT_SUBMIT_FUNCTION = 'parent-submit';
export const PARENT_MAX_IMAGES = 5;
export const PARENT_MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const PARENT_IMAGE_TYPES = Object.freeze(['image/jpeg', 'image/png', 'image/webp']);

/** PDF.js لصور الصفحة الأولى في بطاقات PDF (نسخة legacy للمتصفحات الأقدم) */
export const PDFJS_BASE = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/legacy/build/';
export const PDFJS_ASSETS = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/';

export const PAGE_SIZE = 20;

/** وضع الإدارة: Edge Function تتحقق من الرقم السري في الخادم (migrations/005) */
export const ADMIN_PIN_FUNCTION = 'admin-pin';

/** النطاق الرسمي للمنصة ورابط مشاركة الأهالي الثابت (يُرسل للأهالي) */
export const PUBLIC_SITE_URL = 'https://activity.albian127.net';
export const PARENTS_SHARE_URL = `${PUBLIC_SITE_URL}/parents-share.html`;

export function isConfigReady() {
  return (
    typeof SUPABASE_URL === 'string' &&
    typeof SUPABASE_ANON_KEY === 'string' &&
    !SUPABASE_URL.includes('YOUR_SUPABASE') &&
    !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE') &&
    SUPABASE_URL.startsWith('https://') &&
    SUPABASE_ANON_KEY.length > 20
  );
}
