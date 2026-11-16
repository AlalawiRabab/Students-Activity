/**
 * Edge Function: parent-submit
 * ---------------------------------------------------------------
 * استقبال مشاركة ولي الأمر دون حساب.
 *
 * مسار الرفع:
 * 1) prepare (JSON): تجهيز Signed Upload للفيديو/الصوت مباشرة إلى التخزين
 *    — لا يمر الملف عبر ذاكرة Edge (حد ~256 م.ب)، فيدعم فيديو حتى 50 م.ب.
 * 2) finalize (multipart صغير): صور ≤5×5م.ب + حقول + مسارات الفيديو/الصوت المرفوعة.
 * عند فشل الإنهاء تُحذف مرفقات هذه المشاركة فقط.
 *
 * لا تنشر قبل موافقة صريحة.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGES,
  clientIp,
  hashIp,
  parseSubmission,
  readBodyLimited,
} from './validate.ts';
import {
  BUCKET,
  finalizeSubmission,
  prepareLargeUploads,
  type DbLike,
  type StorageLike,
} from './submit-flow.ts';

const ALLOWED_ORIGINS = new Set([
  'https://activity.albian127.net',
  'https://alalawirabab.github.io',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
  'http://localhost:4174',
  'http://127.0.0.1:4174',
  'http://localhost:4175',
  'http://127.0.0.1:4175',
  ...(Deno.env.get('EXTRA_ALLOWED_ORIGINS') ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
]);

/** جسم multipart للصور + الحقول فقط (الفيديو/الصوت عبر Signed Upload) */
const MULTIPART_LIMIT =
  MAX_IMAGES * MAX_IMAGE_BYTES + 1024 * 1024;

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

function makeStorage(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
): StorageLike {
  return {
    async upload(path, data, contentType) {
      const body = data instanceof ArrayBuffer ? new Blob([data], { type: contentType }) : data;
      const { error } = await admin.storage.from(BUCKET).upload(path, body, {
        contentType,
        upsert: false,
        cacheControl: '3600',
      });
      return { error: error?.message ?? null };
    },
    async remove(paths) {
      if (!paths.length) return { error: null };
      const { error } = await admin.storage.from(BUCKET).remove(paths);
      return { error: error?.message ?? null };
    },
    async createSignedUpload(path) {
      const { data, error } = await admin.storage.from(BUCKET).createSignedUploadUrl(path);
      return {
        signedUrl: data?.signedUrl ?? '',
        token: data?.token ?? '',
        error: error?.message ?? null,
      };
    },
    async downloadPrefix(path, maxBytes) {
      // Range + قراءة محدودة — لا يحمّل 50م.ب في ذاكرة الدالة حتى لو تُجاهل Range
      const url = `${supabaseUrl.replace(/\/$/, '')}/storage/v1/object/${BUCKET}/${path}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${serviceKey}`,
          apikey: serviceKey,
          Range: `bytes=0-${Math.max(0, maxBytes - 1)}`,
        },
      });
      if (res.status === 404) return { bytes: null, size: 0, exists: false, error: null };
      if (!res.ok && res.status !== 206) {
        return { bytes: null, size: 0, exists: false, error: `storage ${res.status}` };
      }
      const cr = res.headers.get('content-range') || '';
      const totalMatch = /\/(\d+)\s*$/.exec(cr);
      const headerLen = Number(res.headers.get('content-length') || 0);
      const chunks: Uint8Array[] = [];
      let total = 0;
      if (!res.body) {
        return { bytes: null, size: 0, exists: false, error: 'empty_body' };
      }
      const reader = res.body.getReader();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const need = maxBytes - total;
        if (need <= 0) {
          await reader.cancel();
          break;
        }
        chunks.push(value.byteLength > need ? value.subarray(0, need) : value);
        total += Math.min(value.byteLength, need);
        if (total >= maxBytes) {
          await reader.cancel();
          break;
        }
      }
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        buf.set(c, off);
        off += c.byteLength;
      }
      const size = totalMatch
        ? Number(totalMatch[1])
        : (Number.isFinite(headerLen) && headerLen > 0 ? headerLen : buf.length);
      return { bytes: buf, size: Number.isFinite(size) ? size : buf.length, exists: true, error: null };
    },
    async objectUpdatedAt(path) {
      const parts = path.split('/');
      const name = parts.pop() || '';
      const folder = parts.join('/');
      const { data, error } = await admin.storage.from(BUCKET).list(folder, {
        search: name,
        limit: 20,
      });
      if (error) return { updatedAt: null, exists: false };
      const found = (data || []).find((o) => o.name === name);
      if (!found) return { updatedAt: null, exists: false };
      const raw = found.updated_at || found.created_at || null;
      return { updatedAt: raw ? new Date(raw) : null, exists: true };
    },
  };
}

