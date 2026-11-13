/**
 * storage.js — رفع/حذف/Signed URLs لملفات خاصة
 */
import { STORAGE_BUCKET, SIGNED_URL_EXPIRES_IN } from './config.js';
import { getSupabase } from './supabase-client.js';
import { getFileExtension, mimeToFileType, logDev } from './utils.js';
import { validateFile } from './validators.js';

function buildSafeKey(userId, category, file) {
  const ext = getFileExtension(file.name) || 'bin';
  const uuid =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${userId}/${category}/${Date.now()}-${uuid}.${ext}`;
}

/**
 * رفع ملف ثم إرجاع بيانات المسار. عند فشل لاحق احذف عبر removeStorageObject.
 */
export async function uploadPrivateFile(file, category, mode = 'document') {
  const check = validateFile(file, mode);
  if (!check.ok) throw new Error(check.error);

  const sb = getSupabase();
  const {
    data: { user },
    error: userErr,
  } = await sb.auth.getUser();
  if (userErr || !user) throw new Error('يجب تسجيل الدخول لرفع الملفات');

  const path = buildSafeKey(user.id, category, file);
  const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type,
  });
  if (error) {
    logDev(error);
    throw new Error('تعذّر رفع الملف');
  }

  return {
    path,
    fileName: file.name,
    mimeType: file.type,
    fileSize: file.size,
    fileType: mimeToFileType(file.type),
  };
}

export async function removeStorageObject(path) {
  if (!path) return;
  const sb = getSupabase();
  const { error } = await sb.storage.from(STORAGE_BUCKET).remove([path]);
  if (error) {
    logDev('removeStorageObject', path, error);
    throw error;
  }
}

export async function removeStorageObjects(paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return { ok: true, failed: [] };
  const sb = getSupabase();
  const { error } = await sb.storage.from(STORAGE_BUCKET).remove(list);
  if (error) {
    logDev('removeStorageObjects', error);
    return { ok: false, failed: list, error };
  }
  return { ok: true, failed: [] };
}

/**
 * حذف كائنات مع التحقق: remove لا يُرجع خطأ لما رفضته السياسة أو لما لم يوجد أصلاً،
 * فيُتحقق من بقاء ما لم يُرجعه. يرمي خطأً إن بقي أي كائن.
 */
export async function removeStorageVerified(bucket, paths) {
  const list = (paths || []).filter(Boolean);
  if (!list.length) return;
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(bucket).remove(list);
  if (error) {
    logDev('removeStorageVerified', error);
    throw new Error('تعذّر حذف الملفات من التخزين، لم يُحذف شيء');
  }
  const removed = new Set((data || []).map((o) => o.name));
  for (const p of list.filter((x) => !removed.has(x))) {
    const i = p.lastIndexOf('/');
    const { data: found, error: listErr } = await sb.storage
      .from(bucket)
      .list(p.slice(0, i), { search: p.slice(i + 1), limit: 5 });
    if (listErr || (found || []).some((o) => o.name === p.slice(i + 1))) {
      throw new Error('تعذّر حذف بعض الملفات من التخزين، لم يُحذف شيء');
    }
  }
}

export async function createSignedUrl(path, expiresIn = SIGNED_URL_EXPIRES_IN) {
  if (!path) throw new Error('مسار الملف غير موجود');
  const sb = getSupabase();
  const { data, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    logDev(error);
    throw new Error('تعذّر إنشاء رابط المعاينة');
  }
  return data.signedUrl;
}

/**
 * نمط آمن: Storage أولاً ثم DB؛ عند فشل DB احذف الملف.
 */
export async function uploadThenInsert(file, category, mode, insertFn) {
  const uploaded = await uploadPrivateFile(file, category, mode);
  try {
    const row = await insertFn(uploaded);
    return row;
  } catch (err) {
    try {
      await removeStorageObject(uploaded.path);
    } catch (cleanupErr) {
      logDev('orphan cleanup failed', cleanupErr);
    }
    throw err;
  }
}
