/**
 * Edge Function: parent-submit
 * ---------------------------------------------------------------
 * استقبال مشاركة ولي الأمر في «بعيون أهالينا» دون حساب.
 * - الزائر لا يملك أي صلاحية كتابة في قاعدة البيانات أو التخزين؛ هذه الدالة وحدها تكتب
 *   بمفتاح service_role (سرّ خادم — ممنوع في الواجهة).
 * - المشاركة تُنشأ دائماً بحالة pending عبر create_parent_post (والمحفز يفرض ذلك أيضاً).
 * - حماية: Origin مسموح، حد للحجم، فحص نوع الصور من بايتاتها، حقل خفي (honeypot)،
 *   زمن تعبئة أدنى، وحد إرسال لكل بصمة IP مُجزّأة (parent_submit_throttle).
 *
 * الأسرار (Supabase → Edge Functions → Secrets):
 * - SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (متوفرة تلقائياً)
 * - PARENT_SUBMIT_SALT (اختياري، يُنصح به) — ملح تجزئة عناوين IP
 * - EXTRA_ALLOWED_ORIGINS (اختياري) — نطاقات إضافية مفصولة بفواصل
 *
 * لا تنشر هذه الدالة قبل موافقة صريحة.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  MAX_BODY_BYTES,
  clientIp,
  contentHash,
  hashIp,
  parseSubmission,
  readBodyLimited,
} from './validate.ts';

const BUCKET = 'parents-eyes';

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

function corsHeaders(origin: string): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

function json(status: number, body: Record<string, unknown>, origin: string) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

const genericError = (origin: string) =>
  json(500, { error: 'server_error', message: 'تعذّر حفظ المشاركة، حاول لاحقاً' }, origin);

Deno.serve(async (req) => {
  const origin = req.headers.get('origin') ?? '';
  if (!ALLOWED_ORIGINS.has(origin)) {
    return new Response(JSON.stringify({ error: 'origin_not_allowed', message: 'الطلب مرفوض' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
    });
  }
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) });
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed', message: 'الطريقة غير مسموحة' }, origin);
  }

  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return json(415, { error: 'bad_content_type', message: 'طلب غير صالح' }, origin);
  }
  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MAX_BODY_BYTES) {
    return json(413, { error: 'too_large', message: 'حجم المرفقات أكبر من المسموح' }, origin);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: 'server_misconfigured', message: 'إعداد الخادم غير مكتمل' }, origin);
  }
  const salt = Deno.env.get('PARENT_SUBMIT_SALT') || serviceKey;

  const body = await readBodyLimited(req, MAX_BODY_BYTES);
  if (!body) return json(413, { error: 'too_large', message: 'حجم المرفقات أكبر من المسموح' }, origin);

  let form: FormData;
  try {
    form = await new Response(body, { headers: { 'content-type': contentType } }).formData();
  } catch {
    return json(400, { error: 'bad_request', message: 'طلب غير صالح' }, origin);
  }

  const parsed = await parseSubmission(form);
  // الحقل الخفي ممتلئ: نردّ بنجاح شكلي دون حفظ شيء
  if (parsed.kind === 'honeypot') return json(200, { ok: true }, origin);
  if (parsed.kind === 'error') {
    return json(parsed.status, { error: parsed.error, message: parsed.message }, origin);
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const ipHash = await hashIp(clientIp(req.headers), salt);
  const { data: allowed, error: throttleErr } = await admin.rpc('parent_submit_throttle', {
    p_ip_hash: ipHash,
  });
  if (throttleErr) {
    console.error('throttle', throttleErr.message);
    return genericError(origin);
  }
  if (allowed !== true) {
    return json(429, {
      error: 'rate_limited',
      message: 'تم استلام عدة مشاركات من هذا الجهاز مؤخراً، حاول لاحقاً',
    }, origin);
  }

  const { data: event, error: eventErr } = await admin
    .from('parent_events')
    .select('id, is_open')
    .eq('id', parsed.eventId)
    .maybeSingle();
  if (eventErr) {
    console.error('event', eventErr.message);
    return genericError(origin);
  }
  if (!event?.is_open) {
    return json(409, { error: 'event_closed', message: 'هذه المناسبة لا تستقبل مشاركات حالياً' }, origin);
  }

  const postId = crypto.randomUUID();
  const uploaded: { path: string; mime: string; size: number }[] = [];
  const cleanup = async () => {
    if (!uploaded.length) return;
    const { error } = await admin.storage.from(BUCKET).remove(uploaded.map((u) => u.path));
    if (error) console.error('cleanup', error.message);
  };

  for (const img of parsed.images) {
    const path = `posts/${postId}/${crypto.randomUUID()}.${img.ext}`;
    const { error } = await admin.storage
      .from(BUCKET)
      .upload(path, new Blob([img.bytes], { type: img.mime }), {
        contentType: img.mime,
        upsert: false,
        cacheControl: '3600',
      });
    if (error) {
      console.error('upload', error.message);
      await cleanup();
      return genericError(origin);
    }
    uploaded.push({ path, mime: img.mime, size: img.size });
  }

  const { error: createErr } = await admin.rpc('create_parent_post', {
    p_post_id: postId,
    p_event_id: parsed.eventId,
    p_author_name: parsed.authorName,
    p_comment: parsed.comment,
    p_consent: true,
    p_images: uploaded,
    p_content_hash: await contentHash(parsed.eventId, parsed.comment, parsed.images),
  });
  if (createErr) {
    await cleanup();
    const msg = createErr.message || '';
    if (/duplicate_submission/.test(msg)) {
      return json(409, { error: 'duplicate', message: 'وصلتنا هذه المشاركة من قبل، وهي بانتظار المراجعة' }, origin);
    }
    if (/event_queue_full/.test(msg)) {
      return json(429, { error: 'queue_full', message: 'استقبال المشاركات لهذه المناسبة ممتلئ مؤقتاً، حاول لاحقاً' }, origin);
    }
    if (/غير مفتوحة/.test(msg)) {
      return json(409, { error: 'event_closed', message: 'هذه المناسبة لا تستقبل مشاركات حالياً' }, origin);
    }
    console.error('create', msg);
    return genericError(origin);
  }

  return json(200, { ok: true }, origin);
});
