/**
 * file-manager.js — نظام الملفات الموحّد لأقسام رائدة النشاط
 * التخزين: bucket خاص student-activity-files تحت sections/<section_key>/<scope>/<uuid>.<ext>
 * البيانات الوصفية: public.section_files (الاسم العربي الأصلي في original_name)
 */
import { STORAGE_BUCKET, SIGNED_URL_EXPIRES_IN, THUMB_URL_EXPIRES_IN } from './config.js';
import { getSupabase } from './supabase-client.js';
import { writeAudit } from './supabase-service.js';
import { validateSectionFile, validateLength } from './validators.js';
import {
  createEl,
  clearElement,
  formatBytes,
  formatDate,
  arabicIncludes,
  downloadBlob,
  logDev,
} from './utils.js';
import { openModal, confirmDialog, setButtonLoading, field, showToast, handleError } from './ui.js';
import { icon } from './icons.js';

export const FILE_ACCEPT =
  '.pdf,.doc,.docx,.xls,.xlsx,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/*,' +
  'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const FILE_COLUMNS =
  'id, section_key, sub_key, record_id, category, storage_path, original_name, mime_type, file_kind, file_size, title, description, created_at, updated_at';

const KIND_META = {
  pdf: { label: 'PDF', badge: 'PDF', icon: 'file' },
  image: { label: 'صورة', badge: 'IMG', icon: 'image' },
  word: { label: 'Word', badge: 'DOC', icon: 'file' },
  excel: { label: 'Excel', badge: 'XLS', icon: 'file' },
};

export const SORT_OPTIONS = Object.freeze([
  { key: 'newest', label: 'الأحدث أولاً' },
  { key: 'oldest', label: 'الأقدم أولاً' },
  { key: 'name', label: 'حسب الاسم' },
]);

export function kindLabel(kind) {
  return KIND_META[kind]?.label || 'ملف';
}

export function canPreviewInline(row) {
  return row?.file_kind === 'pdf' || row?.file_kind === 'image';
}

/** خطأ عدم وجود جداول/دوال migration 002 بعد */
export function isMissingSchemaError(err) {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  return (
    code === '42P01' ||
    code === 'PGRST205' ||
    code === 'PGRST202' ||
    code === '42883' ||
    /schema cache|does not exist|could not find the (table|function)/i.test(msg)
  );
}

export function renderSchemaNotice(container) {
  clearElement(container);
  container.appendChild(
    createEl('div', { className: 'notice notice--warn', role: 'status' }, [
      icon('info', { size: 22 }),
      createEl('div', {}, [
        createEl('strong', { textContent: 'قاعدة بيانات الأقسام غير مفعّلة بعد' }),
        createEl('p', {
          textContent:
            'يلزم تشغيل ملف الترحيل migrations/002_activity_sections.sql في Supabase SQL Editor مرة واحدة، ثم تحديث الصفحة.',
        }),
      ]),
    ])
  );
}

function uuidV4() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** مقطع النطاق في مفتاح التخزين: التبويب، أو general للملفات المباشرة */
function scopeSegment(subKey) {
  return subKey || 'general';
}

function defaultTitle(name) {
  return String(name || '').trim().slice(0, 200) || 'ملف';
}

export function sortFiles(rows, sortKey = 'newest') {
  const list = [...rows];
  if (sortKey === 'name') {
    list.sort((a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'ar'));
  } else {
    const dir = sortKey === 'oldest' ? 1 : -1;
    list.sort((a, b) => dir * (new Date(a.created_at) - new Date(b.created_at)));
  }
  return list;
}

// ---------------------------------------------------------------------
// Data API
// ---------------------------------------------------------------------

/**
 * ملفات القسم أو التبويب — الأحدث أولاً.
 * includeRecordFiles: يضم مرفقات سجلات activity_records القديمة (الأقسام 5–12) في القائمة نفسها.
 */
