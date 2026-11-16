/**
 * submit-flow.ts — منطق الحفظ القابل للاختبار محليًا (بلا Deno.serve)
 * الفيديو/الصوت: Signed Upload + نية مسجّلة؛ التحقق من التخزين الفعلي قبل إنشاء المشاركة.
 */
import {
  MAX_AUDIO_BYTES,
  MAX_IMAGE_BYTES,
  MAX_VIDEO_BYTES,
  contentHash,
  sniffMedia,
  type MediaKind,
  type ValidMedia,
} from './validate.ts';

export const BUCKET = 'parents-eyes';
/** مهلة المرفقات المؤقتة غير المربوطة (لا تُمس الرفع الجاري الأحدث من ذلك) */
export const ORPHAN_MAX_AGE_MINUTES = 120;
/** هامش حجم مسموح فوق الحجم المُعلن في التحضير (بايت) — يمنع تجاوز حد التحضير */
export const SIZE_SLACK_BYTES = 0;

export type UploadedMedia = {
  path: string;
  mime: string;
  size: number;
  kind: MediaKind;
};

export type UploadIntent = {
  path: string;
  kind: 'video' | 'audio';
  expectedSize: number;
  expectedExt: string;
  consumedAt?: string | null;
};

export type StorageLike = {
  upload(path: string, data: Blob | ArrayBuffer, contentType: string): Promise<{ error: string | null }>;
  remove(paths: string[]): Promise<{ error: string | null }>;
  createSignedUpload(path: string): Promise<{ signedUrl: string; token: string; error: string | null }>;
  downloadPrefix(
    path: string,
    maxBytes: number,
  ): Promise<{ bytes: Uint8Array | null; size: number; exists: boolean; error: string | null }>;
  /** updated_at للكائن إن وُجد — لتجنّب حذف رفع جارٍ */
  objectUpdatedAt?(path: string): Promise<{ updatedAt: Date | null; exists: boolean }>;
};

export type DbLike = {
  throttle(ipHash: string): Promise<{ allowed: boolean; error: string | null }>;
  getEvent(eventId: string): Promise<{ id: string; is_open: boolean } | null | { error: string }>;
  postExists(postId: string): Promise<{ exists: boolean; error: string | null }>;
  registerIntents(postId: string, intents: UploadIntent[]): Promise<{ error: string | null }>;
  getIntents(postId: string): Promise<{ intents: UploadIntent[]; error: string | null }>;
  consumeIntents(postId: string, paths: string[]): Promise<{ error: string | null }>;
  listOrphanPaths(maxAgeMinutes: number): Promise<{ paths: string[]; error: string | null }>;
  deleteIntents(paths: string[]): Promise<{ error: string | null }>;
  createParentPost(input: {
    postId: string;
    eventId: string;
    authorName: string;
    comment: string | null;
    media: UploadedMedia[];
    contentHash: string;
  }): Promise<{ error: string | null; code?: string }>;
};

const maxFor = (kind: MediaKind) =>
  kind === 'image' ? MAX_IMAGE_BYTES : kind === 'video' ? MAX_VIDEO_BYTES : MAX_AUDIO_BYTES;

export function mediaPath(postId: string, ext: string) {
  return `posts/${postId}/${crypto.randomUUID()}.${ext}`;
}

export async function cleanupUploads(storage: StorageLike, paths: string[]) {
  if (!paths.length) return;
  await storage.remove(paths);
}

/**
 * تنظيف مؤقتات غير مربوطة أقدم من المهلة.
 * لا يحذف: نوايا حديثة، مرفقات في parent_post_images، ولا كائنًا عُدّل خلال 30 دقيقة (رفع جارٍ).
 */
export async function cleanupOrphanUploads(
  storage: StorageLike,
  db: DbLike,
  maxAgeMinutes = ORPHAN_MAX_AGE_MINUTES,
): Promise<{ removed: string[] }> {
  const listed = await db.listOrphanPaths(maxAgeMinutes);
  if (listed.error || !listed.paths.length) return { removed: [] };

  const toRemove: string[] = [];
  const freshCutoff = Date.now() - 30 * 60 * 1000;
  for (const path of listed.paths) {
    if (storage.objectUpdatedAt) {
      const meta = await storage.objectUpdatedAt(path);
      if (meta.exists && meta.updatedAt && meta.updatedAt.getTime() > freshCutoff) {
        continue; // رفع جارٍ أو اكتمل للتو
      }
    }
    toRemove.push(path);
  }
  if (!toRemove.length) return { removed: [] };
  await storage.remove(toRemove);
  await db.deleteIntents(toRemove);
  return { removed: toRemove };
}

