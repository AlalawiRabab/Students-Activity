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

function scopeSegment({ subKey, recordId }) {
  return subKey || recordId || 'general';
}

function baseName(name) {
  const s = String(name || '').trim();
  const i = s.lastIndexOf('.');
  return (i > 0 ? s.slice(0, i) : s).slice(0, 200) || 'ملف';
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

/** ملفات نطاق محدد (قسم / تبويب / سجل) — الأحدث أولاً */
export async function listSectionFiles({ sectionKey, subKey = null, recordId = null }) {
  const sb = getSupabase();
  let q = sb.from('section_files').select(FILE_COLUMNS).eq('section_key', sectionKey);
  q = subKey ? q.eq('sub_key', subKey) : q.is('sub_key', null);
  q = recordId ? q.eq('record_id', recordId) : q.is('record_id', null);
  const { data, error } = await q.order('created_at', { ascending: false }).limit(1000);
  if (error) throw error;
  return data || [];
}

/** كل ملفات القسم (لسجلات القسم: العدد والغلاف والبحث) */
export async function listAllSectionFiles(sectionKey) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('section_files')
    .select(FILE_COLUMNS)
    .eq('section_key', sectionKey)
    .order('created_at', { ascending: false })
    .limit(2000);
  if (error) throw error;
  return data || [];
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
 * رفع ملف: Storage أولاً ثم صف البيانات الوصفية؛ عند فشل الإدراج يُحذف الكائن.
 */
export async function uploadSectionFile({
  file,
  sectionKey,
  subKey = null,
  recordId = null,
  title,
  description = null,
  category = null,
}) {
  const check = validateSectionFile(file);
  if (!check.ok) throw new Error(check.error);

  const sb = getSupabase();
  const path = `sections/${sectionKey}/${scopeSegment({ subKey, recordId })}/${uuidV4()}.${check.ext}`;
  const { error: upErr } = await sb.storage.from(STORAGE_BUCKET).upload(path, file, {
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
        record_id: recordId,
        category: category || null,
        storage_path: path,
        original_name: String(file.name).slice(0, 255),
        mime_type: check.mime,
        file_kind: check.kind,
        file_size: file.size,
        title: (title || baseName(file.name)).trim().slice(0, 200),
        description: description ? String(description).trim().slice(0, 2000) : null,
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

export async function updateSectionFile(id, { title, description, category }) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('section_files')
    .update({
      title: String(title).trim(),
      description: description ? String(description).trim() : null,
      category: category || null,
    })
    .eq('id', id)
    .select(FILE_COLUMNS)
    .single();
  if (error) throw error;
  await writeAudit('update', 'section_files', id, { id });
  return data;
}

/** حذف كائنات Storage ثم صفوف البيانات الوصفية */
export async function deleteSectionFiles(rows) {
  const list = (rows || []).filter(Boolean);
  if (!list.length) return;
  const sb = getSupabase();
  const paths = list.map((r) => r.storage_path).filter(Boolean);
  if (paths.length) {
    const { error } = await sb.storage.from(STORAGE_BUCKET).remove(paths);
    if (error) {
      logDev(error);
      throw new Error('تعذّر حذف الملف من التخزين');
    }
  }
  const ids = list.map((r) => r.id);
  const { error } = await sb.from('section_files').delete().in('id', ids);
  if (error) throw error;
  for (const r of list) {
    await writeAudit('delete', 'section_files', r.id, { id: r.id, file_name: r.original_name });
  }
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

function categorySelect(categories, value = '') {
  const sel = createEl('select', { className: 'select' }, [
    createEl('option', { value: '', textContent: 'بدون تصنيف' }),
    ...categories.map((c) => createEl('option', { value: c.key, textContent: c.label })),
  ]);
  sel.value = value || '';
  return sel;
}

/** نافذة تعديل العنوان والوصف (والتصنيف إن وُجد) */
export function openEditFileDialog(row, { categories = [], onSaved } = {}) {
  const form = createEl('form', { className: 'form-grid' });
  const titleInput = createEl('input', { className: 'input', value: row.title || '', maxlength: '200' });
  const descInput = createEl('textarea', { className: 'textarea', maxlength: '2000' });
  descInput.value = row.description || '';
  form.append(
    createEl('p', { className: 'muted', dir: 'auto', textContent: `الملف: ${row.original_name}` }),
    field('عنوان الملف', titleInput),
    field('الوصف (اختياري)', descInput)
  );
  let catSel = null;
  if (categories.length) {
    catSel = categorySelect(categories, row.category);
    form.appendChild(field('التصنيف', catSel));
  }
  const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: 'حفظ التعديل' });
  form.appendChild(createEl('div', { className: 'modal__actions' }, [saveBtn]));
  const { close } = openModal({ title: 'تعديل بيانات الملف', contentNode: form });
  titleInput.focus();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = validateLength(titleInput.value, 'عنوان الملف', 1, 200);
    if (err) {
      showToast(err, 'error');
      return;
    }
    setButtonLoading(saveBtn, true);
    try {
      const updated = await updateSectionFile(row.id, {
        title: titleInput.value,
        description: descInput.value,
        category: catSel ? catSel.value : row.category,
      });
      showToast('تم حفظ بيانات الملف', 'success');
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
  return confirmDialog({
    title: 'حذف الملف نهائياً',
    message: `سيتم حذف الملف «${row.title || row.original_name}» (${row.original_name}) من التخزين نهائياً ولا يمكن التراجع. هل تريدين المتابعة؟`,
    confirmText: 'نعم، احذف الملف',
    cancelText: 'تراجع',
    danger: true,
  });
}

// ---------------------------------------------------------------------
// UI: upload dialog
// ---------------------------------------------------------------------

/**
 * نافذة رفع متعدد: عنوان لكل ملف + وصف وتصنيف مشتركان.
 * onUploaded(row) يُستدعى فور نجاح كل ملف لإظهاره دون تحديث الصفحة.
 */
export function openUploadDialog({
  scope,
  categories = [],
  initialFiles = [],
  title = 'رفع ملفات',
  onUploaded,
}) {
  const wrap = createEl('form', { className: 'form-grid upload-form' });
  const input = createEl('input', {
    type: 'file',
    multiple: true,
    accept: FILE_ACCEPT,
    className: 'visually-hidden',
    id: `fm-input-${Math.random().toString(36).slice(2)}`,
  });
  const drop = createEl('label', { className: 'dropzone', for: input.id }, [
    icon('upload', { size: 30 }),
    createEl('strong', { textContent: 'اختاري الملفات من جهازك أو اسحبيها هنا' }),
    createEl('span', {
      className: 'muted',
      textContent: 'PDF، Word، Excel، صور (JPG / PNG / WEBP / GIF) — حتى 10 م.ب للملف',
    }),
  ]);
  const listEl = createEl('div', { className: 'upload-list' });
  const descInput = createEl('textarea', {
    className: 'textarea',
    maxlength: '2000',
    placeholder: 'وصف مشترك للملفات المختارة (اختياري)',
  });
  let catSel = null;
  wrap.append(input, drop, listEl, field('الوصف (اختياري)', descInput));
  if (categories.length) {
    catSel = categorySelect(categories);
    wrap.appendChild(field('التصنيف', catSel));
  }
  const submitBtn = createEl('button', { type: 'submit', className: 'btn btn--primary' }, [
    icon('upload', { size: 18 }),
    createEl('span', { textContent: 'رفع الملفات' }),
  ]);
  wrap.appendChild(createEl('div', { className: 'modal__actions' }, [submitBtn]));

  /** @type {{ file: File, titleInput: HTMLInputElement, status: HTMLElement, done: boolean, item: HTMLElement }[]} */
  let picked = [];

  function addFiles(files) {
    for (const file of files) {
      const check = validateSectionFile(file);
      if (!check.ok) {
        showToast(check.error, 'error');
        continue;
      }
      const titleInput = createEl('input', {
        className: 'input',
        value: baseName(file.name),
        maxlength: '200',
        'aria-label': `عنوان ${file.name}`,
      });
      const status = createEl('span', { className: 'upload-item__status muted', textContent: formatBytes(file.size) });
      const removeBtn = createEl('button', {
        type: 'button',
        className: 'icon-btn icon-btn--sm',
        'aria-label': 'إزالة من القائمة',
      }, [icon('close', { size: 16 })]);
      const item = createEl('div', { className: 'upload-item' }, [
        kindTile(check.kind, 22),
        createEl('div', { className: 'upload-item__body' }, [
          titleInput,
          createEl('span', { className: 'upload-item__name', dir: 'auto', textContent: file.name }),
        ]),
        status,
        removeBtn,
      ]);
      const entry = { file, titleInput, status, done: false, item };
      removeBtn.addEventListener('click', () => {
        picked = picked.filter((p) => p !== entry);
        item.remove();
      });
      picked.push(entry);
      listEl.appendChild(item);
    }
  }

  input.addEventListener('change', () => {
    addFiles([...(input.files || [])]);
    input.value = '';
  });
  ['dragenter', 'dragover'].forEach((ev) =>
    drop.addEventListener(ev, (e) => {
      e.preventDefault();
      drop.classList.add('is-over');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    drop.addEventListener(ev, () => drop.classList.remove('is-over'))
  );
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    addFiles([...(e.dataTransfer?.files || [])]);
  });

  const { close } = openModal({ title, contentNode: wrap });
  if (initialFiles.length) addFiles(initialFiles);

  wrap.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pending = picked.filter((p) => !p.done);
    if (!pending.length) {
      showToast('اختاري ملفاً واحداً على الأقل', 'error');
      return;
    }
    for (const p of pending) {
      const err = validateLength(p.titleInput.value, 'عنوان الملف', 1, 200);
      if (err) {
        showToast(`${err} (${p.file.name})`, 'error');
        p.titleInput.focus();
        return;
      }
    }
    setButtonLoading(submitBtn, true, 'جارٍ الرفع...');
    let ok = 0;
    let failed = 0;
    for (const p of pending) {
      p.status.textContent = 'جارٍ الرفع...';
      p.item.classList.add('is-busy');
      try {
        const row = await uploadSectionFile({
          file: p.file,
          ...scope,
          title: p.titleInput.value,
          description: descInput.value,
          category: catSel ? catSel.value : null,
        });
        p.done = true;
        ok += 1;
        p.status.textContent = 'تم الرفع ✓';
        p.item.classList.remove('is-busy');
        p.item.classList.add('is-done');
        p.titleInput.disabled = true;
        if (typeof onUploaded === 'function') onUploaded(row);
      } catch (err) {
        failed += 1;
        logDev(err);
        p.item.classList.remove('is-busy');
        p.item.classList.add('is-failed');
        p.status.textContent = 'فشل الرفع';
        handleError(err, `تعذّر رفع ${p.file.name}`);
      }
    }
    setButtonLoading(submitBtn, false);
    if (ok && !failed) {
      showToast(ok === 1 ? 'تم رفع الملف بنجاح' : `تم رفع ${ok} ملفات بنجاح`, 'success');
      close();
    } else if (ok && failed) {
      showToast(`تم رفع ${ok} وتعذّر رفع ${failed} — راجعي القائمة`, 'error');
    }
  });
}

// ---------------------------------------------------------------------
// UI: reusable file manager panel
// ---------------------------------------------------------------------

/**
 * @param {{
 *   ctx: object,
 *   container: HTMLElement,
 *   sectionKey: string,
 *   subKey?: string|null,
 *   recordId?: string|null,
 *   categories?: {key:string,label:string}[],
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
    recordId = null,
    categories = [],
    uploadLabel = 'رفع ملف جديد',
    emptyText = 'لا توجد ملفات بعد',
    onChange,
  } = opts;
  const scope = { sectionKey, subKey, recordId };
  let rows = [];
  let loaded = false;
  let sortKey = 'newest';

  const root = createEl('div', { className: 'file-manager' });
  const bar = createEl('div', { className: 'fm-toolbar no-print' });
  const searchWrap = createEl('label', { className: 'search-box' });
  const searchInput = createEl('input', {
    type: 'search',
    className: 'input',
    placeholder: 'ابحثي باسم الملف أو عنوانه...',
    'aria-label': 'بحث في الملفات',
  });
  searchWrap.append(icon('search', { size: 18 }), searchInput);
  const sortSel = createEl(
    'select',
    { className: 'select fm-sort', 'aria-label': 'ترتيب الملفات' },
    SORT_OPTIONS.map((o) => createEl('option', { value: o.key, textContent: o.label }))
  );
  let catFilter = null;
  const countEl = createEl('span', { className: 'fm-count muted' });
  bar.append(searchWrap, sortSel);
  if (categories.length) {
    catFilter = createEl('select', { className: 'select fm-sort', 'aria-label': 'تصفية حسب التصنيف' }, [
      createEl('option', { value: '', textContent: 'كل التصنيفات' }),
      ...categories.map((c) => createEl('option', { value: c.key, textContent: c.label })),
    ]);
    bar.appendChild(catFilter);
  }
  bar.appendChild(countEl);

  if (ctx.canEdit) {
    const upBtn = createEl('button', { type: 'button', className: 'btn btn--primary btn--upload' }, [
      icon('upload', { size: 18 }),
      createEl('span', { textContent: uploadLabel }),
    ]);
    upBtn.addEventListener('click', () => openUpload());
    bar.appendChild(upBtn);
  }

  const grid = createEl('div', { className: 'file-grid', 'aria-live': 'polite' });
  root.append(bar, grid);
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
      openUpload([...e.dataTransfer.files]);
    });
  }

  searchInput.addEventListener('input', () => render());
  sortSel.addEventListener('change', () => {
    sortKey = sortSel.value;
    render();
  });
  if (catFilter) catFilter.addEventListener('change', () => render());

  function openUpload(initialFiles = []) {
    openUploadDialog({
      scope,
      categories,
      initialFiles,
      title: uploadLabel,
      onUploaded: (row) => {
        rows = [row, ...rows];
        render();
        notify();
      },
    });
  }

  function notify() {
    if (typeof onChange === 'function') onChange(rows);
  }

  function visibleRows() {
    const q = searchInput.value.trim();
    const cat = catFilter ? catFilter.value : '';
    const filtered = rows.filter(
      (r) =>
        (!cat || r.category === cat) &&
        (!q ||
          arabicIncludes(r.title, q) ||
          arabicIncludes(r.original_name, q) ||
          arabicIncludes(r.description, q))
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
        createEl('span', { className: 'muted', textContent: 'اضغطي زر الرفع أو اسحبي الملفات إلى هنا' })
      );
      const b = createEl('button', { type: 'button', className: 'btn btn--primary' }, [
        icon('upload', { size: 18 }),
        createEl('span', { textContent: uploadLabel }),
      ]);
      b.addEventListener('click', () => openUpload());
      box.appendChild(b);
    }
    return box;
  }

  function buildCard(row, list) {
    const card = createEl('article', { className: 'file-card' });
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

    const catLabel = (categories.find((c) => c.key === row.category) || {}).label;
    const body = createEl('div', { className: 'file-card__body' }, [
      createEl('h4', { className: 'file-card__title', textContent: row.title }),
      createEl('span', {
        className: 'file-card__name',
        dir: 'auto',
        title: row.original_name,
        textContent: row.original_name,
      }),
      createEl('div', { className: 'file-card__meta' }, [
        createEl('span', { className: `chip chip--${row.file_kind}`, textContent: kindLabel(row.file_kind) }),
        catLabel ? createEl('span', { className: 'chip', textContent: catLabel }) : null,
        createEl('span', { textContent: formatBytes(row.file_size) }),
        createEl('span', { textContent: formatDate(row.created_at) }),
      ]),
      row.description
        ? createEl('p', { className: 'file-card__desc', textContent: row.description })
        : null,
    ]);

    const actions = createEl('div', { className: 'file-card__actions' });
    const act = (label, iconName, onClick, cls = '') => {
      const b = createEl('button', { type: 'button', className: `fc-btn ${cls}`, title: label }, [
        icon(iconName, { size: 17 }),
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
        act('تعديل', 'edit', () =>
          openEditFileDialog(row, {
            categories,
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
    const filtered = Boolean(searchInput.value.trim() || (catFilter && catFilter.value));
    countEl.textContent = filtered ? `${list.length} من ${rows.length} ملف` : `${rows.length} ملف`;
    clearElement(grid);
    if (!list.length) {
      grid.appendChild(renderEmptyState(filtered));
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
      rows = await listSectionFiles(scope);
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
  return { reload, getRows: () => rows, root };
}
