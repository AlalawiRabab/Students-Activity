/**
 * section-page.js — صفحة قسم موحّدة لأقسام السجل الإلكتروني لرائدة النشاط
 * كل صفحة HTML تحدد القسم عبر <body data-section="...">
 */
import { bootProtectedPage } from './app.js';
import { getSection, sectionIndex, SECTIONS } from './sections-config.js';
import {
  createFileManager,
  listAllSectionFiles,
  deleteSectionFiles,
  getThumbUrls,
  openFilePreview,
  downloadSectionFile,
  isMissingSchemaError,
  renderSchemaNotice,
  canPreviewInline,
} from './file-manager.js';
import { insertRow, updateRow, deleteRow, listRows, fetchChildren } from './supabase-service.js';
import { createEl, clearElement, formatDate, arabicIncludes, recipientTypeLabel, mimeToFileType } from './utils.js';
import { openModal, confirmDialog, setButtonLoading, field } from './ui.js';
import { validateRequired, validateLength } from './validators.js';
import { icon } from './icons.js';

const section = getSection(document.body.dataset.section);

if (!section) {
  document.body.textContent = 'قسم غير معروف';
} else {
  bootProtectedPage({ title: section.short || section.title }, async (ctx) => {
    const root = ctx.content;
    root.appendChild(buildSectionHeader(section));
    const body = createEl('div', { className: 'section-body' });
    root.appendChild(body);

    if (section.kind === 'files') {
      createFileManager({
        ctx,
        container: body,
        sectionKey: section.key,
        uploadLabel: section.uploadLabel,
        emptyText: section.emptyText,
      });
    } else if (section.kind === 'tabs') {
      renderTabs(ctx, body);
    } else {
      await renderRecords(ctx, body);
      if (section.key === 'honors') await renderLegacyHonors(ctx, root);
    }
  });
}

function buildSectionHeader(sec) {
  const idx = sectionIndex(sec.key);
  const back = createEl('a', { href: './dashboard.html', className: 'btn btn--ghost back-btn no-print' }, [
    icon('chevronRight', { size: 18 }),
    createEl('span', { textContent: 'العودة إلى لوحة التحكم' }),
  ]);
  const prev = SECTIONS[idx - 2];
  const next = SECTIONS[idx];
  const nav = createEl('div', { className: 'section-header__nav no-print' }, [
    back,
    createEl('div', { className: 'section-header__steps' }, [
      prev
        ? createEl('a', { href: `./${prev.page}`, className: 'btn btn--ghost btn--sm', title: prev.title }, [
            icon('chevronRight', { size: 16 }),
            createEl('span', { textContent: 'القسم السابق' }),
          ])
        : null,
      next
        ? createEl('a', { href: `./${next.page}`, className: 'btn btn--ghost btn--sm', title: next.title }, [
            createEl('span', { textContent: 'القسم التالي' }),
            icon('chevronLeft', { size: 16 }),
          ])
        : null,
    ]),
  ]);
  return createEl('section', { className: 'section-header' }, [
    nav,
    createEl('div', { className: 'section-header__main' }, [
      createEl('div', { className: 'section-header__icon' }, [icon(sec.icon, { size: 30 })]),
      createEl('div', { className: 'section-header__text' }, [
        createEl('span', { className: 'section-header__order', textContent: `القسم ${idx} من ${SECTIONS.length}` }),
        createEl('h2', { textContent: sec.title }),
        createEl('p', { textContent: sec.description }),
      ]),
    ]),
  ]);
}