export async function listSectionFiles({ sectionKey, subKey = null, includeRecordFiles = false }) {
  const sb = getSupabase();
  let q = sb.from('section_files').select(FILE_COLUMNS).eq('section_key', sectionKey);
  q = subKey ? q.eq('sub_key', subKey) : q.is('sub_key', null);
  if (!includeRecordFiles) q = q.is('record_id', null);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(2000);
  if (error) throw error;
  return data || [];
}

/** عناوين السجلات القديمة (للإشارة إلى أصل المرفق فقط) — فشلها لا يمنع عرض الملفات */
export async function fetchLegacyRecordTitles(sectionKey) {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from('activity_records')
      .select('id, title')
      .eq('section_key', sectionKey)
      .limit(2000);
    if (error) throw error;
    return Object.fromEntries((data || []).map((r) => [r.id, r.title]));
  } catch (err) {
    logDev('legacy records', err);
    return {};
  }
}

/** عدد الملفات لكل section_key (يشمل التبويبين ومرفقات السجلات) */
export async function fetchSectionFileCounts() {
  const sb = getSupabase();
  const { data, error } = await sb.rpc('section_file_counts');
  if (error) throw error;
  const map = {};
  (data || []).forEach((r) => {
    map[r.section_key] = Number(r.file_count) || 0;
  });
  return map;
}

/**
 * رفع ملف مباشرة إلى القسم/التبويب: Storage أولاً ثم صف البيانات الوصفية؛
 * عند فشل الإدراج يُحذف الكائن المرفوع. العنوان = اسم الملف الأصلي.
 */
export async function uploadSectionFile({ file, sectionKey, subKey = null }) {
  const check = validateSectionFile(file);
  if (!check.ok) throw new Error(check.error);

  const sb = getSupabase();
  const path = `sections/${sectionKey}/${scopeSegment(subKey)}/${uuidV4()}.${check.ext}`;
  // storage-js يرسل File/Blob كـ multipart ويتجاهل contentType؛ نوع الجزء = blob.type.
  // بعض المتصفحات (Windows) تعطي docx/xlsx نوعاً فارغاً → يُرسل octet-stream ويرفضه الـ bucket.
  const body = file.type === check.mime ? file : new Blob([file], { type: check.mime });
  const { error: upErr } = await sb.storage.from(STORAGE_BUCKET).upload(path, body, {
    cacheControl: '3600',
    upsert: false,
    contentType: check.mime,
  });
  if (upErr) {
    logDev(upErr);
    throw new Error(`تعذّر رفع «${file.name}»`);
  }

  try {
    const { data, error } = await sb
      .from('section_files')
      .insert({
        section_key: sectionKey,
        sub_key: subKey,
        record_id: null,
        storage_path: path,
        original_name: String(file.name).slice(0, 255),
        mime_type: check.mime,
        file_kind: check.kind,
        file_size: file.size,
        title: defaultTitle(file.name),
      })
      .select(FILE_COLUMNS)
      .single();
    if (error) throw error;
    await writeAudit('upload_file', 'section_files', data.id, {
      id: data.id,
      file_name: data.original_name,
    });
    return data;
  } catch (err) {
    try {
      await sb.storage.from(STORAGE_BUCKET).remove([path]);
    } catch (cleanupErr) {
      logDev('orphan cleanup failed', cleanupErr);
    }
    throw err;
  }
}

/** إعادة تسمية العنوان المعروض فقط؛ مفتاح التخزين والاسم الأصلي لا يتغيران */
export async function renameSectionFile(id, title) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('section_files')
    .update({ title: String(title).trim().slice(0, 200) })
    .eq('id', id)
    .select(FILE_COLUMNS)
    .single();
  if (error) throw error;
  await writeAudit('update', 'section_files', id, { id });
  return data;
}

/**
 * هل ما زال الكائن موجوداً في Storage؟ (remove لا يُرجع خطأ لما رفضته RLS أو لما لم يوجد)
 * @returns {Promise<boolean|null>} null عند تعذّر التحقق
 */
