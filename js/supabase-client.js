/**
 * supabase-client.js — عميل Supabase واحد
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
        detectSessionInUrl: true,
        storageKey: 'sap-auth',
      },
    });
  }
  return client;
}