// ---------------------------------------------------------------------
// Tabs (الصفوف الأولية / العليا) — لكل تبويب مدير ملفات مستقل
// ---------------------------------------------------------------------
function renderTabs(ctx, body) {
  const tablist = createEl('div', { className: 'seg-tabs no-print', role: 'tablist', 'aria-label': 'المرحلة' });
  const panels = createEl('div', { className: 'seg-panels' });
  body.append(tablist, panels);

  const state = {};
  const initial = section.tabs.some((t) => `#${t.key}` === location.hash)
    ? location.hash.slice(1)
    : section.tabs[0].key;

  section.tabs.forEach((t) => {
    const btn = createEl('button', {
      type: 'button',
      className: 'seg-tab',
      role: 'tab',
      id: `tab-${t.key}`,
      'aria-controls': `panel-${t.key}`,
      'aria-selected': 'false',
    }, [createEl('span', { textContent: t.label }), createEl('span', { className: 'seg-tab__count' })]);
    const panel = createEl('div', {
      className: 'seg-panel',
      role: 'tabpanel',
      id: `panel-${t.key}`,
      'aria-labelledby': `tab-${t.key}`,
      hidden: true,
    });
    panel.appendChild(createEl('h3', { className: 'seg-panel__title', textContent: `${section.short} — ${t.label}` }));
    btn.addEventListener('click', () => activate(t.key));
    tablist.appendChild(btn);
    panels.appendChild(panel);
    state[t.key] = { btn, panel, manager: null };
  });

  function activate(key) {
    Object.entries(state).forEach(([k, s]) => {
      const on = k === key;
      s.btn.classList.toggle('is-active', on);
      s.btn.setAttribute('aria-selected', on ? 'true' : 'false');
      s.panel.hidden = !on;
    });
    const s = state[key];
    if (!s.manager) {
      s.manager = createFileManager({
        ctx,
        container: s.panel,
        sectionKey: section.key,
        subKey: key,
        uploadLabel: `${section.uploadLabel} (${section.tabs.find((t) => t.key === key).label})`,
        emptyText: section.emptyText,
        onChange: (rows) => {
          s.btn.querySelector('.seg-tab__count').textContent = String(rows.length);
        },
      });
    }
    history.replaceState(null, '', `#${key}`);
  }

  activate(initial);
}

