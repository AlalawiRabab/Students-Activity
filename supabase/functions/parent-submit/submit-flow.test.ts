/**
 * اختبارات مسار الرفع الكبير + النوايا + التنظيف + إعادة المحاولة
 */
import { assertEquals, assert } from 'jsr:@std/assert@1';
import {
  cleanupOrphanUploads,
  cleanupUploads,
  finalizeSubmission,
  prepareLargeUploads,
  verifyUploadedLarge,
  type DbLike,
  type StorageLike,
  type UploadIntent,
  type UploadedMedia,
} from './submit-flow.ts';
import { MAX_AUDIO_BYTES, MAX_VIDEO_BYTES } from './validate.ts';

const MP4 = (() => {
  const b = new Uint8Array(32);
  b.set([0, 0, 0, 24], 0);
  b.set(new TextEncoder().encode('ftypisom'), 4);
  return b;
})();
const WAV = new TextEncoder().encode('RIFF\u0000\u0000\u0000\u0000WAVEfmt ');
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const FAKE = new TextEncoder().encode('not-a-media-file-at-all!!!!');

function mockStorage(seed: Record<string, Uint8Array> = {}): StorageLike & {
  store: Map<string, Uint8Array>;
  removed: string[];
  updated: Map<string, Date>;
} {
  const store = new Map<string, Uint8Array>(Object.entries(seed));
  const removed: string[] = [];
  const updated = new Map<string, Date>();
  for (const k of store.keys()) updated.set(k, new Date(Date.now() - 3 * 60 * 60 * 1000));
  return {
    store,
    removed,
    updated,
    async upload(path, data) {
      const bytes = data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(await (data as Blob).arrayBuffer());
      store.set(path, bytes);
      updated.set(path, new Date());
      return { error: null };
    },
    async remove(paths) {
      for (const p of paths) {
        store.delete(p);
        removed.push(p);
        updated.delete(p);
      }
      return { error: null };
    },
    async createSignedUpload(path) {
      return { signedUrl: `https://example.test/upload/${path}`, token: 'tok', error: null };
    },
    async downloadPrefix(path, maxBytes) {
      const bytes = store.get(path);
      if (!bytes) return { bytes: null, size: 0, exists: false, error: null };
      return {
        bytes: bytes.subarray(0, Math.min(maxBytes, bytes.length)),
        size: bytes.length,
        exists: true,
        error: null,
      };
    },
    async objectUpdatedAt(path) {
      if (!store.has(path) && !updated.has(path)) return { updatedAt: null, exists: false };
      return { updatedAt: updated.get(path) || null, exists: store.has(path) };
    },
  };
}

function mockDb(opts: {
  open?: boolean;
  fail?: string;
  existingPosts?: Set<string>;
} = {}): DbLike & {
  created: UploadedMedia[] | null;
  intents: Map<string, UploadIntent[]>;
  linkedPaths: Set<string>;
} {
  const intents = new Map<string, UploadIntent[]>();
  const existingPosts = opts.existingPosts || new Set<string>();
  const linkedPaths = new Set<string>();
  return {
    created: null as UploadedMedia[] | null,
    intents,
    linkedPaths,
    async throttle() {
      return { allowed: true, error: null };
    },
    async getEvent() {
      return { id: 'e1', is_open: opts.open !== false };
    },
    async postExists(postId) {
      return { exists: existingPosts.has(postId), error: null };
    },
    async registerIntents(postId, list) {
      intents.set(postId, list.map((i) => ({ ...i })));
      return { error: null };
    },
    async getIntents(postId) {
      return { intents: (intents.get(postId) || []).map((i) => ({ ...i })), error: null };
    },
    async consumeIntents(postId, paths) {
      const list = intents.get(postId) || [];
      for (const i of list) {
        if (paths.includes(i.path)) i.consumedAt = new Date().toISOString();
      }
      return { error: null };
    },
    async listOrphanPaths(maxAgeMinutes) {
      const cutoff = Date.now() - maxAgeMinutes * 60 * 1000;
      const paths: string[] = [];
      for (const list of intents.values()) {
        for (const i of list) {
          if (i.consumedAt) continue;
          if (linkedPaths.has(i.path)) continue;
          // اختبارات تضع createdAt اختياريًا عبر خاصية إضافية
          const created = (i as UploadIntent & { createdMs?: number }).createdMs ?? Date.now();
          if (created < cutoff) paths.push(i.path);
        }
      }
      return { paths, error: null };
    },
    async deleteIntents(paths) {
      for (const [postId, list] of intents) {
        intents.set(
          postId,
          list.filter((i) => !paths.includes(i.path)),
        );
      }
      return { error: null };
    },
    async createParentPost(input) {
      if (opts.fail) return { error: opts.fail, code: opts.fail };
      existingPosts.add(input.postId);
      for (const m of input.media) linkedPaths.add(m.path);
      (this as { created: UploadedMedia[] | null }).created = input.media;
      return { error: null };
    },
  };
}

