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

export const PAGE_SIZE = 20;

/** اسم Edge Function لتسجيل الدخول باسم المستخدم */
export const USERNAME_LOGIN_FUNCTION = 'auth-username-login';

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
