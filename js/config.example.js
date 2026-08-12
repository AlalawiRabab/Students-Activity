/**
 * config.example.js — انسخ إلى config.js واملأ القيم
 */
export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
export const STORAGE_BUCKET = 'student-activity-files';
export const SCHEMA_VERSION = 1;
export const APP_NAME = 'Student Activity Platform';
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
export const MAX_PDF_SIZE = 10 * 1024 * 1024;
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
export const SIGNED_URL_EXPIRES_IN = 120;
export const PAGE_SIZE = 20;
export function isConfigReady() {
  return (
    !SUPABASE_URL.includes('YOUR_PROJECT') &&
    !SUPABASE_ANON_KEY.includes('YOUR_SUPABASE')
  );
}