const jpegMedia = () => ({
  bytes: JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.byteLength),
  mime: 'image/jpeg',
  ext: 'jpg',
  size: JPEG.length,
  kind: 'image' as const,
});

Deno.test('prepareLargeUploads: يرفض فيديو أكبر من 50م.ب قبل الرفع', async () => {
  const storage = mockStorage();
  const db = mockDb();
  const r = await prepareLargeUploads(storage, db, crypto.randomUUID(), [
    { kind: 'video', ext: 'mp4', size: MAX_VIDEO_BYTES + 1, mime: 'video/mp4' },
  ]);
  assertEquals('error' in r && r.error, 'video_too_large');
});

Deno.test('prepareLargeUploads: يرفض صوت أكبر من 15م.ب', async () => {
  const storage = mockStorage();
  const db = mockDb();
  const r = await prepareLargeUploads(storage, db, crypto.randomUUID(), [
    { kind: 'audio', ext: 'wav', size: MAX_AUDIO_BYTES + 1, mime: 'audio/wav' },
  ]);
  assertEquals('error' in r && r.error, 'audio_too_large');
});

Deno.test('prepareLargeUploads: يسجّل نوايا ويصدر روابط', async () => {
  const storage = mockStorage();
  const db = mockDb();
  const postId = crypto.randomUUID();
  const r = await prepareLargeUploads(storage, db, postId, [
    { kind: 'video', ext: 'mp4', size: MAX_VIDEO_BYTES, mime: 'video/mp4' },
    { kind: 'audio', ext: 'wav', size: MAX_AUDIO_BYTES, mime: 'audio/wav' },
  ]);
  assert(!('error' in r));
  if ('uploads' in r) {
    assertEquals(r.uploads.length, 2);
    assertEquals(db.intents.get(postId)?.length, 2);
  }
});

Deno.test('verifyUploadedLarge: يرفض ملفًا أكبر من الحجم المُعلن في التحضير', async () => {
  const path = `posts/${crypto.randomUUID()}/${crypto.randomUUID()}.mp4`;
  const storage = mockStorage({ [path]: MP4 });
  const intent: UploadIntent = {
    path,
    kind: 'video',
    expectedSize: 4,
    expectedExt: 'mp4',
  };
  const r = await verifyUploadedLarge(storage, path, 'video', intent);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, 'video_too_large');
  assertEquals(storage.store.has(path), false);
});

Deno.test('verifyUploadedLarge: يرفض ملفًا متنكّرًا وينظّفه', async () => {
  const path = `posts/${crypto.randomUUID()}/${crypto.randomUUID()}.mp4`;
  const storage = mockStorage({ [path]: FAKE });
  const intent: UploadIntent = { path, kind: 'video', expectedSize: FAKE.length, expectedExt: 'mp4' };
  const r = await verifyUploadedLarge(storage, path, 'video', intent);
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, 'invalid_media');
  assertEquals(storage.store.has(path), false);
});