function makeDb(admin: ReturnType<typeof createClient>): DbLike {
  return {
    async throttle(ipHash) {
      const { data, error } = await admin.rpc('parent_submit_throttle', { p_ip_hash: ipHash });
      if (error) return { allowed: false, error: error.message };
      return { allowed: data === true, error: null };
    },
    async getEvent(eventId) {
      const { data, error } = await admin
        .from('parent_events')
        .select('id, is_open')
        .eq('id', eventId)
        .maybeSingle();
      if (error) return { error: error.message };
      return data;
    },
    async postExists(postId) {
      const { data, error } = await admin.from('parent_posts').select('id').eq('id', postId).maybeSingle();
      if (error) return { exists: false, error: error.message };
      return { exists: !!data, error: null };
    },
    async registerIntents(postId, intents) {
      const { error } = await admin.rpc('parent_register_upload_intents', {
        p_post_id: postId,
        p_intents: intents.map((i) => ({
          path: i.path,
          kind: i.kind,
          size: i.expectedSize,
          ext: i.expectedExt,
        })),
      });
      return { error: error?.message ?? null };
    },
    async getIntents(postId) {
      const { data, error } = await admin.rpc('parent_get_upload_intents', { p_post_id: postId });
      if (error) return { intents: [], error: error.message };
      const intents = (data || []).map((row: {
        storage_path: string;
        kind: string;
        expected_size: number;
        expected_ext: string;
        consumed_at: string | null;
      }) => ({
        path: row.storage_path,
        kind: row.kind as 'video' | 'audio',
        expectedSize: Number(row.expected_size),
        expectedExt: row.expected_ext,
        consumedAt: row.consumed_at,
      }));
      return { intents, error: null };
    },
    async consumeIntents(postId, paths) {
      const { error } = await admin.rpc('parent_consume_upload_intents', {
        p_post_id: postId,
        p_paths: paths,
      });
      return { error: error?.message ?? null };
    },
    async listOrphanPaths(maxAgeMinutes) {
      const { data, error } = await admin.rpc('parent_list_orphan_upload_paths', {
        p_max_age_minutes: maxAgeMinutes,
      });
      if (error) return { paths: [], error: error.message };
      const paths = (data || []).map((r: { storage_path: string }) => r.storage_path);
      return { paths, error: null };
    },
    async deleteIntents(paths) {
      const { error } = await admin.rpc('parent_delete_upload_intents', { p_paths: paths });
      return { error: error?.message ?? null };
    },
    async createParentPost(input) {
      const { error } = await admin.rpc('create_parent_post', {
        p_post_id: input.postId,
        p_event_id: input.eventId,
        p_author_name: input.authorName,
        p_comment: input.comment,
        p_consent: true,
        p_images: input.media.map((m) => ({
          path: m.path,
          mime: m.mime,
          size: m.size,
          kind: m.kind,
        })),
        p_content_hash: input.contentHash,
      });
      if (!error) return { error: null };
      return { error: error.message, code: error.message };
    },
  };
}