/** تجهيز روابط رفع مباشرة + تسجيل النوايا في قاعدة البيانات */
export async function prepareLargeUploads(
  storage: StorageLike,
  db: DbLike,
  postId: string,
  specs: { kind: 'video' | 'audio'; ext: string; size: number; mime: string }[],
): Promise<
  | { uploads: { kind: string; path: string; signedUrl: string; token: string }[] }
  | { error: string; message: string }
> {
  // تنظيف انتهازي قبل إصدار روابط جديدة
  await cleanupOrphanUploads(storage, db);

  if (specs.length > 2) return { error: 'too_many_media', message: 'عدد المرفقات الكبيرة غير صالح' };
  const kinds = new Set<string>();
  const uploads: { kind: string; path: string; signedUrl: string; token: string }[] = [];
  const intents: UploadIntent[] = [];

  for (const spec of specs) {
    if (kinds.has(spec.kind)) {
      return {
        error: spec.kind === 'video' ? 'too_many_videos' : 'too_many_audios',
        message: spec.kind === 'video' ? 'الحد الأقصى فيديو واحد' : 'الحد الأقصى ملف صوتي واحد',
      };
    }
    kinds.add(spec.kind);
    if (spec.size <= 0) return { error: 'empty_media', message: 'أحد المرفقات فارغ' };
    if (spec.size > maxFor(spec.kind)) {
      return {
        error: spec.kind === 'video' ? 'video_too_large' : 'audio_too_large',
        message: spec.kind === 'video'
          ? 'حجم الفيديو يجب ألا يتجاوز 50 ميجابايت'
          : 'حجم الملف الصوتي يجب ألا يتجاوز 15 ميجابايت',
      };
    }
    const path = mediaPath(postId, spec.ext);
    const signed = await storage.createSignedUpload(path);
    if (signed.error || !signed.signedUrl) {
      return { error: 'server_error', message: 'تعذّر تجهيز رفع المرفق' };
    }
    uploads.push({ kind: spec.kind, path, signedUrl: signed.signedUrl, token: signed.token });
    intents.push({
      path,
      kind: spec.kind,
      expectedSize: spec.size,
      expectedExt: spec.ext,
    });
  }

  const reg = await db.registerIntents(postId, intents);
  if (reg.error) {
    return { error: 'server_error', message: 'تعذّر تجهيز رفع المرفق' };
  }
  return { uploads };
}

/** التحقق من الملف في التخزين + مطابقته لنية التحضير (لا بيانات المتصفح) */
export async function verifyUploadedLarge(
  storage: StorageLike,
  path: string,
  expect: 'video' | 'audio',
  intent?: UploadIntent | null,
): Promise<{ ok: true; media: UploadedMedia } | { ok: false; error: string; message: string }> {
  if (intent) {
    if (intent.path !== path) {
      return { ok: false, error: 'invalid_media', message: 'المرفق لا يطابق طلب التحضير' };
    }
    if (intent.kind !== expect) {
      return { ok: false, error: 'invalid_media', message: 'نوع المرفق لا يطابق طلب التحضير' };
    }
    if (intent.consumedAt) {
      return { ok: false, error: 'invalid_media', message: 'استُخدم طلب التحضير من قبل' };
    }
  }

  const pref = await storage.downloadPrefix(path, 64 * 1024);
  if (pref.error || !pref.exists || !pref.bytes) {
    return { ok: false, error: 'missing_upload', message: 'لم يُستلم أحد المرفقات الكبيرة، أعد المحاولة' };
  }
  if (pref.size <= 0) return { ok: false, error: 'empty_media', message: 'أحد المرفقات فارغ' };
  if (pref.size > maxFor(expect)) {
    await storage.remove([path]);
    return {
      ok: false,
      error: expect === 'video' ? 'video_too_large' : 'audio_too_large',
      message: expect === 'video'
        ? 'حجم الفيديو يجب ألا يتجاوز 50 ميجابايت'
        : 'حجم الملف الصوتي يجب ألا يتجاوز 15 ميجابايت',
    };
  }
  if (intent && pref.size > intent.expectedSize + SIZE_SLACK_BYTES) {
    await storage.remove([path]);
    return {
      ok: false,
      error: expect === 'video' ? 'video_too_large' : 'audio_too_large',
      message: 'حجم الملف المرفوع أكبر من الحجم المُعلن عند التحضير',
    };
  }

  const sniffed = sniffMedia(pref.bytes, expect);
  if (!sniffed || sniffed.kind !== expect) {
    await storage.remove([path]);
    return {
      ok: false,
      error: 'invalid_media',
      message: expect === 'video'
        ? 'نوع الفيديو غير مدعوم (MP4 أو MOV أو WEBM)'
        : 'نوع الملف الصوتي غير مدعوم',
    };
  }

  const pathExt = (path.split('.').pop() || '').toLowerCase();
  const okExt =
    (expect === 'video' && ['mp4', 'mov', 'webm'].includes(pathExt)) ||
    (expect === 'audio' && ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'webm'].includes(pathExt));
  if (!okExt) {
    await storage.remove([path]);
    return { ok: false, error: 'invalid_media', message: 'امتداد المرفق غير متوافق' };
  }
  if (intent && intent.expectedExt && intent.expectedExt !== pathExt) {
    await storage.remove([path]);
    return { ok: false, error: 'invalid_media', message: 'امتداد المرفق لا يطابق طلب التحضير' };
  }

  return {
    ok: true,
    media: { path, mime: sniffed.mime, size: pref.size, kind: sniffed.kind },
  };
}

