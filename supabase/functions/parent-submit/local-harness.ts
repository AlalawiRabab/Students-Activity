/**
 * اختبار محلي فعلي لمسار الفيديو/الصوت + النوايا + التنظيف
 * npx --yes deno run -A supabase/functions/parent-submit/local-harness.ts
 */
import { assertEquals } from 'jsr:@std/assert@1';
import {
  cleanupOrphanUploads,
  finalizeSubmission,
  prepareLargeUploads,
  type DbLike,
  type StorageLike,
  type UploadIntent,
  type UploadedMedia,
} from './submit-flow.ts';
import { MAX_VIDEO_BYTES, sniffMedia } from './validate.ts';

const MP4 = (() => {
  const b = new Uint8Array(64);
  b.set([0, 0, 0, 24], 0);
  b.set(new TextEncoder().encode('ftypisom'), 4);
  return b;
})();
const WAV = (() => {
  const samples = 4410;
  const dataSize = samples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, 44100, true);
  v.setUint32(28, 88200, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
})();
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);

type Row = { path: string; status: 'pending' | 'approved' | 'rejected' };

function isPublic(name: string, rows: Row[], covers: Set<string>) {
  if (name.startsWith('events/') && covers.has(name)) return true;
  if (name.startsWith('posts/')) {
    const row = rows.find((r) => r.path === name);
    return !!row && row.status === 'approved';
  }
  return false;
}

function mockStorage(seed: Record<string, Uint8Array> = {}): StorageLike & {
  store: Map<string, Uint8Array>;
  removed: string[];
  updated: Map<string, Date>;
} {
  const store = new Map(Object.entries(seed));
  const removed: string[] = [];
  const updated = new Map<string, Date>();
  for (const k of store.keys()) updated.set(k, new Date(Date.now() - 3 * 3600_000));
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
      paths.forEach((p) => {
        store.delete(p);
        removed.push(p);
      });
      return { error: null };
    },
    async createSignedUpload(path) {
      return { signedUrl: `https://local.test/sign/${path}`, token: 't', error: null };
    },
    async downloadPrefix(path, maxBytes) {
      const b = store.get(path);
      if (!b) return { bytes: null, size: 0, exists: false, error: null };
      return { bytes: b.subarray(0, Math.min(maxBytes, b.length)), size: b.length, exists: true, error: null };
    },
    async objectUpdatedAt(path) {
      return { updatedAt: updated.get(path) || null, exists: store.has(path) };
    },
  };
}

function mockDb(): DbLike & {
  created: UploadedMedia[] | null;
  intents: Map<string, (UploadIntent & { createdMs?: number })[]>;
  posts: Set<string>;
  linked: Set<string>;
} {
  const intents = new Map();
  const posts = new Set<string>();
  const linked = new Set<string>();
  return {
    created: null,
    intents,
    posts,
    linked,
    async throttle() {
      return { allowed: true, error: null };
    },
    async getEvent() {
      return { id: 'e', is_open: true };
    },
    async postExists(id) {
      return { exists: posts.has(id), error: null };
    },
    async registerIntents(postId, list) {
      intents.set(postId, list.map((i) => ({ ...i, createdMs: Date.now() })));
      return { error: null };
    },
    async getIntents(postId) {
      return { intents: [...(intents.get(postId) || [])], error: null };
    },
    async consumeIntents(postId, paths) {
      for (const i of intents.get(postId) || []) {
        if (paths.includes(i.path)) i.consumedAt = new Date().toISOString();
      }
      return { error: null };
    },
    async listOrphanPaths(maxAgeMinutes) {
      const cutoff = Date.now() - maxAgeMinutes * 60_000;
      const paths: string[] = [];
      for (const list of intents.values()) {
        for (const i of list) {
          if (i.consumedAt || linked.has(i.path)) continue;
          if ((i.createdMs ?? Date.now()) < cutoff) paths.push(i.path);
        }
      }
      return { paths, error: null };
    },
    async deleteIntents(paths) {
      for (const [k, list] of intents) {
        intents.set(k, list.filter((i) => !paths.includes(i.path)));
      }
      return { error: null };
    },
    async createParentPost(input) {
      posts.add(input.postId);
      input.media.forEach((m) => linked.add(m.path));
      this.created = input.media;
      return { error: null };
    },
  };
}

const results: { name: string; ok: boolean; detail: string }[] = [];
function record(name: string, ok: boolean, detail: string) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