async function objectStillExists(path) {
  const sb = getSupabase();
  const i = path.lastIndexOf('/');
  const { data, error } = await sb.storage
    .from(STORAGE_BUCKET)
    .list(path.slice(0, i), { search: path.slice(i + 1), limit: 10 });
  if (error) {
    logDev('verify remove', error);
    return null;
  }
  return (data || []).some((o) => o.name === path.slice(i + 1));
}

/**
 * الترتيب الآمن: حذف كائنات Storage أولاً ثم صفوف البيانات الوصفية لما تأكّد حذفه فقط.
 * لو فشل حذف الصف بعد حذف الكائن يبقى صف بلا ملف (ظاهر وقابل لإعادة الحذف)،
 * أما العكس فيترك كائناً يتيماً غير مرئي في التخزين.
 * @returns {Promise<{ deleted: object[] }>} يرمي خطأً عربياً إن تعذّر حذف أي ملف
 */
export async function deleteSectionFiles(rows) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return { deleted: [] };
  const sb = getSupabase();
  const paths = list.map((r) => r.storage_path);
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).remove(paths);
  if (error) {
    logDev(error);
    throw new Error('تعذّر حذف الملف من التخزين، لم يُحذف أي شيء');
  }

  const removed = new Set((data || []).map((o) => o.name));
  const confirmed = [];
  const failed = [];
  for (const r of list) {
    if (removed.has(r.storage_path)) {
      confirmed.push(r);
      continue;
    }
    const exists = await objectStillExists(r.storage_path);
    if (exists === false) confirmed.push(r);
    else failed.push(r);
  }

  if (confirmed.length) {
    const { error: dbErr } = await sb
      .from('section_files')
      .delete()
      .in('id', confirmed.map((r) => r.id));
    if (dbErr) throw dbErr;
    for (const r of confirmed) {
      await writeAudit('delete', 'section_files', r.id, { id: r.id, file_name: r.original_name });
    }
  }

  if (failed.length) {
    const err = new Error(
      failed.length === list.length
        ? 'تعذّر حذف الملف من التخزين، لم يُحذف أي شيء'
        : `تعذّر حذف ${failed.length} من ${list.length} ملفات من التخزين؛ بقيت كما هي`
    );
    err.deleted = confirmed;
    err.failed = failed;
    throw err;
  }
  return { deleted: confirmed };
}

const urlCache = new Map();

export async function getSignedUrl(path, expiresIn = SIGNED_URL_EXPIRES_IN) {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(STORAGE_BUCKET).createSignedUrl(path, expiresIn);
  if (error || !data?.signedUrl) {
    logDev(error);
    throw new Error('تعذّر إنشاء رابط الاستعراض');
  }
  return data.signedUrl;
}

/** روابط مصغّرات الصور دفعة واحدة مع تخزين مؤقت في الذاكرة فقط */
export async function getThumbUrls(paths) {
  const now = Date.now();
  const need = [...new Set(paths)].filter((p) => {
    const c = urlCache.get(p);
    return !c || c.exp < now + 30000;
  });
  if (need.length) {
    try {
      const sb = getSupabase();
      const { data, error } = await sb.storage
        .from(STORAGE_BUCKET)
        .createSignedUrls(need, THUMB_URL_EXPIRES_IN);
      if (error) throw error;
      (data || []).forEach((d) => {
        if (d?.signedUrl && d.path) {
          urlCache.set(d.path, { url: d.signedUrl, exp: now + THUMB_URL_EXPIRES_IN * 1000 });
        }
      });
    } catch (err) {
      logDev('thumbs', err);
    }
  }
  const out = {};
  paths.forEach((p) => {
    const c = urlCache.get(p);
    if (c) out[p] = c.url;
  });
  return out;
}