export async function uploadSmallMedia(
  storage: StorageLike,
  postId: string,
  items: ValidMedia[],
): Promise<{ uploaded: UploadedMedia[] } | { error: string; message: string; uploaded: UploadedMedia[] }> {
  const uploaded: UploadedMedia[] = [];
  for (const item of items) {
    const path = mediaPath(postId, item.ext);
    const { error } = await storage.upload(path, item.bytes, item.mime);
    if (error) {
      return { error: 'server_error', message: 'تعذّر حفظ المرفقات', uploaded };
    }
    uploaded.push({ path, mime: item.mime, size: item.size, kind: item.kind });
  }
  return { uploaded };
}

export async function finalizeSubmission(opts: {
  storage: StorageLike;
  db: DbLike;
  ipHash: string;
  eventId: string;
  authorName: string;
  comment: string | null;
  postId: string;
  smallMedia: ValidMedia[];
  largePaths: { video?: string | null; audio?: string | null };
}): Promise<{ ok: true; idempotent?: boolean } | { ok: false; status: number; error: string; message: string }> {
  const { storage, db, ipHash, eventId, authorName, comment, postId, smallMedia, largePaths } = opts;

  // إعادة المحاولة بعد نجاح سابق: لا تُنشأ مشاركة مكررة ولا تُحذف مرفقات محفوظة
  const existing = await db.postExists(postId);
  if (existing.error) {
    return { ok: false, status: 500, error: 'server_error', message: 'تعذّر حفظ المشاركة، حاول لاحقاً' };
  }
  if (existing.exists) {
    return { ok: true, idempotent: true };
  }

  await cleanupOrphanUploads(storage, db);

  const pendingCleanup: string[] = [];
  /** مسارات كبيرة: تُنظَّف عند الفشل فقط إن لم تُربط بعد بمشاركة */
  const largeCleanup: string[] = [];

  const throttle = await db.throttle(ipHash);
  if (throttle.error) return { ok: false, status: 500, error: 'server_error', message: 'تعذّر حفظ المشاركة، حاول لاحقاً' };
  if (!throttle.allowed) {
    return {
      ok: false,
      status: 429,
      error: 'rate_limited',
      message: 'تم استلام عدة مشاركات من هذا الجهاز مؤخراً، حاول لاحقاً',
    };
  }

  const event = await db.getEvent(eventId);
  if (event && 'error' in event) {
    return { ok: false, status: 500, error: 'server_error', message: 'تعذّر حفظ المشاركة، حاول لاحقاً' };
  }
  if (!event?.is_open) {
    return { ok: false, status: 409, error: 'event_closed', message: 'هذه المناسبة لا تستقبل مشاركات حالياً' };
  }

  const needsLarge = !!(largePaths.video || largePaths.audio);
  let intents: UploadIntent[] = [];
  if (needsLarge) {
    const got = await db.getIntents(postId);
    if (got.error) {
      return { ok: false, status: 500, error: 'server_error', message: 'تعذّر التحقق من المرفقات' };
    }
    intents = got.intents.filter((i) => !i.consumedAt);
    if (!intents.length) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_media',
        message: 'انتهت صلاحية طلب التحضير أو لم يُعثر عليه، أعد رفع المرفقات الكبيرة',
      };
    }
  }

  const intentByKind = (kind: 'video' | 'audio') => intents.find((i) => i.kind === kind) || null;

  // ارفض مسارات لا تطابق نية التحضير لهذا post_id
  for (const kind of ['video', 'audio'] as const) {
    const path = largePaths[kind];
    if (!path) continue;
    const intent = intentByKind(kind);
    if (!intent || intent.path !== path) {
      return {
        ok: false,
        status: 400,
        error: 'invalid_media',
        message: 'المرفق الكبير لا يطابق طلب التحضير',
      };
    }
    if (!path.startsWith(`posts/${postId}/`)) {
      return { ok: false, status: 400, error: 'invalid_media', message: 'مسار المرفق غير صالح' };
    }
  }

  const media: UploadedMedia[] = [];

  // 1) تحقق المرفقات الكبيرة من التخزين أولًا — لا تُنشأ مشاركة قبل اكتمال التحقق
  if (largePaths.video) {
    largeCleanup.push(largePaths.video);
    const v = await verifyUploadedLarge(storage, largePaths.video, 'video', intentByKind('video'));
    if (!v.ok) {
      await cleanupUploads(storage, [...pendingCleanup, ...largeCleanup]);
      return { ok: false, status: 400, error: v.error, message: v.message };
    }
    media.push(v.media);
  }
  if (largePaths.audio) {
    largeCleanup.push(largePaths.audio);
    const a = await verifyUploadedLarge(storage, largePaths.audio, 'audio', intentByKind('audio'));
    if (!a.ok) {
      await cleanupUploads(storage, [...pendingCleanup, ...largeCleanup]);
      return { ok: false, status: 400, error: a.error, message: a.message };
    }
    media.push(a.media);
  }

  // 2) رفع الصور الصغيرة بعد نجاح التحقق من الكبير
  const small = await uploadSmallMedia(storage, postId, smallMedia);
  media.push(...small.uploaded);
  pendingCleanup.push(...small.uploaded.map((u) => u.path));
  if ('error' in small && small.error) {
    await cleanupUploads(storage, [...pendingCleanup, ...largeCleanup]);
    return { ok: false, status: 500, error: small.error, message: small.message };
  }

  if (!comment && !media.length) {
    await cleanupUploads(storage, [...pendingCleanup, ...largeCleanup]);
    return { ok: false, status: 400, error: 'empty_submission', message: 'أضف تعليقاً أو مرفقاً على الأقل' };
  }

  const hashParts: ValidMedia[] = [
    ...smallMedia,
    ...media
      .filter((m) => m.kind !== 'image')
      .map((m) => ({
        bytes: new TextEncoder().encode(`${m.kind}:${m.path}:${m.size}`).buffer as ArrayBuffer,
        mime: m.mime,
        ext: 'bin',
        size: m.size,
        kind: m.kind,
      })),
  ];
  const hash = await contentHash(eventId, comment, hashParts);

  const created = await db.createParentPost({
    postId,
    eventId,
    authorName,
    comment,
    media,
    contentHash: hash,
  });

  if (created.error) {
    // سباق إعادة محاولة: إن وُجدت المشاركة الآن عُدّ نجاحًا ولا تُحذف المرفقات
    const again = await db.postExists(postId);
    if (again.exists) {
      await db.consumeIntents(postId, largeCleanup);
      return { ok: true, idempotent: true };
    }
    await cleanupUploads(storage, [...pendingCleanup, ...largeCleanup]);
    if (created.code === 'duplicate_submission' || /duplicate_submission/.test(created.error)) {
      return {
        ok: false,
        status: 409,
        error: 'duplicate',
        message: 'وصلتنا هذه المشاركة من قبل، وهي بانتظار المراجعة',
      };
    }
    if (created.code === 'event_queue_full' || /event_queue_full/.test(created.error)) {
      return {
        ok: false,
        status: 429,
        error: 'queue_full',
        message: 'استقبال المشاركات لهذه المناسبة ممتلئ مؤقتاً، حاول لاحقاً',
      };
    }
    if (/غير مفتوحة/.test(created.error)) {
      return { ok: false, status: 409, error: 'event_closed', message: 'هذه المناسبة لا تستقبل مشاركات حالياً' };
    }
    return { ok: false, status: 500, error: 'server_error', message: 'تعذّر حفظ المشاركة، حاول لاحقاً' };
  }

  if (largeCleanup.length) {
    await db.consumeIntents(postId, largeCleanup);
  }
  return { ok: true };
}