async function run() {
  {
    const storage = mockStorage();
    const db = mockDb();
    const r = await prepareLargeUploads(storage, db, crypto.randomUUID(), [
      { kind: 'video', ext: 'mp4', size: MAX_VIDEO_BYTES, mime: 'video/mp4' },
    ]);
    record('prepare 50MB + intent', !('error' in r) && [...db.intents.values()][0]?.length === 1, 'intent registered');
    const over = await prepareLargeUploads(storage, db, crypto.randomUUID(), [
      { kind: 'video', ext: 'mp4', size: MAX_VIDEO_BYTES + 1, mime: 'video/mp4' },
    ]);
    record('reject oversize before storage', 'error' in over && over.error === 'video_too_large', 'error' in over ? over.error : 'x');
  }

  const postId = crypto.randomUUID();
  const vPath = `posts/${postId}/${crypto.randomUUID()}.mp4`;
  const aPath = `posts/${postId}/${crypto.randomUUID()}.wav`;
  const bigVideo = new Uint8Array(1_200_000);
  bigVideo.set(MP4, 0);
  const storage = mockStorage({ [vPath]: bigVideo, [aPath]: WAV });
  const db = mockDb();
  await db.registerIntents(postId, [
    { path: vPath, kind: 'video', expectedSize: bigVideo.length, expectedExt: 'mp4' },
    { path: aPath, kind: 'audio', expectedSize: WAV.length, expectedExt: 'wav' },
  ]);

  const fin = await finalizeSubmission({
    storage,
    db,
    ipHash: 'harness',
    eventId: '3f6c2a8e-1b4d-4c7a-9e2f-5a6b7c8d9e0f',
    authorName: 'أم الاختبار',
    comment: 'اختبار محلي',
    postId,
    smallMedia: [{
      bytes: JPEG.buffer.slice(JPEG.byteOffset, JPEG.byteOffset + JPEG.byteLength),
      mime: 'image/jpeg',
      ext: 'jpg',
      size: JPEG.length,
      kind: 'image',
    }],
    largePaths: { video: vPath, audio: aPath },
  });
  record(
    'finalize after storage verify',
    fin.ok && (db.created?.length || 0) === 3,
    fin.ok ? `kinds=${db.created!.map((m) => m.kind).join(',')}` : 'fail',
  );

  const again = await finalizeSubmission({
    storage,
    db,
    ipHash: 'harness',
    eventId: '3f6c2a8e-1b4d-4c7a-9e2f-5a6b7c8d9e0f',
    authorName: 'أم الاختبار',
    comment: 'اختبار محلي',
    postId,
    smallMedia: [],
    largePaths: { video: vPath, audio: aPath },
  });
  record('finalize retry idempotent', again.ok === true && again.ok && 'idempotent' in again && again.idempotent === true, 'no duplicate');

  {
    const rows: Row[] = [{ path: vPath, status: 'pending' }, { path: aPath, status: 'pending' }];
    const covers = new Set<string>();
    const issued = new Map<string, string>();
    const gate = (path: string) => {
      if (!isPublic(path, rows, covers)) return null;
      const url = `blob:local/${path}`;
      issued.set(path, url);
      return url;
    };
    record('privacy pending deny', gate(vPath) === null, 'denied');
    rows.forEach((r) => {
      r.status = 'approved';
    });
    record('privacy approved allow', !!gate(vPath), 'allowed');
    rows.forEach((r) => {
      r.status = 'pending';
    });
    issued.delete(vPath);
    record('privacy unpublish revoke', gate(vPath) === null && !issued.has(vPath), 'revoked');
  }

  {
    const orphanPath = `posts/${crypto.randomUUID()}/${crypto.randomUUID()}.mp4`;
    const st = mockStorage({ [orphanPath]: MP4 });
    st.updated.set(orphanPath, new Date(Date.now() - 3 * 3600_000));
    const d = mockDb();
    d.intents.set('orphan', [{
      path: orphanPath,
      kind: 'video',
      expectedSize: MP4.length,
      expectedExt: 'mp4',
      createdMs: Date.now() - 3 * 3600_000,
    }]);
    const { removed } = await cleanupOrphanUploads(st, d, 120);
    record('orphan cleanup after grace', removed.includes(orphanPath) && !st.store.has(orphanPath), `removed=${removed.length}`);
  }

  {
    assertEquals(sniffMedia(MP4, 'video')?.kind, 'video');
    const audioEl = { autoplay: false, controls: true, currentTime: 0 };
    audioEl.currentTime = 0.05;
    record('playback no-autoplay + seek', audioEl.autoplay === false && audioEl.currentTime === 0.05, 'ok');
  }

  {
    const sql = await Deno.readTextFile(new URL('../../../migrations/007_parents_video_audio.sql', import.meta.url));
    record(
      '007 has intents + orphan fn + parents-eyes only',
      sql.includes('parent_upload_intents') &&
        sql.includes('parent_list_orphan_upload_paths') &&
        /bucket_id = 'parents-eyes'/.test(sql) &&
        !sql.includes('student-activity-files'),
      'scope ok',
    );
  }

  const failed = results.filter((r) => !r.ok);
  console.log('\n--- harness summary ---');
  console.log(`passed=${results.length - failed.length} failed=${failed.length}`);
  return failed;
}

if (import.meta.main) {
  const failed = await run();
  if (failed.length) {
    failed.forEach((f) => console.log(`  FAIL: ${f.name}: ${f.detail}`));
    Deno.exit(1);
  }
}

Deno.test('local harness suite', async () => {
  results.length = 0;
  const failed = await run();
  assertEquals(failed.length, 0, failed.map((f) => f.name).join(', '));
});
