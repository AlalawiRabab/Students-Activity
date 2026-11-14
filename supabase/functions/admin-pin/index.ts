/**
 * Edge Function: admin-pin
 * ---------------------------------------------------------------
 * فتح وضع إدارة المنصة بالرقم السري الخاص برائدة النشاط.
 * - يتحقق من الرقم في الخادم مقابل بصمة PBKDF2 في public.admin_pin (الرقم نفسه لا يُخزَّن ولا يُسجَّل).
 * - حد للمحاولات دون قفل عام: الجهاز الموثوق (سبق الدخول منه) له حده الخاص (5 / 15 دقيقة) ولا يتأثر
 *   بغيره؛ الجهاز الجديد: 5 / 15 دقيقة لكل بصمة IP وسقف إجمالي للأجهزة الجديدة فقط (30 / ساعة، 100 / يوم).
 * - عند النجاح يصدر جلسة Supabase Auth لحساب رائدة النشاط المعتمد ويسجّلها في admin_sessions؛
 *   صلاحيات الكتابة في RLS (is_editor / is_admin / is_feature_manager) تشترط هذه الجلسة.
 *
 * الطلب: POST JSON (device_token اختياري: رمز الجهاز الموثوق الذي أصدرته الدالة سابقاً)
 *   { "action": "login",  "pin": "......", "device_token"?: "..." }
 *   { "action": "change", "pin": "<الحالي>", "new_pin": "<الجديد>", "device_token"?: "..." }
 *     ← يُنهي كل جلسات الإدارة ويلغي ثقة الأجهزة الأخرى ويصدر جلسة جديدة
 * الاستجابة: { ok, access_token, refresh_token, expires_in, expires_at, admin_until, device_token? } أو { error, message }
 *
 * الأسرار: SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (تلقائية)،
 *   ADMIN_PIN_SALT (اختياري: ملح بصمات IP؛ وإلا PARENT_SUBMIT_SALT)، ADMIN_SESSION_HOURS (افتراضي 8)،
 *   EXTRA_ALLOWED_ORIGINS (اختياري).
 *
 * تُنشر بـ --no-verify-jwt (الزائر لا يملك جلسة)؛ لا تمنح شيئاً دون الرقم الصحيح.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  DEVICE_TOKEN_RE,
  PIN_INPUT_RE,
  clientIp,
  deviceTokenHash,
  hashIp,
  hashPin,
  newDeviceToken,
  readTextLimited,
  sessionIdFromJwt,
  validateNewPin,
  verifyPin,
} from './pin.ts';

const ALLOWED_ORIGINS = new Set([
  'https://activity.albian127.net',
  'https://alalawirabab.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  ...(Deno.env.get('EXTRA_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
]);

const MAX_BODY = 1024;

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };
}

function json(status: number, body: Record<string, unknown>, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const invalidPin = (origin: string) =>
  json(401, { error: 'invalid_pin', message: 'الرقم السري غير صحيح' }, origin);
const serverError = (origin: string) =>
  json(500, { error: 'server_error', message: 'تعذّر فتح وضع الإدارة، حاول لاحقاً' }, origin);

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: 'origin_not_allowed', message: 'الطلب مرفوض' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed', message: 'الطريقة غير مسموحة' }, origin);
  if (!(req.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return json(415, { error: 'bad_content_type', message: 'طلب غير صالح' }, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: 'server_misconfigured', message: 'إعداد الخادم غير مكتمل' }, origin);
  }
  const ipSalt = Deno.env.get('ADMIN_PIN_SALT') || Deno.env.get('PARENT_SUBMIT_SALT') || serviceKey;
  const sessionHours = Math.min(24, Math.max(1, Number(Deno.env.get('ADMIN_SESSION_HOURS')) || 8));

  const raw = await readTextLimited(req, MAX_BODY);
  if (raw === null) return json(413, { error: 'too_large', message: 'طلب غير صالح' }, origin);
  let body: { action?: unknown; pin?: unknown; new_pin?: unknown; device_token?: unknown };
  try {
    body = JSON.parse(raw || '{}');
  } catch {
    return json(400, { error: 'bad_request', message: 'طلب غير صالح' }, origin);
  }
  const action = body?.action;
  if (action !== 'login' && action !== 'change') {
    return json(400, { error: 'bad_request', message: 'طلب غير صالح' }, origin);
  }
  const pin = typeof body.pin === 'string' ? body.pin : '';
  // إدخال بصيغة لا يمكن أن تطابق أي رقم مخزن: رفض فوري دون فحص
  if (!PIN_INPUT_RE.test(pin)) return invalidPin(origin);
  let newPin = '';
  if (action === 'change') {
    const weak = validateNewPin(body.new_pin);
    if (weak) return json(400, { error: 'weak_pin', message: weak }, origin);
    newPin = body.new_pin as string;
    if (newPin === pin) return json(400, { error: 'weak_pin', message: 'الرقم الجديد مطابق للحالي' }, origin);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ipHash = await hashIp(clientIp(req.headers), ipSalt);
  const deviceToken = typeof body.device_token === 'string' && DEVICE_TOKEN_RE.test(body.device_token)
    ? body.device_token
    : null;
  const deviceHash = deviceToken ? await deviceTokenHash(deviceToken) : null;
  const { data: begin, error: beginErr } = await admin.rpc('admin_pin_begin', {
    p_ip_hash: ipHash,
    p_device_hash: deviceHash,
  });
  if (beginErr) {
    console.error('begin', beginErr.message);
    return serverError(origin);
  }
  const gate = Array.isArray(begin) ? begin[0] : begin;
  if (!gate || gate.status !== 'ok') {
    if (gate?.status === 'locked_new_devices') {
      return json(429, {
        error: 'locked_new_devices',
        message: 'الدخول من الأجهزة الجديدة متوقف مؤقتاً بسبب محاولات خاطئة كثيرة. استخدمي جهازاً سبق الدخول منه، أو حاولي لاحقاً.',
      }, origin);
    }
    return json(429, {
      error: 'locked',
      message: 'محاولات خاطئة كثيرة من هذا الجهاز. انتظري 15 دقيقة ثم حاولي مرة أخرى.',
    }, origin);
  }
  const attemptId = gate.attempt_id;
  const trusted = gate.trusted === true;

  const { data: row, error: rowErr } = await admin
    .from('admin_pin')
    .select('user_id, pin_hash')
    .eq('id', 1)
    .maybeSingle();
  if (rowErr) {
    console.error('pin row', rowErr.message);
    return serverError(origin);
  }
  if (!row?.pin_hash) {
    await admin.rpc('admin_pin_cancel', { p_attempt_id: attemptId });
    return json(503, { error: 'not_configured', message: 'لم يُضبط الرقم السري لإدارة المنصة بعد' }, origin);
  }

  if (!(await verifyPin(pin, row.pin_hash))) {
    await sleep(350 + Math.floor(Math.random() * 300));
    return invalidPin(origin);
  }
  await admin.rpc('admin_pin_succeed', { p_attempt_id: attemptId });

  // جهاز جديد نجح بالرقم الصحيح: يصبح موثوقاً (رمز عشوائي يُعاد للمتصفح وتُخزَّن بصمته فقط)
  let issuedDeviceToken: string | null = null;
  let keepDeviceHash = trusted ? deviceHash : null;
  if (!trusted) {
    issuedDeviceToken = newDeviceToken();
    keepDeviceHash = await deviceTokenHash(issuedDeviceToken);
    const { error: devErr } = await admin.rpc('admin_device_register', { p_token_hash: keepDeviceHash });
    if (devErr) {
      console.error('device', devErr.message);
      issuedDeviceToken = null;
    }
  }

  if (action === 'change') {
    const { error: upErr } = await admin
      .from('admin_pin')
      .update({ pin_hash: await hashPin(newPin), updated_at: new Date().toISOString() })
      .eq('id', 1);
    if (upErr) {
      console.error('pin update', upErr.message);
      return serverError(origin);
    }
    const { error: revokeErr } = await admin.rpc('admin_revoke_all_sessions');
    if (revokeErr) console.error('revoke', revokeErr.message);
    const { error: devRevokeErr } = await admin.rpc('admin_revoke_devices_except', { p_keep_hash: keepDeviceHash });
    if (devRevokeErr) console.error('revoke devices', devRevokeErr.message);
  }

  // الحساب الذي يفتحه الرقم: رائدة النشاط المعتمدة، نشطة وبدور تحرير
  const [{ data: fm }, { data: profile }] = await Promise.all([
    admin.from('feature_managers').select('user_id').eq('user_id', row.user_id).maybeSingle(),
    admin.from('profiles').select('is_active, role').eq('id', row.user_id).maybeSingle(),
  ]);
  if (!fm || !profile?.is_active || !['admin', 'activity_leader'].includes(profile.role)) {
    console.error('pin account not eligible');
    return serverError(origin);
  }

  const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(row.user_id);
  const email = userRes?.user?.email;
  if (userErr || !email) {
    console.error('user', userErr?.message ?? 'no email');
    return serverError(origin);
  }
  const { data: link, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
  const tokenHash = link?.properties?.hashed_token;
  if (linkErr || !tokenHash) {
    console.error('link', linkErr?.message ?? 'no token');
    return serverError(origin);
  }
  // عميل منفصل لإصدار الجلسة حتى لا تحل جلسة المستخدم محل مفتاح الخدمة في العميل الأول
  const issuer = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: verified, error: verifyErr } = await issuer.auth.verifyOtp({ token_hash: tokenHash, type: 'magiclink' });
  const session = verified?.session;
  if (verifyErr || !session?.access_token || !session.refresh_token) {
    console.error('verify', verifyErr?.message ?? 'no session');
    return serverError(origin);
  }
  const sessionId = sessionIdFromJwt(session.access_token);
  if (!sessionId) {
    console.error('no session_id claim');
    return serverError(origin);
  }
  const { data: until, error: regErr } = await admin.rpc('admin_pin_register_session', {
    p_session_id: sessionId,
    p_user_id: row.user_id,
    p_hours: sessionHours,
  });
  if (regErr) {
    console.error('register', regErr.message);
    return serverError(origin);
  }

  return json(200, {
    ok: true,
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    admin_until: until,
    ...(issuedDeviceToken ? { device_token: issuedDeviceToken } : {}),
  }, origin);
});