Deno.test('verifyUploadedLarge: يقبل MP4/WAV مع نية مطابقة', async () => {
  const vPath = `posts/${crypto.randomUUID()}/${crypto.randomUUID()}.mp4`;
  const aPath = `posts/${crypto.randomUUID()}/${crypto.randomUUID()}.wav`;
  const storage = mockStorage({ [vPath]: MP4, [aPath]: WAV });
  const v = await verifyUploadedLarge(storage, vPath, 'video', {
    path: vPath,
    kind: 'video',
    expectedSize: MP4.length,
    expectedExt: 'mp4',
  });
  const a = await verifyUploadedLarge(storage, aPath, 'audio', {
    path: aPath,
    kind: 'audio',
    expectedSize: WAV.length,
    expectedExt: 'wav',
  });
  assertEquals(v.ok, true);
  assertEquals(a.ok, true);
});

Deno.test('finalizeSubmission: نجاح مع تحقق النوايا من التخزين', async () => {
  const postId = crypto.randomUUID();
  const vPath = `posts/${postId}/${crypto.randomUUID()}.mp4`;
  const aPath = `posts/${postId}/${crypto.randomUUID()}.wav`;
  const storage = mockStorage({ [vPath]: MP4, [aPath]: WAV });
  const db = mockDb();
  await db.registerIntents(postId, [
    { path: vPath, kind: 'video', expectedSize: MP4.length, expectedExt: 'mp4' },
    { path: aPath, kind: 'audio', expectedSize: WAV.length, expectedExt: 'wav' },
  ]);
  const r = await finalizeSubmission({
    storage,
    db,
    ipHash: 'abc',
    eventId: '3f6c2a8e-1b4d-4c7a-9e2f-5a6b7c8d9e0f',
    authorName: 'أم سارة',
    comment: 'تجربة',
    postId,
    smallMedia: [jpegMedia()],
    largePaths: { video: vPath, audio: aPath },
  });
  assertEquals(r.ok, true);
  assertEquals(db.created?.map((m) => m.kind).sort().join(','), 'audio,image,video');
  assert(db.intents.get(postId)?.every((i) => !!i.consumedAt));
});

Deno.test('finalizeSubmission: يرفض مسارًا لا يطابق نية التحضير', async () => {
  const postId = crypto.randomUUID();
  const prepared = `posts/${postId}/${crypto.randomUUID()}.mp4`;
  const foreign = `posts/${postId}/${crypto.randomUUID()}.mp4`;
  const storage = mockStorage({ [foreign]: MP4 });
  const db = mockDb();
  await db.registerIntents(postId, [
    { path: prepared, kind: 'video', expectedSize: MP4.length, expectedExt: 'mp4' },
  ]);
  const r = await finalizeSubmission({
    storage,
    db,
    ipHash: 'abc',
    eventId: '3f6c2a8e-1b4d-4c7a-9e2f-5a6b7c8d9e0f',
    authorName: 'أم سارة',
    comment: 'x',
    postId,
    smallMedia: [],
    largePaths: { video: foreign, audio: null },
  });
  assertEquals(r.ok, false);
  if (!r.ok) assertEquals(r.error, 'invalid_media');
  assertEquals(db.created, null);
});

Deno.test('finalizeSubmission: إعادة المحاولة بعد النجاح idempotent دون حذف', async () => {
  const postId = crypto.randomUUID();
  const vPath = `posts/${postId}/${crypto.randomUUID()}.mp4`;
  const storage = mockStorage({ [vPath]: MP4 });
  const db = mockDb({ existingPosts: new Set([postId]) });
  db.linkedPaths.add(vPath);
  const r = await finalizeSubmission({
    storage,
    db,
    ipHash: 'abc',
    eventId: '3f6c2a8e-1b4d-4c7a-9e2f-5a6b7c8d9e0f',
    authorName: 'أم سارة',
    comment: 'x',
    postId,
    smallMedia: [],
    largePaths: { video: vPath, audio: null },
  });
  assertEquals(r.ok, true);
  if (r.ok) assertEquals(r.idempotent, true);
  assertEquals(storage.store.has(vPath), true);
  assertEquals(storage.removed.length, 0);
});

