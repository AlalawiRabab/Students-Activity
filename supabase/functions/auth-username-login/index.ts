/**
 * Edge Function: auth-username-login
 * ---------------------------------------------------------------
 * الغرض: تسجيل الدخول بـ username + password دون كشف البريد للمتصفح.
 *
 * الأسرار (في لوحة Supabase → Edge Functions → Secrets فقط):
 * - SUPABASE_URL (متوفر تلقائياً عادة)
 * - SUPABASE_ANON_KEY / SUPABASE_PUBLISHABLE_KEY
 * - SUPABASE_SERVICE_ROLE_KEY  ← ممنوع في الواجهة/GitHub Pages
 *
 * لا تنشر هذه الدالة قبل موافقة صريحة.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';

/** Origin فقط (بدون مسار). GitHub Pages تحت /Students-Activity/ يبقى alalawirabab.github.io */
const ALLOWED_ORIGINS = new Set([
  'https://alalawirabab.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
]);

const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers':
      'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function resolveAllowedOrigin(req: Request): string | null {
  const origin = req.headers.get('origin');
  if (!origin || !ALLOWED_ORIGINS.has(origin)) {
    return null;
  }
  return origin;
}

function json(
  status: number,
  body: Record<string, unknown>,
  origin: string
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function forbiddenOrigin() {
  return new Response(JSON.stringify({
    error: 'origin_not_allowed',
    message: 'الطلب مرفوض',
  }), {
    status: 403,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
}

/** رسالة موحّدة لتقليل تمييز وجود الاسم / خطأ كلمة المرور */
function invalidCreds(origin: string) {
  return json(401, {
    error: 'invalid_credentials',
    message: 'اسم المستخدم أو كلمة المرور غير صحيحة',
  }, origin);
}

Deno.serve(async (req) => {
  const origin = resolveAllowedOrigin(req);
  if (!origin) {
    return forbiddenOrigin();
  }

  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(origin) });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed', message: 'الطريقة غير مسموحة' }, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const anonKey =
    Deno.env.get('SUPABASE_ANON_KEY') ??
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ??
    '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !anonKey || !serviceKey) {
    return json(500, {
      error: 'server_misconfigured',
      message: 'إعداد الخادم غير مكتمل',
    }, origin);
  }

  let payload: { username?: string; password?: string };
  try {
    payload = await req.json();
  } catch {
    return json(400, { error: 'bad_request', message: 'طلب غير صالح' }, origin);
  }

  const username = String(payload.username ?? '').trim();
  const password = String(payload.password ?? '');

  if (!USERNAME_RE.test(username) || !password) {
    return invalidCreds(origin);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: found, error: findErr } = await admin.rpc(
    'get_profile_for_username_login',
    { p_username: username }
  );

  const profile = Array.isArray(found) ? found[0] : found;
  if (findErr || !profile?.id || profile.is_active !== true) {
    return invalidCreds(origin);
  }

  const { data: userData, error: userErr } = await admin.auth.admin.getUserById(
    profile.id
  );
  const email = userData?.user?.email;
  if (userErr || !email) {
    return invalidCreds(origin);
  }

  const pub = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: signInData, error: signInErr } = await pub.auth.signInWithPassword({
    email,
    password,
  });

  if (signInErr || !signInData.session) {
    return invalidCreds(origin);
  }

  const session = signInData.session;
  return json(200, {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    token_type: session.token_type ?? 'bearer',
  }, origin);
});
