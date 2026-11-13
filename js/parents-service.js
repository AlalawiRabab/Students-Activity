/**
 * parents-service.js — بيانات «بعيون أهالينا» (migrations/004)
 * - القراءة العامة: مناسبات + مشاركات معتمدة وصورها فقط (RLS)، بأعمدة عامة محددة.
 * - الصور العامة تُنزَّل عبر التخزين بصلاحية الزائر في كل طلب (لا روابط دائمة)،
 *   فإلغاء النشر يوقف الوصول إليها فوراً.
 * - الإدارة (اعتماد/رفض/تعديل/حذف/المناسبات): RLS تحصرها في رائدة النشاط (is_editor).
 * - الإرسال العام يمر عبر Edge Function parent-submit فقط.
 */
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  PARENTS_BUCKET,
  PARENT_SUBMIT_FUNCTION,
  THUMB_URL_EXPIRES_IN,
} from './config.js';
import { getSupabase } from './supabase-client.js';
import { writeAudit } from './supabase-service.js';
import { removeStorageVerified } from './storage.js';
import { validateParentImage } from './validators.js';
import { logDev } from './utils.js';

export const STATUS_LABELS = Object.freeze({
  pending: 'بانتظار المراجعة',
  approved: 'منشورة',
  rejected: 'مرفوضة',
});

const EVENT_PUBLIC_COLS = 'id, title, description, cover_path, is_open, created_at';
const POST_PUBLIC_COLS =
  'id, event_id, author_name, comment, published_at, parent_post_images(id, storage_path, mime_type, sort_order)';
const POST_ADMIN_COLS =
  'id, event_id, author_name, comment, status, submitted_at, reviewed_at, published_at, parent_post_images(id, storage_path, mime_type, file_size, sort_order)';

function sortImages(post) {
  const imgs = [...(post.parent_post_images || [])].sort((a, b) => a.sort_order - b.sort_order);
  return { ...post, images: imgs };
}

function uuidV4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ---------------------------------------------------------------------
// قراءة عامة
// ---------------------------------------------------------------------
export async function listEvents({ openOnly = false } = {}) {
  let q = getSupabase().from('parent_events').select(EVENT_PUBLIC_COLS);
  if (openOnly) q = q.eq('is_open', true);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(500);
  if (error) throw error;
  return data || [];
}

export async function getEvent(id) {
  const { data, error } = await getSupabase()
    .from('parent_events')
    .select(EVENT_PUBLIC_COLS)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function listApprovedPosts(eventId) {
  const { data, error } = await getSupabase()
    .from('parent_posts')
    .select(POST_PUBLIC_COLS)
    .eq('event_id', eventId)
    .eq('status', 'approved')
    .order('published_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map(sortImages);
}

/** عدد المشاركات المنشورة لكل مناسبة */
export async function approvedCounts() {
  const { data, error } = await getSupabase()
    .from('parent_posts')
    .select('event_id')
    .eq('status', 'approved')
    .limit(5000);
  if (error) throw error;
  const map = {};
  (data || []).forEach((r) => {
    map[r.event_id] = (map[r.event_id] || 0) + 1;
  });
  return map;
}

const blobUrls = new Map();

/** صورة عامة عبر التخزين بصلاحية المستخدم الحالي (تخضع لسياسة pe_storage_public_read) */
export async function imageObjectUrl(path) {
  if (blobUrls.has(path)) return blobUrls.get(path);
  const p = (async () => {
    const { data, error } = await getSupabase().storage.from(PARENTS_BUCKET).download(path);
    if (error || !data) throw error || new Error('تعذّر تحميل الصورة');
    return URL.createObjectURL(data);
  })();
  blobUrls.set(path, p);
  try {
    return await p;
  } catch (err) {
    blobUrls.delete(path);
    throw err;
  }
}

export function forgetImage(path) {
  const p = blobUrls.get(path);
  blobUrls.delete(path);
  if (p) p.then((u) => URL.revokeObjectURL(u)).catch(() => {});
}

// ---------------------------------------------------------------------
// إرسال ولي الأمر (Edge Function)
// ---------------------------------------------------------------------
const SUBMIT_MESSAGES = {
  rate_limited: 'تم استلام عدة مشاركات من هذا الجهاز مؤخراً، حاول لاحقاً',
  event_closed: 'هذه المناسبة لا تستقبل مشاركات حالياً',
  too_large: 'حجم المرفقات أكبر من المسموح',
};

/**
 * @param {FormData} form
 * @returns {Promise<void>} يرمي Error برسالة عربية عند الرفض
 */
export async function submitParentPost(form) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/functions/v1/${PARENT_SUBMIT_FUNCTION}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: form,
    });
  } catch (err) {
    logDev(err);
    throw new Error('تعذّر الاتصال بالخادم، تحقق من الإنترنت وحاول مجدداً');
  }
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (!res.ok || !payload?.ok) {
    const code = payload?.error;
    throw new Error(SUBMIT_MESSAGES[code] || payload?.message || 'تعذّر إرسال المشاركة، حاول لاحقاً');
  }
}

// ---------------------------------------------------------------------
// إدارة (رائدة النشاط)
// ---------------------------------------------------------------------
export async function adminListPosts({ status, eventId = null }) {
  let q = getSupabase().from('parent_posts').select(POST_ADMIN_COLS).eq('status', status);
  if (eventId) q = q.eq('event_id', eventId);
  const order = status === 'approved' ? 'published_at' : 'submitted_at';
  const { data, error } = await q.order(order, { ascending: false }).limit(1000);
  if (error) throw error;
  return (data || []).map(sortImages);
}