// ---------------------------------------------------------------------
// Records (إعلانات، تقارير، ورش، استطلاعات، تكريمات)
// ---------------------------------------------------------------------
async function renderRecords(ctx, body) {
  let records = [];
  let files = [];

  const toolbar = createEl('div', { className: 'fm-toolbar no-print' });
  const searchWrap = createEl('label', { className: 'search-box' });
  const searchInput = createEl('input', {
    type: 'search',
    className: 'input',
    placeholder: 'ابحثي في العناوين وأسماء الملفات...',
    'aria-label': 'بحث',
  });
  searchWrap.append(icon('search', { size: 18 }), searchInput);
  const sortSel = createEl('select', { className: 'select fm-sort', 'aria-label': 'ترتيب السجلات' }, [
    createEl('option', { value: 'newest', textContent: 'الأحدث أولاً' }),
    createEl('option', { value: 'oldest', textContent: 'الأقدم أولاً' }),
    createEl('option', { value: 'name', textContent: 'حسب العنوان' }),
  ]);
  const countEl = createEl('span', { className: 'fm-count muted' });
  toolbar.append(searchWrap, sortSel, countEl);
  if (ctx.canEdit) {
    const addBtn = createEl('button', { type: 'button', className: 'btn btn--primary btn--upload' }, [
      icon('plus', { size: 18 }),
      createEl('span', { textContent: section.addLabel }),
    ]);
    addBtn.addEventListener('click', () => openRecordForm());
    toolbar.appendChild(addBtn);
  }
  const grid = createEl('div', { className: 'record-grid', 'aria-live': 'polite' });
  body.append(toolbar, grid);

  searchInput.addEventListener('input', render);
  sortSel.addEventListener('change', render);

  function filesOf(recordId) {
    return files.filter((f) => f.record_id === recordId);
  }

  function visible() {
    const q = searchInput.value.trim();
    const list = records.filter((r) => {
      if (!q) return true;
      const texts = [r.title, r.description, r.target_group, r.objective, r.reason, r.honored_group];
      if (texts.some((t) => arabicIncludes(t, q))) return true;
      return filesOf(r.id).some((f) => arabicIncludes(f.title, q) || arabicIncludes(f.original_name, q));
    });
    const key = sortSel.value;
    if (key === 'name') {
      list.sort((a, b) => String(a.title).localeCompare(String(b.title), 'ar'));
    } else {
      const dir = key === 'oldest' ? 1 : -1;
      list.sort((a, b) => dir * (new Date(a.created_at) - new Date(b.created_at)));
    }
    return list;
  }

  async function load() {
    clearElement(grid);
    for (let i = 0; i < 3; i += 1) {
      grid.appendChild(createEl('div', { className: 'record-card record-card--skeleton skeleton' }));
    }
    try {
      const [rec, fl] = await Promise.all([
        listRows('activity_records', {
          filters: [{ column: 'section_key', op: 'eq', value: section.key }],
          orderBy: 'created_at',
          ascending: false,
          from: 0,
          to: 499,
        }),
        listAllSectionFiles(section.key),
      ]);
      records = rec.data;
      files = fl;
      render();
    } catch (err) {
      if (isMissingSchemaError(err)) renderSchemaNotice(grid);
      else {
        clearElement(grid);
        ctx.handleError(err, 'تعذّر تحميل السجلات');
      }
    }
  }

  function render() {
    const list = visible();
    const q = searchInput.value.trim();
    countEl.textContent = q ? `${list.length} من ${records.length}` : `${records.length} ${section.recordLabel}`;
    clearElement(grid);
    if (!list.length) {
      const box = createEl('div', { className: 'fm-empty' }, [
        createEl('div', { className: 'fm-empty__icon' }, [icon(q ? 'search' : section.icon, { size: 34 })]),
        createEl('strong', { textContent: q ? 'لا توجد نتائج مطابقة' : section.emptyText }),
      ]);
      if (!q && ctx.canEdit) {
        const b = createEl('button', { type: 'button', className: 'btn btn--primary' }, [
          icon('plus', { size: 18 }),
          createEl('span', { textContent: section.addLabel }),
        ]);
        b.addEventListener('click', () => openRecordForm());
        box.appendChild(b);
      }
      grid.appendChild(box);
      return;
    }
    list.forEach((r) => grid.appendChild(buildRecordCard(r)));
    const covers = list
      .map((r) => filesOf(r.id).find((f) => f.file_kind === 'image'))
      .filter(Boolean)
      .map((f) => f.storage_path);
    if (covers.length) {
      getThumbUrls(covers).then((urls) => {
        grid.querySelectorAll('[data-cover-path]').forEach((el) => {
          const url = urls[el.dataset.coverPath];
          if (!url) return;
          const img = createEl('img', { alt: '', className: 'record-card__img', src: url });
          img.addEventListener('load', () => {
            clearElement(el);
            el.appendChild(img);
          });
        });
      });
    }
  }

  function fieldChips(r) {
    const chips = [];
    if (r.event_date) chips.push(['calendarSmall', formatDate(r.event_date)]);
    if (r.target_group) chips.push(['users', r.target_group]);
    if (r.honored_group) chips.push(['award', r.honored_group]);
    return chips.map(([ic, text]) =>
      createEl('span', { className: 'meta-chip' }, [icon(ic, { size: 15 }), createEl('span', { textContent: text })])
    );
  }

  function buildRecordCard(r) {
    const rf = filesOf(r.id);
    const cover = rf.find((f) => f.file_kind === 'image');
    const coverEl = createEl('button', {
      type: 'button',
      className: 'record-card__cover',
      'aria-label': `فتح ${r.title}`,
      dataset: cover ? { coverPath: cover.storage_path } : {},
    }, [icon(section.icon, { size: 36 })]);
    coverEl.addEventListener('click', () => openDetails(r));

    const summary = r.description || r.objective || r.reason || '';
    const body = createEl('div', { className: 'record-card__body' }, [
      createEl('h4', { className: 'record-card__title', textContent: r.title }),
      createEl('div', { className: 'record-card__meta' }, fieldChips(r)),
      summary ? createEl('p', { className: 'record-card__desc', textContent: summary }) : null,
      createEl('span', { className: 'meta-chip meta-chip--files' }, [
        icon('paperclip', { size: 15 }),
        createEl('span', { textContent: rf.length ? `${rf.length} مرفق` : 'لا توجد مرفقات' }),
      ]),
    ]);

    const actions = createEl('div', { className: 'file-card__actions' });
    const act = (label, ic, fn, cls = '') => {
      const b = createEl('button', { type: 'button', className: `fc-btn ${cls}` }, [
        icon(ic, { size: 17 }),
        createEl('span', { textContent: label }),
      ]);
      b.addEventListener('click', fn);
      return b;
    };
    actions.appendChild(act('المرفقات', 'folder', () => openDetails(r), 'fc-btn--primary'));
    if (ctx.canEdit) {
      actions.append(
        act('تعديل', 'edit', () => openRecordForm(r)),
        act('حذف', 'trash', () => removeRecord(r), 'fc-btn--danger')
      );
    }
    return createEl('article', { className: 'record-card' }, [coverEl, body, actions]);
  }

  function openRecordForm(row = null) {
    const form = createEl('form', { className: 'form-grid' });
    const inputs = {};
    section.fields.forEach((f) => {
      let el;
      if (f.type === 'textarea') {
        el = createEl('textarea', { className: 'textarea', maxlength: '2000' });
        el.value = row?.[f.name] || '';
      } else {
        el = createEl('input', {
          className: 'input',
          type: f.type === 'date' ? 'date' : 'text',
          maxlength: f.type === 'date' ? null : '200',
          value: row?.[f.name] || '',
        });
      }
      inputs[f.name] = el;
      form.appendChild(field(f.required ? `${f.label} *` : f.label, el));
    });
    if (!row) {
      form.appendChild(
        createEl('p', { className: 'muted', textContent: 'بعد الحفظ ستُفتح نافذة السجل لإرفاق الملفات مباشرة.' })
      );
    }
    const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: 'حفظ' });
    form.appendChild(createEl('div', { className: 'modal__actions' }, [saveBtn]));
    const { close } = openModal({
      title: row ? `تعديل ${section.recordLabel}` : section.addLabel,
      contentNode: form,
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const titleField = section.fields.find((f) => f.name === 'title');
      const err =
        validateRequired(inputs.title.value, titleField.label) ||
        validateLength(inputs.title.value, titleField.label, 1, 200);
      if (err) {
        ctx.showToast(err, 'error');
        return;
      }
      const payload = {};
      section.fields.forEach((f) => {
        const v = String(inputs[f.name].value || '').trim();
        payload[f.name] = v || null;
      });
      setButtonLoading(saveBtn, true);
      try {
        if (row) {
          const updated = await updateRow('activity_records', row.id, payload, 'activity_records');
          records = records.map((x) => (x.id === updated.id ? updated : x));
          ctx.showToast('تم حفظ التعديلات', 'success');
          close();
          render();
        } else {
          const created = await insertRow(
            'activity_records',
            { ...payload, section_key: section.key },
            'activity_records'
          );
          records = [created, ...records];
          ctx.showToast('تم الحفظ — يمكنك الآن إرفاق الملفات', 'success');
          close();
          render();
          openDetails(created);
        }
      } catch (error) {
        ctx.handleError(error);
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  function openDetails(r) {
    const wrap = createEl('div', { className: 'record-details' });
    const dl = createEl('dl', { className: 'record-details__fields' });
    section.fields.forEach((f) => {
      if (f.name === 'title') return;
      const v = r[f.name];
      dl.append(
        createEl('dt', { textContent: f.label }),
        createEl('dd', { textContent: v ? (f.type === 'date' ? formatDate(v) : v) : '—' })
      );
    });
    wrap.appendChild(dl);
    const filesBox = createEl('div', { className: 'record-details__files' });
    wrap.append(createEl('h3', { className: 'section__title', textContent: 'المرفقات' }), filesBox);
    const { modal } = openModal({ title: r.title, contentNode: wrap });
    modal.classList.add('modal--xl');

    createFileManager({
      ctx,
      container: filesBox,
      sectionKey: section.key,
      recordId: r.id,
      categories: section.categories || [],
      uploadLabel: 'إرفاق ملفات',
      emptyText: 'لا توجد مرفقات لهذا السجل بعد',
      onChange: (rows) => {
        files = [...files.filter((f) => f.record_id !== r.id), ...rows];
        render();
      },
    });
  }

  async function removeRecord(r) {
    const rf = filesOf(r.id);
    const ok = await confirmDialog({
      title: `حذف ${section.recordLabel}`,
      message: `سيتم حذف «${r.title}»${rf.length ? ` مع ${rf.length} مرفق من التخزين` : ''} نهائياً ولا يمكن التراجع. هل تريدين المتابعة؟`,
      confirmText: 'نعم، احذف',
      cancelText: 'تراجع',
      danger: true,
    });
    if (!ok) return;
    try {
      if (rf.length) await deleteSectionFiles(rf);
      await deleteRow('activity_records', r.id, 'activity_records');
      records = records.filter((x) => x.id !== r.id);
      files = files.filter((f) => f.record_id !== r.id);
      ctx.showToast('تم الحذف', 'success');
      render();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  await load();
}

// ---------------------------------------------------------------------
// التكريمات السابقة (جدول honors القديم) — عرض فقط دون تعديل أو نقل
// ---------------------------------------------------------------------
async function renderLegacyHonors(ctx, root) {
  const details = createEl('details', { className: 'legacy-panel' });
  const summary = createEl('summary', {}, [
    icon('archive', { size: 20 }),
    createEl('span', { textContent: 'التكريمات المسجلة سابقاً (السجل القديم)' }),
    createEl('span', { className: 'legacy-panel__count muted' }),
  ]);
  const body = createEl('div', { className: 'legacy-panel__body' });
  details.append(summary, body);
  root.appendChild(details);

  body.appendChild(
    createEl('p', { className: 'muted' }, [
      'هذه بيانات قسم التكريم السابق كما هي دون أي تعديل. للتعديل عليها افتحي ',
      createEl('a', { href: './honors.html', className: 'link', textContent: 'صفحة التكريم السابقة' }),
      '.',
    ])
  );
  const list = createEl('div', { className: 'record-grid' });
  body.appendChild(list);

  try {
    const res = await listRows('honors', { orderBy: 'created_at', ascending: false, from: 0, to: 199 });
    summary.querySelector('.legacy-panel__count').textContent = `(${res.count})`;
    if (!res.data.length) {
      list.appendChild(createEl('div', { className: 'fm-empty' }, [createEl('strong', { textContent: 'لا توجد تكريمات سابقة' })]));
      return;
    }
    let loadedFiles = false;
    const cards = res.data.map((h) => {
      const filesRow = createEl('div', { className: 'legacy-files' });
      const card = createEl('article', { className: 'record-card record-card--compact' }, [
        createEl('div', { className: 'record-card__body' }, [
          createEl('h4', { className: 'record-card__title', textContent: h.recipient_name }),
          createEl('div', { className: 'record-card__meta' }, [
            createEl('span', { className: 'meta-chip', textContent: recipientTypeLabel(h.recipient_type) }),
            h.honor_date
              ? createEl('span', { className: 'meta-chip' }, [icon('calendarSmall', { size: 15 }), createEl('span', { textContent: formatDate(h.honor_date) })])
              : null,
          ]),
          h.reason ? createEl('p', { className: 'record-card__desc', textContent: h.reason }) : null,
          filesRow,
        ]),
      ]);
      return { h, card, filesRow };
    });
    cards.forEach((c) => list.appendChild(c.card));

    details.addEventListener('toggle', async () => {
      if (!details.open || loadedFiles) return;
      loadedFiles = true;
      for (const c of cards) {
        try {
          const hf = await fetchChildren('honor_files', 'honor_id', c.h.id);
          const mapped = hf.map((f) => ({
            id: f.id,
            storage_path: f.file_path,
            original_name: f.file_name,
            title: f.file_name,
            file_kind: f.file_type === 'pdf' ? 'pdf' : mimeToFileType(f.mime_type) === 'image' ? 'image' : 'pdf',
            file_size: f.file_size,
          }));
          if (!mapped.length) {
            c.filesRow.appendChild(createEl('span', { className: 'muted', textContent: 'لا توجد شواهد' }));
            continue;
          }
          const previewable = mapped.filter(canPreviewInline);
          mapped.forEach((m) => {
            const b = createEl('button', { type: 'button', className: 'fc-btn' }, [
              icon(m.file_kind === 'image' ? 'image' : 'file', { size: 16 }),
              createEl('span', { dir: 'auto', textContent: m.original_name }),
            ]);
            b.addEventListener('click', () => openFilePreview(m, { list: previewable }));
            const d = createEl('button', { type: 'button', className: 'fc-btn', 'aria-label': `تحميل ${m.original_name}` }, [icon('download', { size: 16 })]);
            d.addEventListener('click', async () => {
              try {
                await downloadSectionFile(m);
              } catch (err) {
                ctx.handleError(err);
              }
            });
            c.filesRow.append(b, d);
          });
        } catch (err) {
          ctx.handleError(err);
        }
      }
    });
  } catch (err) {
    ctx.handleError(err, 'تعذّر تحميل التكريمات السابقة');
  }
}