/** تنزيل الملف الأصلي باسمه العربي */
export async function downloadSectionFile(row) {
  const sb = getSupabase();
  try {
    const { data, error } = await sb.storage.from(STORAGE_BUCKET).download(row.storage_path);
    if (error || !data) throw error || new Error('download failed');
    downloadBlob(data, row.original_name || 'file');
  } catch (err) {
    logDev(err);
    const { data, error } = await sb.storage
      .from(STORAGE_BUCKET)
      .createSignedUrl(row.storage_path, SIGNED_URL_EXPIRES_IN, {
        download: row.original_name || true,
      });
    if (error || !data?.signedUrl) throw new Error('تعذّر تحميل الملف');
    const a = createEl('a', { href: data.signedUrl, rel: 'noopener' });
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

/** فتح الملف في تبويب جديد عبر Signed URL (نافذة تُفتح فوراً لتجنب حظر النوافذ) */
export async function openInNewTab(row) {
  const win = window.open('', '_blank');
  try {
    const url = await getSignedUrl(row.storage_path);
    if (win) {
      win.opener = null;
      win.location.href = url;
    } else {
      window.location.assign(url);
    }
  } catch (err) {
    if (win) win.close();
    throw err;
  }
}

// ---------------------------------------------------------------------
// UI: preview / edit / delete
// ---------------------------------------------------------------------

function kindTile(kind, size = 34) {
  const meta = KIND_META[kind] || KIND_META.pdf;
  return createEl('div', { className: `kind-tile kind-tile--${kind}` }, [
    icon(meta.icon, { size }),
    createEl('span', { className: 'kind-tile__badge', textContent: meta.badge }),
  ]);
}

/**
 * نافذة استعراض كبيرة: PDF عبر iframe، الصور عبر img، Word/Excel: تحميل/فتح فقط.
 * @param {object} row
 * @param {{ list?: object[] }} [opts] قائمة للتنقل بين الملفات
 */
export function openFilePreview(row, { list = null } = {}) {
  const items = list && list.length ? list : [row];
  let index = Math.max(0, items.findIndex((x) => x.id === row.id));

  const overlay = createEl('div', {
    className: 'preview-overlay',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'استعراض الملف',
  });
  const box = createEl('div', { className: 'preview-box' });
  const head = createEl('div', { className: 'preview-head' });
  const titles = createEl('div', { className: 'preview-head__titles' });
  const actions = createEl('div', { className: 'preview-head__actions' });
  const stage = createEl('div', { className: 'preview-stage' });
  head.append(titles, actions);
  box.append(head, stage);
  overlay.appendChild(box);

  const btn = (label, iconName, onClick, cls = 'btn btn--ghost btn--sm') => {
    const b = createEl('button', { type: 'button', className: cls }, [
      icon(iconName, { size: 18 }),
      createEl('span', { className: 'btn__label', textContent: label }),
    ]);
    b.addEventListener('click', onClick);
    return b;
  };

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const go = (delta) => {
    if (items.length < 2) return;
    index = (index + delta + items.length) % items.length;
    render();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowLeft') go(1);
    else if (e.key === 'ArrowRight') go(-1);
  };

  async function render() {
    const cur = items[index];
    clearElement(titles);
    clearElement(actions);
    clearElement(stage);
    titles.append(
      createEl('strong', { textContent: cur.title || cur.original_name }),
      createEl('span', {
        className: 'muted',
        dir: 'auto',
        textContent: `${cur.original_name} · ${kindLabel(cur.file_kind)}${
          cur.file_size ? ` · ${formatBytes(cur.file_size)}` : ''
        }${items.length > 1 ? ` · ${index + 1} / ${items.length}` : ''}`,
      })
    );
    if (items.length > 1) {
      actions.append(
        btn('السابق', 'chevronRight', () => go(-1)),
        btn('التالي', 'chevronLeft', () => go(1))
      );
    }
    actions.append(
      btn('تحميل', 'download', async () => {
        try {
          await downloadSectionFile(cur);
        } catch (err) {
          handleError(err);
        }
      }),
      btn('تبويب جديد', 'external', async () => {
        try {
          await openInNewTab(cur);
        } catch (err) {
          handleError(err);
        }
      }),
      btn('إغلاق', 'close', close, 'btn btn--primary btn--sm')
    );

    if (!canPreviewInline(cur)) {
      stage.appendChild(
        createEl('div', { className: 'preview-nopreview' }, [
          kindTile(cur.file_kind, 48),
          createEl('h3', { textContent: `ملفات ${kindLabel(cur.file_kind)} لا تُعرض داخل المنصة` }),
          createEl('p', {
            className: 'muted',
            textContent: 'يمكنك تحميل الملف الأصلي أو فتحه في تبويب جديد عبر رابط آمن مؤقت.',
          }),
          createEl('div', { className: 'row-actions row-actions--center' }, [
            btn('تحميل الملف', 'download', async () => {
              try {
                await downloadSectionFile(cur);
              } catch (err) {
                handleError(err);
              }
            }, 'btn btn--primary'),
            btn('فتح في تبويب جديد', 'external', async () => {
              try {
                await openInNewTab(cur);
              } catch (err) {
                handleError(err);
              }
            }, 'btn btn--ghost'),
          ]),
        ])
      );
      return;
    }

    stage.appendChild(
      createEl('div', { className: 'preview-loading' }, [
        createEl('span', { className: 'spinner spinner--dark', 'aria-hidden': 'true' }),
        createEl('span', { textContent: 'جارٍ تحميل المعاينة...' }),
      ])
    );
    try {
      const url = await getSignedUrl(cur.storage_path);
      if (items[index] !== cur || !overlay.isConnected) return;
      clearElement(stage);
      if (cur.file_kind === 'image') {
        stage.appendChild(
          createEl('img', { className: 'preview-image', src: url, alt: cur.title || cur.original_name })
        );
      } else {
        stage.appendChild(
          createEl('iframe', {
            className: 'preview-pdf',
            src: url,
            title: cur.title || cur.original_name,
          })
        );
      }
    } catch (err) {
      clearElement(stage);
      stage.appendChild(
        createEl('div', { className: 'preview-nopreview' }, [
          createEl('p', { textContent: 'تعذّر تحميل المعاينة. حاولي مرة أخرى أو حمّلي الملف.' }),
        ])
      );
      handleError(err);
    }
  }

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
  render();
  return { close };
}

/** إعادة تسمية العنوان المعروض فقط */
export function openRenameDialog(row, { onSaved } = {}) {
  const form = createEl('form', { className: 'form-grid' });
  const titleInput = createEl('input', {
    className: 'input',
    value: row.title || row.original_name || '',
    maxlength: '200',
    'aria-label': 'الاسم المعروض',
  });
  form.append(
    field('الاسم المعروض', titleInput, `الملف الأصلي: ${row.original_name}`),
  );
  const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: 'حفظ الاسم' });
  form.appendChild(createEl('div', { className: 'modal__actions' }, [saveBtn]));
  const { close } = openModal({ title: 'إعادة تسمية الملف', contentNode: form });
  titleInput.focus();
  titleInput.select();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = validateLength(titleInput.value, 'الاسم', 1, 200);
    if (err) {
      showToast(err, 'error');
      return;
    }
    setButtonLoading(saveBtn, true);
    try {
      const updated = await renameSectionFile(row.id, titleInput.value);
      showToast('تمت إعادة التسمية', 'success');
      close();
      if (typeof onSaved === 'function') onSaved(updated);
    } catch (error) {
      handleError(error);
    } finally {
      setButtonLoading(saveBtn, false);
    }
  });
}