function extFor(
  kind: 'video' | 'audio',
  name: string,
  type: string,
): string {
  const guess = (name.split('.').pop() || '').toLowerCase();
  if (kind === 'video') {
    if (['mp4', 'mov', 'webm'].includes(guess)) return guess;
    if (type.includes('quicktime')) return 'mov';
    if (type.includes('webm')) return 'webm';
    return 'mp4';
  }
  if (['mp3', 'm4a', 'aac', 'wav', 'ogg', 'webm'].includes(guess)) return guess;
  if (type.includes('webm')) return 'webm';
  if (type.includes('wav')) return 'wav';
  if (type.includes('ogg')) return 'ogg';
  if (type.includes('aac')) return 'aac';
  if (type.includes('mpeg')) return 'mp3';
  return 'm4a';
}

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

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: 'server_misconfigured', message: 'إعداد الخادم غير مكتمل' }, origin);
  }
  const salt = Deno.env.get('PARENT_SUBMIT_SALT') || serviceKey;
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const storage = makeStorage(admin, supabaseUrl, serviceKey);
  const db = makeDb(admin);
  const contentType = req.headers.get('content-type') ?? '';

  // -------- 1) تحضير رفع مباشر للفيديو/الصوت --------
  if (contentType.toLowerCase().includes('application/json')) {
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json(400, { error: 'bad_request', message: 'طلب غير صالح' }, origin);
    }
    if (body.action !== 'prepare') {
      return json(400, { error: 'bad_request', message: 'طلب غير صالح' }, origin);
    }
    const postId = crypto.randomUUID();
    const specs: { kind: 'video' | 'audio'; ext: string; size: number; mime: string }[] = [];
    for (const kind of ['video', 'audio'] as const) {
      const item = body[kind] as { size?: number; name?: string; type?: string } | null | undefined;
      if (!item) continue;
      const name = String(item.name || '');
      const type = String(item.type || '');
      specs.push({
        kind,
        ext: extFor(kind, name, type),
        size: Number(item.size) || 0,
        mime: type || (kind === 'video' ? 'video/mp4' : 'audio/mp4'),
      });
    }
    if (!specs.length) {
      return json(400, { error: 'empty_media', message: 'لا توجد مرفقات كبيرة للتحضير' }, origin);
    }
    const prepared = await prepareLargeUploads(storage, db, postId, specs);
    if ('error' in prepared) {
      return json(400, { error: prepared.error, message: prepared.message }, origin);
    }
    return json(200, { ok: true, post_id: postId, uploads: prepared.uploads }, origin);
  }

  // -------- 2) إنهاء الإرسال (صور + مسارات كبيرة) --------
  if (!contentType.toLowerCase().startsWith('multipart/form-data')) {
    return json(415, { error: 'bad_content_type', message: 'طلب غير صالح' }, origin);
  }

  const declared = Number(req.headers.get('content-length') ?? '0');
  if (declared > MULTIPART_LIMIT) {
    return json(413, {
      error: 'too_large',
      message: 'ارفع الفيديو والصوت عبر المسار المباشر، وأبقِ الصور ضمن الحد المسموح',
    }, origin);
  }

  const bodyBuf = await readBodyLimited(req, MULTIPART_LIMIT);
  if (!bodyBuf) {
    return json(413, {
      error: 'too_large',
      message: 'حجم الصور أكبر من المسموح؛ ارفع الفيديو/الصوت عبر المسار المباشر',
    }, origin);
  }

  let form: FormData;
  try {
    form = await new Response(bodyBuf, { headers: { 'content-type': contentType } }).formData();
  } catch {
    return json(400, { error: 'bad_request', message: 'طلب غير صالح' }, origin);
  }

  // ارفض ملفات فيديو/صوت داخل multipart (يجب Signed Upload)
  for (const key of ['video', 'audio'] as const) {
    const files = form.getAll(key).filter((v) => typeof v === 'object' && v !== null);
    if (files.length) {
      return json(413, {
        error: 'use_direct_upload',
        message: 'ارفع الفيديو أو الصوت عبر المسار المباشر ثم أكمل الإرسال',
      }, origin);
    }
  }

  const parsed = await parseSubmission(form);
  if (parsed.kind === 'honeypot') return json(200, { ok: true }, origin);
  if (parsed.kind === 'error') {
    return json(parsed.status, { error: parsed.error, message: parsed.message }, origin);
  }

  const postIdRaw = String(form.get('post_id') || '').trim();
  const postId = postIdRaw || crypto.randomUUID();
  const largeVideoPath = String(form.get('video_path') || '').trim() || null;
  const largeAudioPath = String(form.get('audio_path') || '').trim() || null;

  if (largeVideoPath && !largeVideoPath.startsWith(`posts/${postId}/`)) {
    return json(400, { error: 'invalid_media', message: 'مسار الفيديو غير صالح' }, origin);
  }
  if (largeAudioPath && !largeAudioPath.startsWith(`posts/${postId}/`)) {
    return json(400, { error: 'invalid_media', message: 'مسار الصوت غير صالح' }, origin);
  }
  if ((largeVideoPath || largeAudioPath) && !postIdRaw) {
    return json(400, { error: 'invalid_media', message: 'معرّف المشاركة مطلوب مع المرفقات الكبيرة' }, origin);
  }

  const imagesOnly = parsed.media.filter((m) => m.kind === 'image');
  const ipHash = await hashIp(clientIp(req.headers), salt);

  const result = await finalizeSubmission({
    storage,
    db,
    ipHash,
    eventId: parsed.eventId,
    authorName: parsed.authorName,
    comment: parsed.comment,
    postId,
    smallMedia: imagesOnly,
    largePaths: { video: largeVideoPath, audio: largeAudioPath },
  });

  if (!result.ok) {
    return json(result.status, { error: result.error, message: result.message }, origin);
  }
  return json(200, { ok: true }, origin);
});