/** { [event_id]: { pending, approved, rejected } } + الإجمالي */
export async function adminCounts() {
  const { data, error } = await getSupabase().from('parent_posts').select('event_id, status').limit(10000);
  if (error) throw error;
  const byEvent = {};
  const total = { pending: 0, approved: 0, rejected: 0 };
  (data || []).forEach((r) => {
    byEvent[r.event_id] = byEvent[r.event_id] || { pending: 0, approved: 0, rejected: 0 };
    byEvent[r.event_id][r.status] += 1;
    total[r.status] += 1;
  });
  return { byEvent, total };
}

export async function adminSignedUrls(paths) {
  if (!paths.length) return {};
  const { data, error } = await getSupabase()
    .storage.from(PARENTS_BUCKET)
    .createSignedUrls(paths, THUMB_URL_EXPIRES_IN);
  if (error) throw error;
  const out = {};
  (data || []).forEach((d) => {
    if (d?.signedUrl && d.path) out[d.path] = d.signedUrl;
  });
  return out;
}

export async function setPostStatus(post, status) {
  const { data, error } = await getSupabase()
    .from('parent_posts')
    .update({ status })
    .eq('id', post.id)
    .select(POST_ADMIN_COLS)
    .single();
  if (error) throw error;
  const action = { approved: 'approve', rejected: 'reject', pending: 'unpublish' }[status] || 'update';
  await writeAudit(action, 'parent_posts', post.id, { id: post.id });
  post.images.forEach((img) => forgetImage(img.storage_path));
  return sortImages(data);
}

export async function updatePostText(post, { authorName, comment }) {
  const { data, error } = await getSupabase()
    .from('parent_posts')
    .update({ author_name: authorName || null, comment: comment || null })
    .eq('id', post.id)
    .select(POST_ADMIN_COLS)
    .single();
  if (error) throw error;
  await writeAudit('update', 'parent_posts', post.id, { id: post.id });
  return sortImages(data);
}

const removeObjects = (paths) => removeStorageVerified(PARENTS_BUCKET, paths);

export async function deletePostImage(img) {
  await removeObjects([img.storage_path]);
  const { error } = await getSupabase().from('parent_post_images').delete().eq('id', img.id);
  if (error) throw error;
  forgetImage(img.storage_path);
  await writeAudit('delete_file', 'parent_post_images', img.id, { id: img.id });
}

/** حذف نهائي: الصور من التخزين أولاً ثم المشاركة (صفوف الصور تُحذف تبعاً) */
export async function deletePost(post) {
  await removeObjects(post.images.map((i) => i.storage_path));
  const { error } = await getSupabase().from('parent_posts').delete().eq('id', post.id);
  if (error) throw error;
  post.images.forEach((img) => forgetImage(img.storage_path));
  await writeAudit('delete', 'parent_posts', post.id, { id: post.id });
}

async function uploadCover(eventId, file) {
  const check = validateParentImage(file);
  if (!check.ok) throw new Error(check.error);
  const path = `events/${eventId}/${uuidV4()}.${check.ext}`;
  const body = file.type === check.mime ? file : new Blob([file], { type: check.mime });
  const { error } = await getSupabase().storage.from(PARENTS_BUCKET).upload(path, body, {
    upsert: false,
    contentType: check.mime,
    cacheControl: '3600',
  });
  if (error) {
    logDev(error);
    throw new Error('تعذّر رفع صورة الغلاف');
  }
  return path;
}

/**
 * @param {{ title: string, description?: string, isOpen: boolean, coverFile?: File|null }} input
 */
export async function createEvent({ title, description, isOpen, coverFile }) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('parent_events')
    .insert({ title, description: description || null, is_open: isOpen })
    .select(EVENT_PUBLIC_COLS)
    .single();
  if (error) throw error;
  await writeAudit('create', 'parent_events', data.id, { id: data.id });
  if (!coverFile) return data;
  const path = await uploadCover(data.id, coverFile);
  try {
    return await updateEvent(data, { cover_path: path });
  } catch (err) {
    await sb.storage.from(PARENTS_BUCKET).remove([path]);
    throw err;
  }
}

/** @param {object} event @param {object} patch title/description/is_open/cover_path */
export async function updateEvent(event, patch) {
  const { data, error } = await getSupabase()
    .from('parent_events')
    .update(patch)
    .eq('id', event.id)
    .select(EVENT_PUBLIC_COLS)
    .single();
  if (error) throw error;
  await writeAudit('update', 'parent_events', event.id, { id: event.id });
  return data;
}

/** استبدال الغلاف أو إزالته: الجديد يُرفع أولاً، والقديم يُحذف بعد نجاح التحديث */
export async function replaceCover(event, file) {
  const sb = getSupabase();
  const newPath = file ? await uploadCover(event.id, file) : null;
  let updated;
  try {
    updated = await updateEvent(event, { cover_path: newPath });
  } catch (err) {
    if (newPath) await sb.storage.from(PARENTS_BUCKET).remove([newPath]);
    throw err;
  }
  if (event.cover_path) {
    forgetImage(event.cover_path);
    const { error } = await sb.storage.from(PARENTS_BUCKET).remove([event.cover_path]);
    if (error) logDev('old cover', error);
  }
  return updated;
}

export async function deleteEvent(event) {
  const sb = getSupabase();
  const { count, error: cErr } = await sb
    .from('parent_posts')
    .select('id', { count: 'exact', head: true })
    .eq('event_id', event.id);
  if (cErr) throw cErr;
  if (count) {
    throw new Error('لا يمكن حذف مناسبة تحتوي مشاركات؛ احذفي مشاركاتها أولاً أو أغلقي الاستقبال');
  }
  if (event.cover_path) await removeObjects([event.cover_path]);
  const { error } = await sb.from('parent_events').delete().eq('id', event.id);
  if (error) throw error;
  await writeAudit('delete', 'parent_events', event.id, { id: event.id });
}