/** تأكيد صريح يعرض اسم الملف قبل الحذف */
export async function confirmDeleteFile(row) {
  const name = row.title && row.title !== row.original_name
    ? `«${row.title}» (${row.original_name})`
    : `«${row.original_name}»`;
  return confirmDialog({
    title: 'حذف الملف نهائياً',
    message: `سيتم حذف الملف ${name} من التخزين نهائياً ولا يمكن التراجع. هل تريدين المتابعة؟`,
    confirmText: 'نعم، احذف الملف',
    cancelText: 'تراجع',
    danger: true,
  });
}

// ---------------------------------------------------------------------
// UI: مكتبة ملفات القسم (رفع مباشر بلا نماذج)
// ---------------------------------------------------------------------

/**
 * @param {{
 *   ctx: object,
 *   container: HTMLElement,
 *   sectionKey: string,
 *   subKey?: string|null,
 *   includeRecordFiles?: boolean,
 *   uploadLabel?: string,
 *   emptyText?: string,
 *   onChange?: (rows: object[]) => void,
 * }} opts
 */
export function createFileManager(opts) {
  const {
    ctx,
    container,
    sectionKey,
    subKey = null,
    includeRecordFiles = false,
    uploadLabel = 'رفع ملف جديد',
    emptyText = 'لا توجد ملفات بعد',
    onChange,
  } = opts;
  let rows = [];
  let loaded = false;
  let sortKey = 'newest';
  let recordTitles = {};
  /** @type {{ key: string, name: string, kind: string }[]} */
  let pending = [];

  const root = createEl('div', { className: 'file-manager' });
  const bar = createEl('div', { className: 'fm-toolbar no-print' });
  const searchWrap = createEl('label', { className: 'search-box' });
  const searchInput = createEl('input', {
    type: 'search',
    className: 'input',
    placeholder: 'ابحثي باسم الملف...',
    'aria-label': 'بحث في الملفات',
  });
  searchWrap.append(icon('search', { size: 18 }), searchInput);
  const sortSel = createEl(
    'select',
    { className: 'select fm-sort', 'aria-label': 'ترتيب الملفات' },
    SORT_OPTIONS.map((o) => createEl('option', { value: o.key, textContent: o.label }))
  );
  const countEl = createEl('span', { className: 'fm-count muted' });
  bar.append(searchWrap, sortSel, countEl);

  const picker = createEl('input', {
    type: 'file',
    multiple: true,
    accept: FILE_ACCEPT,
    className: 'visually-hidden fm-picker',
    tabindex: '-1',
    'aria-hidden': 'true',
  });
  root.appendChild(picker);
  picker.addEventListener('change', () => {
    const files = [...(picker.files || [])];
    picker.value = '';
    uploadFiles(files);
  });

  if (ctx.canEdit) {
    const upBtn = createEl('button', { type: 'button', className: 'btn btn--primary btn--upload' }, [
      icon('upload', { size: 18 }),
      createEl('span', { textContent: uploadLabel }),
    ]);
    upBtn.addEventListener('click', () => picker.click());
    bar.appendChild(upBtn);
  }

  const hint = ctx.canEdit
    ? createEl('p', {
        className: 'fm-hint muted no-print',
        textContent: 'PDF، Word، Excel، صور (JPG / PNG / WEBP / GIF) — حتى 10 م.ب للملف. يمكن اختيار عدة ملفات أو سحبها إلى هنا.',
      })
    : null;
  const grid = createEl('div', { className: 'file-grid', 'aria-live': 'polite' });
  root.append(bar);
  if (hint) root.appendChild(hint);
  root.appendChild(grid);
  container.appendChild(root);

  if (ctx.canEdit) {
    root.addEventListener('dragover', (e) => {
      if (e.dataTransfer?.types?.includes('Files')) {
        e.preventDefault();
        root.classList.add('is-drag');
      }
    });
    root.addEventListener('dragleave', (e) => {
      if (!root.contains(e.relatedTarget)) root.classList.remove('is-drag');
    });
    root.addEventListener('drop', (e) => {
      if (!e.dataTransfer?.files?.length) return;
      e.preventDefault();
      root.classList.remove('is-drag');
      uploadFiles([...e.dataTransfer.files]);
    });
  }

  searchInput.addEventListener('input', () => render());
  sortSel.addEventListener('change', () => {
    sortKey = sortSel.value;
    render();
  });

  async function uploadFiles(files) {
    if (!ctx.canEdit || !files.length) return;
    const valid = [];
    for (const file of files) {
      const check = validateSectionFile(file);
      if (check.ok) valid.push({ file, kind: check.kind });
      else showToast(check.error, 'error');
    }
    if (!valid.length) return;

    const items = valid.map((v, i) => ({ key: `p-${Date.now()}-${i}`, name: v.file.name, kind: v.kind, file: v.file }));
    pending = [...items, ...pending];
    render();

    let ok = 0;
    for (const it of items) {
      try {
        const row = await uploadSectionFile({ file: it.file, sectionKey, subKey });
        rows = [row, ...rows];
        ok += 1;
      } catch (err) {
        handleError(err, `تعذّر رفع «${it.name}»`);
      } finally {
        pending = pending.filter((p) => p.key !== it.key);
        render();
      }
    }
    if (ok) {
      showToast(ok === 1 ? 'تم رفع الملف بنجاح' : `تم رفع ${ok} ملفات بنجاح`, 'success');
      notify();
    }
  }

  function notify() {
    if (typeof onChange === 'function') onChange(rows);
  }

  function visibleRows() {
    const q = searchInput.value.trim();
    const filtered = rows.filter(
      (r) => !q || arabicIncludes(r.title, q) || arabicIncludes(r.original_name, q)
    );
    return sortFiles(filtered, sortKey);
  }

  function renderSkeletons() {
    clearElement(grid);
    for (let i = 0; i < 3; i += 1) {
      grid.appendChild(createEl('div', { className: 'file-card file-card--skeleton skeleton' }));
    }
  }

  function renderEmptyState(filtered) {
    const box = createEl('div', { className: 'fm-empty' }, [
      createEl('div', { className: 'fm-empty__icon' }, [icon(filtered ? 'search' : 'folder', { size: 34 })]),
      createEl('strong', { textContent: filtered ? 'لا توجد ملفات مطابقة للبحث' : emptyText }),
    ]);
    if (!filtered && ctx.canEdit) {
      box.appendChild(
        createEl('span', { className: 'muted', textContent: 'اضغطي «رفع ملف» أو اسحبي الملفات إلى هنا' })
      );
      const b = createEl('button', { type: 'button', className: 'btn btn--primary' }, [
        icon('upload', { size: 18 }),
        createEl('span', { textContent: uploadLabel }),
      ]);
      b.addEventListener('click', () => picker.click());
      box.appendChild(b);
    }
    return box;
  }

  function buildPendingCard(p) {
    return createEl('article', { className: 'file-card file-card--pending', 'aria-busy': 'true' }, [
      createEl('div', { className: `file-card__thumb file-card__thumb--${p.kind}` }, [
        createEl('span', { className: 'spinner spinner--dark', 'aria-hidden': 'true' }),
      ]),
      createEl('div', { className: 'file-card__body' }, [
        createEl('h4', { className: 'file-card__title', dir: 'auto', textContent: p.name }),
        createEl('span', { className: 'file-card__name', textContent: 'جارٍ الرفع...' }),
      ]),
    ]);
  }

  function buildCard(row, list) {
    const card = createEl('article', { className: 'file-card', dataset: { fileId: row.id } });
    const thumb = createEl('button', {
      type: 'button',
      className: `file-card__thumb file-card__thumb--${row.file_kind}`,
      'aria-label': `استعراض ${row.title}`,
    });
    if (row.file_kind === 'image') {
      const img = createEl('img', { alt: '', decoding: 'async', className: 'file-card__img' });
      thumb.appendChild(kindTile('image', 30));
      getThumbUrls([row.storage_path]).then((m) => {
        const url = m[row.storage_path];
        if (!url) return;
        img.src = url;
        img.addEventListener('load', () => {
          clearElement(thumb);
          thumb.appendChild(img);
        });
      });
    } else {
      thumb.appendChild(kindTile(row.file_kind, 34));
    }
    thumb.addEventListener('click', () => openFilePreview(row, { list }));

    const legacyTitle = row.record_id ? recordTitles[row.record_id] : null;
    const body = createEl('div', { className: 'file-card__body' }, [
      createEl('h4', { className: 'file-card__title', dir: 'auto', textContent: row.title }),
      row.title !== row.original_name
        ? createEl('span', {
            className: 'file-card__name',
            dir: 'auto',
            title: row.original_name,
            textContent: row.original_name,
          })
        : null,
      createEl('div', { className: 'file-card__meta' }, [
        createEl('span', { className: `chip chip--${row.file_kind}`, textContent: kindLabel(row.file_kind) }),
        createEl('span', { textContent: formatBytes(row.file_size) }),
        createEl('span', { textContent: formatDate(row.created_at) }),
      ]),
      row.record_id
        ? createEl('span', {
            className: 'chip chip--legacy',
            title: 'مرفق من سجل سابق',
            textContent: legacyTitle ? `مرفق سابق: ${legacyTitle}` : 'مرفق سابق',
          })
        : null,
    ]);

    const actions = createEl('div', { className: 'file-card__actions' });
    const act = (label, iconName, onClick, cls = '') => {
      const b = createEl('button', { type: 'button', className: `fc-btn ${cls}`, title: label }, [
        icon(iconName, { size: 16 }),
        createEl('span', { textContent: label }),
      ]);
      b.addEventListener('click', onClick);
      return b;
    };
    actions.append(
      act('استعراض', 'eye', () => openFilePreview(row, { list })),
      act('تحميل', 'download', async (e) => {
        const b = e.currentTarget;
        b.disabled = true;
        try {
          await downloadSectionFile(row);
        } catch (err) {
          handleError(err);
        } finally {
          b.disabled = false;
        }
      })
    );
    if (ctx.canEdit) {
      actions.append(
        act('إعادة تسمية', 'edit', () =>
          openRenameDialog(row, {
            onSaved: (updated) => {
              rows = rows.map((r) => (r.id === updated.id ? updated : r));
              render();
              notify();
            },
          })
        ),
        act(
          'حذف',
          'trash',
          async (e) => {
            const b = e.currentTarget;
            const ok = await confirmDeleteFile(row);
            if (!ok) return;
            b.disabled = true;
            try {
              await deleteSectionFiles([row]);
              rows = rows.filter((r) => r.id !== row.id);
              showToast('تم حذف الملف', 'success');
              render();
              notify();
            } catch (err) {
              b.disabled = false;
              handleError(err);
            }
          },
          'fc-btn--danger'
        )
      );
    }
    card.append(thumb, body, actions);
    return card;
  }

  function render() {
    if (!loaded) return;
    const list = visibleRows();
    const filtered = Boolean(searchInput.value.trim());
    countEl.textContent = filtered ? `${list.length} من ${rows.length} ملف` : `${rows.length} ملف`;
    clearElement(grid);
    pending.forEach((p) => grid.appendChild(buildPendingCard(p)));
    if (!list.length) {
      if (!pending.length) grid.appendChild(renderEmptyState(filtered));
      return;
    }
    const previewable = list.filter(canPreviewInline);
    list.forEach((r) => {
      grid.appendChild(buildCard(r, canPreviewInline(r) ? previewable : [r]));
    });
  }

  async function reload() {
    renderSkeletons();
    countEl.textContent = '';
    try {
      const [list, titles] = await Promise.all([
        listSectionFiles({ sectionKey, subKey, includeRecordFiles }),
        includeRecordFiles ? fetchLegacyRecordTitles(sectionKey) : Promise.resolve({}),
      ]);
      rows = list;
      recordTitles = titles;
      loaded = true;
      render();
      notify();
    } catch (err) {
      loaded = false;
      if (isMissingSchemaError(err)) {
        renderSchemaNotice(grid);
      } else {
        clearElement(grid);
        grid.appendChild(
          createEl('div', { className: 'fm-empty' }, [
            createEl('strong', { textContent: 'تعذّر تحميل الملفات' }),
          ])
        );
        handleError(err, 'تعذّر تحميل الملفات');
      }
    }
  }

  reload();
  return { reload, getRows: () => rows, root, upload: uploadFiles };
}
