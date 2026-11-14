/**
 * competitions.js — المسابقات: رفع ملفات لكل مسابقة (عنوان + وصف مختصر اختياري)
 * - للزوار: عرض المسابقات المنشورة وفتح ملفاتها وتنزيلها دون تسجيل دخول.
 * - في وضع الإدارة (الرقم السري): رفع/تعديل/نشر/إخفاء/حذف — تفرضها RLS وسياسات التخزين في الخادم.
 * - المسابقات والملفات السابقة تبقى كما هي وتظهر بالطريقة الجديدة نفسها.
 */
import { bootPage } from './app.js';
import { STORAGE_BUCKET } from './config.js';
import { getSupabase } from './supabase-client.js';
import { writeAudit } from './supabase-service.js';
import { removeStorageVerified } from './storage.js';
import {
  openFilePreview,
  downloadSectionFile,
  openInNewTab,
  canPreviewInline,
  kindLabel,
  kindTile,
  attachPdfPreview,
  getThumbUrls,
  isMissingSchemaError,
  SORT_OPTIONS,
} from './file-manager.js';
import { openModal, confirmDialog, setButtonLoading, field } from './ui.js';
import { validateCompetitionFile, validateRequired, validateLength } from './validators.js';
import { createEl, clearElement, formatBytes, formatDate, arabicIncludes, logDev } from './utils.js';
import { icon } from './icons.js';

const FILE_ACCEPT =
  '.pdf,.doc,.docx,.ppt,.pptx,.jpg,.jpeg,.png,.webp,.gif,application/pdf,image/*,' +
  'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,' +
  'application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation';

const PUBLIC_COLS =
  'id, competition_name, description, competition_date, is_published, created_at, ' +
  'competition_files(id, file_path, file_name, file_type, mime_type, file_size, created_at)';
const ADMIN_COLS = '*, competition_files(*)';

function uuidV4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** صف competition_files → شكل صف الملف المستخدم في الاستعراض والتنزيل */
function toFileRow(f) {
  return {
    id: f.id,
    storage_path: f.file_path,
    original_name: f.file_name,
    title: f.file_name,
    file_kind: f.file_type,
    file_size: f.file_size,
    created_at: f.created_at,
  };
}

// ---------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------
async function listCompetitions(admin) {
  const { data, error } = await getSupabase()
    .from('competitions')
    .select(admin ? ADMIN_COLS : PUBLIC_COLS)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) throw error;
  return (data || []).map((c) => ({
    ...c,
    files: [...(c.competition_files || [])]
      .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
      .map(toFileRow),
  }));
}

async function uploadCompetitionFile(competitionId, file, userId) {
  const check = validateCompetitionFile(file);
  if (!check.ok) throw new Error(check.error);
  const sb = getSupabase();
  const path = `${userId}/competitions/${Date.now()}-${uuidV4()}.${check.ext}`;
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
      .from('competition_files')
      .insert({
        competition_id: competitionId,
        file_path: path,
        file_name: String(file.name).slice(0, 255),
        file_type: check.kind,
        mime_type: check.mime,
        file_size: file.size,
        uploaded_by: userId,
      })
      .select()
      .single();
    if (error) throw error;
    await writeAudit('upload_file', 'competition_files', data.id, {
      competition_id: competitionId,
      file_name: data.file_name,
    });
    return toFileRow(data);
  } catch (err) {
    await sb.storage.from(STORAGE_BUCKET).remove([path]).catch((e) => logDev('orphan cleanup', e));
    throw err;
  }
}

async function deleteCompetitionFile(fileRow) {
  await removeStorageVerified(STORAGE_BUCKET, [fileRow.storage_path]);
  const { error } = await getSupabase().from('competition_files').delete().eq('id', fileRow.id);
  if (error) throw error;
  await writeAudit('delete_file', 'competition_files', fileRow.id, { file_name: fileRow.original_name });
}