Deno.test('finalizeSubmission: عند فشل الحفظ تُنظَّف مرفقات هذه المحاولة فقط', async () => {
  const postId = crypto.randomUUID();
  const otherPath = `posts/${crypto.randomUUID()}/${crypto.randomUUID()}.mp4`;
  const vPath = `posts/${postId}/${crypto.randomUUID()}.mp4`;
  const storage = mockStorage({ [vPath]: MP4, [otherPath]: MP4 });
  const db = mockDb({ fail: 'server boom' });
  await db.registerIntents(postId, [
    { path: vPath, kind: 'video', expectedSize: MP4.length, expectedExt: 'mp4' },
  ]);
  const r = await finalizeSubmission({
    storage,
    db,
    ipHash: 'abc',
    eventId: '3f6c2a8e-1b4d-4c7a-9e2f-5a6b7c8d9e0f',
    authorName: 'أم سارة',
    comment: null,
    postId,
    smallMedia: [jpegMedia()],
    largePaths: { video: vPath, audio: null },
  });
  assertEquals(r.ok, false);
  assertEquals(storage.store.has(otherPath), true);
  assertEquals(storage.store.has(vPath), false);
});

Deno.test('cleanupOrphanUploads: يحذف القديم القديم فقط ويُبقي الحديث والمرتبط', async () => {
  const oldPath = `posts/${crypto.randomUUID()}/${crypto.randomUUID()}.mp4`;
  const freshPath = `posts/${crypto.randomUUID()}/${crypto.randomUUID()}.mp4`;
  const linkedPath = `posts/${crypto.randomUUID()}/${crypto.randomUUID()}.mp4`;
  const storage = mockStorage({ [oldPath]: MP4, [freshPath]: MP4, [linkedPath]: MP4 });
  storage.updated.set(oldPath, new Date(Date.now() - 3 * 60 * 60 * 1000));
  storage.updated.set(freshPath, new Date()); // رفع جارٍ
  const db = mockDb();
  const oldIntent = {
    path: oldPath,
    kind: 'video' as const,
    expectedSize: MP4.length,
    expectedExt: 'mp4',
    createdMs: Date.now() - 3 * 60 * 60 * 1000,
  };
  const freshIntent = {
    path: freshPath,
    kind: 'video' as const,
    expectedSize: MP4.length,
    expectedExt: 'mp4',
    createdMs: Date.now(),
  };
  const linkedIntent = {
    path: linkedPath,
    kind: 'video' as const,
    expectedSize: MP4.length,
    expectedExt: 'mp4',
    createdMs: Date.now() - 3 * 60 * 60 * 1000,
  };
  db.intents.set('a', [oldIntent]);
  db.intents.set('b', [freshIntent]);
  db.intents.set('c', [linkedIntent]);
  db.linkedPaths.add(linkedPath);

  const { removed } = await cleanupOrphanUploads(storage, db, 120);
  assert(removed.includes(oldPath));
  assert(!removed.includes(freshPath));
  assert(!removed.includes(linkedPath));
  assertEquals(storage.store.has(oldPath), false);
  assertEquals(storage.store.has(freshPath), true);
  assertEquals(storage.store.has(linkedPath), true);
});

Deno.test('cleanupUploads: لا يفعل شيئًا للقائمة الفارغة', async () => {
  const storage = mockStorage();
  await cleanupUploads(storage, []);
  assertEquals(storage.removed.length, 0);
});
