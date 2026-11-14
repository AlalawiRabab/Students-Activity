/**
 * supabase-client.js — عميل Supabase واحد
 * جلسة وضع الإدارة تُحفظ في sessionStorage (تنتهي بإغلاق التبويب)، والزائر بلا جلسة.
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY, isConfigReady } from './config.js';

let client = null;

export function getSupabase() {
  if (!isConfigReady()) {
    throw new Error('CONFIG_MISSING');
  }
  if (!client) {
    client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
        storage: window.sessionStorage,
        storageKey: 'sap-admin',
      },
    });
  }
  return client;
}