async function deleteCompetition(comp) {
  await removeStorageVerified(STORAGE_BUCKET, comp.files.map((f) => f.storage_path));
  const { error } = await getSupabase().from('competitions').delete().eq('id', comp.id);
  if (error) throw error;
  await writeAudit('delete', 'competitions', comp.id, { id: comp.id });
}

// ---------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------
bootPage({ title: 'المسابقات' }, async (ctx) => {
  const root = ctx.content;
  const admin = ctx.canEdit;
  let rows = [];
  let sortKey = 'newest';

  root.appendChild(
    createEl('section', { className: 'section-header comp-head' }, [
      createEl('span', { className: 'section-header__icon' }, [icon('trophy', { size: 30 })]),
      createEl('div', { className: 'section-header__text' }, [
        createEl('h2', { textContent: 'المسابقات' }),
        createEl('p', {
          textContent: admin
            ? 'ارفعي ملفات كل مسابقة (PDF، صور، Word، PowerPoint) مع عنوان ووصف مختصر. المسابقات غير منشورة افتراضياً؛ راجعي ملفاتها ثم اختاري «نشر للزوار».'
            : 'مسابقات المدرسة وملفاتها: استعراض وتنزيل مباشرة.',
        }),
      ]),
    ])
  );

  const bar = createEl('div', { className: 'fm-toolbar no-print' });
  const searchInput = createEl('input', {
    type: 'search',
    className: 'input',
    placeholder: 'ابحث باسم المسابقة أو الملف...',
    'aria-label': 'بحث في المسابقات',
  });
  const sortSel = createEl(
    'select',
    { className: 'select fm-sort', 'aria-label': 'ترتيب المسابقات' },
    SORT_OPTIONS.map((o) => createEl('option', { value: o.key, textContent: o.label }))
  );
  const countEl = createEl('span', { className: 'fm-count muted' });
  bar.append(createEl('label', { className: 'search-box' }, [icon('search', { size: 18 }), searchInput]), sortSel, countEl);
  if (admin) {
    const addBtn = createEl('button', { type: 'button', className: 'btn btn--primary btn--upload' }, [
      icon('upload', { size: 18 }),
      createEl('span', { textContent: 'رفع مسابقة جديدة' }),
    ]);
    addBtn.addEventListener('click', () => openCompetitionForm(null));
    bar.appendChild(addBtn);
  }
  root.appendChild(bar);
  if (admin) {
    root.appendChild(createEl('p', {
      className: 'fm-hint muted no-print',
      textContent: 'PDF، Word، PowerPoint، صور (JPG / PNG / WEBP / GIF) — حتى 10 م.ب للملف، ويمكن رفع عدة ملفات لكل مسابقة.',
    }));
  }
  const list = createEl('div', { className: 'comp-list', 'aria-live': 'polite' });
  root.appendChild(list);

  searchInput.addEventListener('input', () => render());
  sortSel.addEventListener('change', () => {
    sortKey = sortSel.value;
    render();
  });

  function visible() {
    const q = searchInput.value.trim();
    const filtered = rows.filter(
      (c) =>
        !q ||
        arabicIncludes(c.competition_name, q) ||
        arabicIncludes(c.description, q) ||
        c.files.some((f) => arabicIncludes(f.original_name, q))
    );
    if (sortKey === 'name') {
      filtered.sort((a, b) => String(a.competition_name).localeCompare(String(b.competition_name), 'ar'));
    } else {
      const dir = sortKey === 'oldest' ? 1 : -1;
      filtered.sort((a, b) => dir * (new Date(a.created_at) - new Date(b.created_at)));
    }
    return filtered;
  }

  function render() {
    const data = visible();
    countEl.textContent = searchInput.value.trim() ? `${data.length} من ${rows.length} مسابقة` : `${rows.length} مسابقة`;
    clearElement(list);
    if (!data.length) {
      const empty = createEl('div', { className: 'fm-empty' }, [
        createEl('div', { className: 'fm-empty__icon' }, [icon(searchInput.value.trim() ? 'search' : 'trophy', { size: 34 })]),
        createEl('strong', { textContent: searchInput.value.trim() ? 'لا توجد مسابقات مطابقة للبحث' : 'لا توجد مسابقات بعد' }),
      ]);
      list.appendChild(empty);
      return;
    }
    data.forEach((c) => list.appendChild(competitionCard(c)));
  }

  async function reload() {
    clearElement(list);
    for (let i = 0; i < 2; i += 1) list.appendChild(createEl('div', { className: 'comp-card skeleton', style: 'min-height:220px' }));
    try {
      rows = await listCompetitions(admin);
      render();
    } catch (err) {
      clearElement(list);
      list.appendChild(createEl('div', { className: 'fm-empty' }, [
        createEl('strong', {
          textContent: isMissingSchemaError(err) || /column/i.test(String(err?.message))
            ? 'قسم المسابقات يحتاج تشغيل migrations/004_public_parents_competitions.sql'
            : 'تعذّر تحميل المسابقات',
        }),
      ]));
      ctx.handleError(err, 'تعذّر تحميل المسابقات');
    }
  }

  function legacyDetails(c) {
    if (!admin) return null;
    const fields = [
      ['المعلمة', c.teacher_name],
      ['الطالبات المشاركات', c.participant_students],
      ['تاريخ المسابقة', c.competition_date ? formatDate(c.competition_date) : null],
      ['النتيجة', c.result],
      ['ملاحظات', c.notes],
    ].filter(([, v]) => v);
    if (!fields.length) return null;
    const dl = createEl('dl', { className: 'record-details__fields' });
    fields.forEach(([k, v]) => dl.append(createEl('dt', { textContent: k }), createEl('dd', { textContent: v })));
    return createEl('details', { className: 'comp-legacy' }, [
      createEl('summary', { textContent: 'بيانات مسجلة سابقاً (تظهر لرائدة النشاط فقط)' }),
      dl,
    ]);
  }

  function fileCard(c, f) {
    const card = createEl('article', { className: 'file-card' });
    const thumb = createEl('button', {
      type: 'button',
      className: `file-card__thumb file-card__thumb--${f.file_kind}`,
      'aria-label': `استعراض ${f.original_name}`,
    });
    if (f.file_kind === 'image') {
      thumb.appendChild(kindTile('image', 30));
      getThumbUrls([f.storage_path]).then((m) => {
        const url = m[f.storage_path];
        if (!url) return;
        const img = createEl('img', { alt: '', decoding: 'async', className: 'file-card__img', src: url });
        img.addEventListener('load', () => thumb.replaceChildren(img));
      });
    } else {
      thumb.appendChild(kindTile(f.file_kind, 34));
      if (f.file_kind === 'pdf') attachPdfPreview(thumb, f);
    }
    const previewable = c.files.filter(canPreviewInline);
    const open = async () => {
      if (canPreviewInline(f)) openFilePreview(f, { list: previewable });
      else {
        try {
          await openInNewTab(f);
        } catch (err) {
          ctx.handleError(err);
        }
      }
    };
    thumb.addEventListener('click', open);

    const act = (label, iconName, fn, cls = '') => {
      const b = createEl('button', { type: 'button', className: `fc-btn ${cls}`, title: label }, [
        icon(iconName, { size: 16 }),
        createEl('span', { textContent: label }),
      ]);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await fn();
        } catch (err) {
          ctx.handleError(err);
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      });
      return b;
    };
    const actions = createEl('div', { className: 'file-card__actions' }, [
      act(canPreviewInline(f) ? 'استعراض' : 'فتح', canPreviewInline(f) ? 'eye' : 'external', open),
      act('تحميل', 'download', () => downloadSectionFile(f)),
    ]);
    if (admin) {
      actions.appendChild(act('حذف', 'trash', async () => {
        const ok = await confirmDialog({
          title: 'حذف الملف نهائياً',
          message: `سيتم حذف الملف «${f.original_name}» من المسابقة نهائياً ولا يمكن التراجع. هل تريدين المتابعة؟`,
          confirmText: 'نعم، احذف الملف',
          cancelText: 'تراجع',
          danger: true,
        });
        if (!ok) return;
        await deleteCompetitionFile(f);
        ctx.showToast('تم حذف الملف', 'success');
        await reload();
      }, 'fc-btn--danger'));
    }

    card.append(
      thumb,
      createEl('div', { className: 'file-card__body' }, [
        createEl('h4', { className: 'file-card__title', dir: 'auto', textContent: f.original_name }),
        createEl('div', { className: 'file-card__meta' }, [
          createEl('span', { className: `chip chip--${f.file_kind}`, textContent: kindLabel(f.file_kind) }),
          createEl('span', { textContent: formatBytes(f.file_size) }),
        ]),
      ]),
      actions
    );
    return card;
  }

  function competitionCard(c) {
    const headActions = admin
      ? createEl('div', { className: 'row-actions no-print' }, [
          c.is_published
            ? btn('إخفاء عن الزوار', 'eyeOff', () => setPublished(c, false))
            : btn('نشر للزوار', 'globe', () => setPublished(c, true), 'btn btn--primary btn--sm'),
          btn('إضافة ملفات', 'upload', () => openAddFiles(c)),
          btn('تعديل', 'edit', () => openCompetitionForm(c)),
          btn('حذف', 'trash', () => removeCompetition(c), 'btn btn--danger btn--sm'),
        ])
      : null;
    return createEl('article', { className: `comp-card${c.is_published ? '' : ' is-hidden'}` }, [
      createEl('header', { className: 'comp-card__head' }, [
        createEl('div', { className: 'comp-card__titles' }, [
          createEl('h3', { className: 'comp-card__title', textContent: c.competition_name }),
          createEl('div', { className: 'file-card__meta' }, [
            createEl('span', { className: 'meta-chip' }, [
              icon('calendarSmall', { size: 15 }),
              createEl('span', { textContent: formatDate(c.competition_date || c.created_at) }),
            ]),
            createEl('span', { className: 'meta-chip' }, [
              icon('paperclip', { size: 15 }),
              createEl('span', { textContent: `${c.files.length} ملف` }),
            ]),
            admin
              ? createEl('span', {
                  className: `chip ${c.is_published ? 'chip--open' : 'chip--closed'}`,
                  textContent: c.is_published ? 'منشورة للزوار' : 'غير منشورة — لا يراها الزوار',
                })
              : null,
          ]),
        ]),
        headActions,
      ]),
      c.description ? createEl('p', { className: 'comp-card__desc', dir: 'auto', textContent: c.description }) : null,
      legacyDetails(c),
      c.files.length
        ? createEl('div', { className: 'file-grid comp-files' }, c.files.map((f) => fileCard(c, f)))
        : createEl('p', { className: 'muted', textContent: 'لا توجد ملفات لهذه المسابقة' }),
    ]);
  }

  function btn(label, iconName, fn, cls = 'btn btn--ghost btn--sm') {
    const b = createEl('button', { type: 'button', className: cls }, [icon(iconName, { size: 16 }), createEl('span', { textContent: label })]);
    b.addEventListener('click', fn);
    return b;
  }

  /** منطقة اختيار ملفات متعددة مع سحب وإفلات */
  function filePicker() {
    let files = [];
    const input = createEl('input', { type: 'file', multiple: true, accept: FILE_ACCEPT, className: 'visually-hidden', tabindex: '-1', 'aria-hidden': 'true' });
    const listEl = createEl('div', { className: 'upload-list' });
    const zone = createEl('div', { className: 'dropzone', role: 'button', tabindex: '0' }, [
      icon('upload', { size: 28 }),
      createEl('strong', { textContent: 'اختاري الملفات أو اسحبيها إلى هنا' }),
      createEl('span', { textContent: 'PDF، Word، PowerPoint، صور — حتى 10 م.ب للملف' }),
    ]);
    const add = (incoming) => {
      for (const f of incoming) {
        const check = validateCompetitionFile(f);
        if (!check.ok) ctx.showToast(check.error, 'error');
        else files.push({ file: f, kind: check.kind, status: 'ready' });
      }
      draw();
    };
    const draw = () => {
      clearElement(listEl);
      files.forEach((it, i) => {
        const rm = createEl('button', { type: 'button', className: 'icon-btn icon-btn--sm', 'aria-label': 'إزالة' }, [icon('close', { size: 16 })]);
        rm.disabled = it.status !== 'ready' && it.status !== 'failed';
        rm.addEventListener('click', () => {
          files = files.filter((_, j) => j !== i);
          draw();
        });
        const statusText = { ready: formatBytes(it.file.size), busy: 'جارٍ الرفع...', done: 'تم الرفع', failed: 'تعذّر الرفع' }[it.status];
        listEl.appendChild(createEl('div', { className: `upload-item${it.status === 'busy' ? ' is-busy' : ''}${it.status === 'done' ? ' is-done' : ''}${it.status === 'failed' ? ' is-failed' : ''}` }, [
          kindTile(it.kind, 22),
          createEl('div', { className: 'upload-item__body' }, [
            createEl('strong', { dir: 'auto', textContent: it.file.name }),
          ]),
          createEl('span', { className: 'upload-item__status', textContent: statusText }),
          rm,
        ]));
      });
    };
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        input.click();
      }
    });
    input.addEventListener('change', () => {
      add([...(input.files || [])]);
      input.value = '';
    });
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('is-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('is-over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('is-over');
      add([...(e.dataTransfer?.files || [])]);
    });
    return {
      node: createEl('div', { className: 'form-grid' }, [zone, input, listEl]),
      items: () => files,
      redraw: draw,
    };
  }

  async function uploadAll(competitionId, picker) {
    let ok = 0;
    for (const it of picker.items()) {
      if (it.status === 'done') continue;
      it.status = 'busy';
      picker.redraw();
      try {
        await uploadCompetitionFile(competitionId, it.file, ctx.user.id);
        it.status = 'done';
        ok += 1;
      } catch (err) {
        it.status = 'failed';
        ctx.handleError(err, `تعذّر رفع «${it.file.name}»`);
      }
      picker.redraw();
    }
    return ok;
  }

  function openCompetitionForm(c) {
    const form = createEl('form', { className: 'form-grid' });
    const title = createEl('input', { className: 'input', maxlength: '200', value: c?.competition_name || '', required: true });
    const desc = createEl('textarea', { className: 'textarea', maxlength: '2000', rows: '3' });
    desc.value = c?.description || '';
    const published = createEl('input', { type: 'checkbox' });
    published.checked = Boolean(c?.is_published);
    const picker = c ? null : filePicker();
    const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: c ? 'حفظ' : 'رفع المسابقة' });
    form.append(
      field('عنوان المسابقة', title),
      field('وصف مختصر (اختياري)', desc),
      picker ? createEl('div', { className: 'field' }, [createEl('span', { className: 'field__label', textContent: 'ملفات المسابقة' }), picker.node]) : null,
      createEl('label', { className: 'pe-consent' }, [
        published,
        createEl('span', { textContent: 'نشر المسابقة للزوار الآن (تأكدي أن الملفات لا تحتوي أسماء أو صوراً أو بيانات خاصة)' }),
      ]),
      createEl('div', { className: 'modal__actions' }, [saveBtn])
    );
    const { close } = openModal({ title: c ? 'تعديل المسابقة' : 'رفع مسابقة جديدة', contentNode: form });
    title.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err =
        validateRequired(title.value, 'عنوان المسابقة') ||
        validateLength(title.value, 'عنوان المسابقة', 1, 200) ||
        (desc.value.length > 2000 ? 'الوصف أطول من المسموح' : null);
      if (err) {
        ctx.showToast(err, 'error');
        return;
      }
      if (picker && !picker.items().length) {
        ctx.showToast('اختاري ملفاً واحداً على الأقل للمسابقة', 'error');
        return;
      }
      const payload = {
        competition_name: title.value.trim(),
        description: desc.value.trim() || null,
        is_published: published.checked,
      };
      setButtonLoading(saveBtn, true, c ? 'جارٍ الحفظ...' : 'جارٍ الرفع...');
      const sb = getSupabase();
      try {
        if (c) {
          const { error } = await sb.from('competitions').update(payload).eq('id', c.id);
          if (error) throw error;
          await writeAudit('update', 'competitions', c.id, { id: c.id });
          ctx.showToast('تم حفظ المسابقة', 'success');
          close();
        } else {
          const { data, error } = await sb
            .from('competitions')
            .insert({ ...payload, created_by: ctx.user.id })
            .select('id')
            .single();
          if (error) throw error;
          await writeAudit('create', 'competitions', data.id, { id: data.id });
          const ok = await uploadAll(data.id, picker);
          if (!ok) {
            await sb.from('competitions').delete().eq('id', data.id);
            throw new Error('لم يُرفع أي ملف، لم تُضف المسابقة');
          }
          const failed = picker.items().length - ok;
          ctx.showToast(failed ? `تمت إضافة المسابقة؛ تعذّر رفع ${failed} ملف` : 'تمت إضافة المسابقة بنجاح', failed ? 'error' : 'success');
          close();
        }
        await reload();
      } catch (error) {
        ctx.handleError(error);
      } finally {
        if (saveBtn.isConnected) setButtonLoading(saveBtn, false);
      }
    });
  }

  function openAddFiles(c) {
    const picker = filePicker();
    const saveBtn = createEl('button', { type: 'button', className: 'btn btn--primary', textContent: 'رفع الملفات' });
    const wrap = createEl('div', { className: 'form-grid' }, [picker.node, createEl('div', { className: 'modal__actions' }, [saveBtn])]);
    const { close } = openModal({ title: `إضافة ملفات: ${c.competition_name}`, contentNode: wrap });
    saveBtn.addEventListener('click', async () => {
      if (!picker.items().some((i) => i.status !== 'done')) {
        ctx.showToast('اختاري ملفات أولاً', 'error');
        return;
      }
      setButtonLoading(saveBtn, true, 'جارٍ الرفع...');
      const ok = await uploadAll(c.id, picker);
      setButtonLoading(saveBtn, false);
      if (ok) {
        ctx.showToast(ok === 1 ? 'تم رفع الملف' : `تم رفع ${ok} ملفات`, 'success');
        if (picker.items().every((i) => i.status === 'done')) close();
        await reload();
      }
    });
  }

  async function setPublished(c, publish) {
    if (publish) {
      const ok = await confirmDialog({
        title: 'نشر المسابقة للزوار',
        message: `ستظهر «${c.competition_name}» و${c.files.length} ملف لكل زوار المنصة دون تسجيل دخول. تأكدي أن الملفات لا تحتوي أسماء طالبات أو صوراً أو بيانات خاصة.`,
        confirmText: 'نعم، انشر',
        cancelText: 'تراجع',
      });
      if (!ok) return;
    }
    try {
      const { data, error } = await getSupabase()
        .from('competitions')
        .update({ is_published: publish })
        .eq('id', c.id)
        .select('id')
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('ليست لديك صلاحية لتنفيذ هذا الإجراء');
      await writeAudit(publish ? 'publish' : 'unpublish', 'competitions', c.id, { id: c.id });
      ctx.showToast(publish ? 'نُشرت المسابقة للزوار' : 'أُخفيت المسابقة عن الزوار', 'success');
      await reload();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  async function removeCompetition(c) {
    const ok = await confirmDialog({
      title: 'حذف المسابقة نهائياً',
      message: `سيتم حذف المسابقة «${c.competition_name}» و${c.files.length} ملف من التخزين نهائياً ولا يمكن التراجع. هل تريدين المتابعة؟`,
      confirmText: 'نعم، احذف المسابقة',
      cancelText: 'تراجع',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteCompetition(c);
      ctx.showToast('تم حذف المسابقة', 'success');
      await reload();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  await reload();
});
