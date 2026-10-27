/**
 * section-page.js — صفحة قسم موحّدة: مكتبة ملفات لكل قسم من الأقسام الـ 12
 * كل صفحة HTML تحدد القسم عبر <body data-section="...">
 */
import { bootProtectedPage } from './app.js';
import { getSection, sectionIndex, SECTIONS, UPLOAD_LABEL } from './sections-config.js';
import {
  createFileManager,
  openFilePreview,
  downloadSectionFile,
  canPreviewInline,
} from './file-manager.js';
import { listRows, fetchChildren } from './supabase-service.js';
import { createEl, formatDate, recipientTypeLabel, mimeToFileType } from './utils.js';
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

    if (section.kind === 'tabs') {
      renderTabs(ctx, body);
    } else {
      createFileManager({
        ctx,
        container: body,
        sectionKey: section.key,
        includeRecordFiles: section.kind === 'records',
        uploadLabel: UPLOAD_LABEL,
        emptyText: section.emptyText,
      });
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
        uploadLabel: `${UPLOAD_LABEL} (${section.tabs.find((t) => t.key === key).label})`,
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