/**
 * section-page.js — صفحة قسم موحّدة: مكتبة ملفات لكل قسم من الأقسام الـ 12
 * كل صفحة HTML تحدد القسم عبر <body data-section="...">
 */
import { bootProtectedPage } from './app.js';
import { getSection, sectionIndex, SECTIONS, UPLOAD_LABEL } from './sections-config.js';
import { createFileManager } from './file-manager.js';
import { createEl } from './utils.js';
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
    }
  });
}

function buildSectionHeader(sec) {
  const idx = sectionIndex(sec.key);
  const back = createEl('a', { href: './index.html', className: 'btn btn--ghost back-btn no-print' }, [
    icon('chevronRight', { size: 18 }),
    createEl('span', { textContent: 'العودة إلى الرئيسية' }),
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
