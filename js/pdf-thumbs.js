/**
 * pdf-thumbs.js — صورة حقيقية للصفحة الأولى من ملفات PDF داخل البطاقات (PDF.js)
 * - تحميل كسول: لا يُطلب الملف إلا عند اقتراب البطاقة من الشاشة، وبحد أقصى طلبين متزامنين.
 * - تخزين مؤقت: الذاكرة + IndexedDB على الجهاز نفسه (يُمسح عند تسجيل الخروج).
 * - الملف الأصلي لا يُعدَّل ولا يُرفع شيء: الصورة تُولَّد في المتصفح بصلاحيات المستخدم الحالي،
 *   فالزائر لا يحصل على معاينة لملف لا يستطيع قراءته أصلاً.
 */
import { PDFJS_BASE, PDFJS_ASSETS } from './config.js';
import { createEl, logDev } from './utils.js';

const DB_NAME = 'sap-pdf-thumbs';
const STORE = 'thumbs';
const MAX_ENTRIES = 300;
const TARGET_WIDTH = 520;
const MAX_CONCURRENT = 2;

let libPromise = null;

function loadPdfjs() {
  if (!libPromise) {
    libPromise = import(`${PDFJS_BASE}pdf.min.mjs`)
      .then((lib) => {
        lib.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE}pdf.worker.min.mjs`;
        return lib;
      })
      .catch((err) => {
        libPromise = null;
        throw err;
      });
  }
  return libPromise;
}

// ---------------------------------------------------------------------
// IndexedDB
// ---------------------------------------------------------------------
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null);
      return;
    }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const store = req.result.createObjectStore(STORE, { keyPath: 'key' });
      store.createIndex('ts', 'ts');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
  return dbPromise;
}

function idb(mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve) => {
        if (!db) {
          resolve(null);
          return;
        }
        try {
          const tx = db.transaction(STORE, mode);
          const result = fn(tx.objectStore(STORE));
          tx.oncomplete = () => resolve(result?.result ?? null);
          tx.onerror = () => resolve(null);
          tx.onabort = () => resolve(null);
        } catch (err) {
          logDev('thumb cache', err);
          resolve(null);
        }
      })
  );
}

async function cacheGet(key) {
  const row = await idb('readonly', (s) => s.get(key));
  return row?.blob instanceof Blob ? row.blob : null;
}

async function cachePut(key, blob) {
  await idb('readwrite', (s) => s.put({ key, blob, ts: Date.now() }));
  const count = await idb('readonly', (s) => s.count());
  if (count > MAX_ENTRIES) {
    await idb('readwrite', (s) => {
      let extra = count - MAX_ENTRIES;
      const cur = s.index('ts').openCursor();
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || extra <= 0) return;
        c.delete();
        extra -= 1;
        c.continue();
      };
      return cur;
    });
  }
}

/** يُستدعى عند تسجيل الخروج حتى لا تبقى معاينات ملفات خاصة على الجهاز */
export async function clearPdfThumbCache() {
  memory.forEach((url) => URL.revokeObjectURL(url));
  memory.clear();
  const db = await dbPromise;
  if (db) db.close();
  dbPromise = null;
  await new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve();
      return;
    }
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
}

// ---------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------
const memory = new Map();
const failed = new Set();
const inflight = new Map();
let active = 0;
const waiting = [];

function schedule(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      active += 1;
      task()
        .then(resolve, reject)
        .finally(() => {
          active -= 1;
          const next = waiting.shift();
          if (next) next();
        });
    };
    if (active < MAX_CONCURRENT) run();
    else waiting.push(run);
  });
}

function canvasToBlob(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob(
      (webp) => {
        if (webp && webp.type === 'image/webp') {
          resolve(webp);
          return;
        }
        canvas.toBlob((jpeg) => resolve(jpeg), 'image/jpeg', 0.86);
      },
      'image/webp',
      0.86
    );
  });
}

async function renderFirstPage(url) {
  const lib = await loadPdfjs();
  const task = lib.getDocument({
    url,
    cMapUrl: `${PDFJS_ASSETS}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSETS}standard_fonts/`,
    isEvalSupported: false,
    enableXfa: false,
    disableAutoFetch: true,
    disableStream: true,
  });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(3, TARGET_WIDTH / Math.max(base.width, 1));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.floor(viewport.width));
    canvas.height = Math.max(1, Math.floor(viewport.height));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    page.cleanup();
    const blob = await canvasToBlob(canvas);
    canvas.width = 0;
    canvas.height = 0;
    if (!blob) throw new Error('thumbnail encode failed');
    return blob;
  } finally {
    await doc.destroy();
  }
}

/**
 * @param {{ key: string, getUrl: () => Promise<string> }} opts
 * @returns {Promise<string|null>} رابط blob: للصورة، أو null عند التعذّر
 */
export function getPdfThumb({ key, getUrl }) {
  if (memory.has(key)) return Promise.resolve(memory.get(key));
  if (failed.has(key)) return Promise.resolve(null);
  if (inflight.has(key)) return inflight.get(key);

  const p = (async () => {
    try {
      let blob = await cacheGet(key);
      if (!blob) {
        blob = await schedule(async () => renderFirstPage(await getUrl()));
        cachePut(key, blob).catch((err) => logDev('thumb cache put', err));
      }
      const url = URL.createObjectURL(blob);
      memory.set(key, url);
      return url;
    } catch (err) {
      logDev('pdf thumb', key, err);
      failed.add(key);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p;
}

// ---------------------------------------------------------------------
// Lazy attach
// ---------------------------------------------------------------------
const observed = new Map();
let observer = null;

function getObserver() {
  if (observer || typeof IntersectionObserver === 'undefined') return observer;
  observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const start = observed.get(entry.target);
        observer.unobserve(entry.target);
        observed.delete(entry.target);
        if (start) start();
      });
    },
    { rootMargin: '250px 0px' }
  );
  return observer;
}

function sweepDetached() {
  observed.forEach((_, el) => {
    if (!el.isConnected) {
      observer?.unobserve(el);
      observed.delete(el);
    }
  });
}

/**
 * يعرض صورة الصفحة الأولى داخل حاوية البطاقة عند ظهورها.
 * الأيقونة الحالية داخل الحاوية تبقى كبديل إن تعذّر توليد المعاينة.
 * @param {HTMLElement} thumb
 * @param {{ key: string, getUrl: () => Promise<string>, imgClass?: string }} opts
 */
export function attachPdfThumb(thumb, { key, getUrl, imgClass = 'pdf-thumb__img' }) {
  if (failed.has(key)) return;
  const loading = createEl('span', { className: 'pdf-thumb__loading', role: 'status' }, [
    createEl('span', { className: 'spinner spinner--dark', 'aria-hidden': 'true' }),
    createEl('span', { className: 'visually-hidden', textContent: 'جارٍ تحميل معاينة الملف' }),
  ]);

  const show = (url) => {
    const img = createEl('img', { className: imgClass, alt: '', decoding: 'async', src: url });
    img.addEventListener('load', () => {
      thumb.replaceChildren(img);
      thumb.classList.add('has-pdf-preview');
    });
    img.addEventListener('error', () => loading.remove());
  };

  const cached = memory.get(key);
  if (cached) {
    show(cached);
    return;
  }

  thumb.classList.add('pdf-thumb');
  thumb.appendChild(loading);
  const start = () => {
    getPdfThumb({ key, getUrl }).then((url) => {
      if (url && thumb.isConnected) show(url);
      else loading.remove();
    });
  };

  const obs = getObserver();
  if (!obs) {
    start();
    return;
  }
  sweepDetached();
  observed.set(thumb, start);
  obs.observe(thumb);
}
