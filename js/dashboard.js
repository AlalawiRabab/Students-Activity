/**
 * dashboard.js — لوحة التحكم: أقسام السجل الإلكتروني الـ 12 بالترتيب مع عدد الملفات
 */
import { bootProtectedPage } from './app.js';
import { getSupabase } from './supabase-client.js';
import { SECTIONS, PLATFORM_PAGES } from './sections-config.js';
import { fetchSectionFileCounts, isMissingSchemaError, renderSchemaNotice } from './file-manager.js';
import { createEl, logDev } from './utils.js';
import { icon } from './icons.js';

bootProtectedPage({ title: 'لوحة التحكم' }, async (ctx) => {
  const root = ctx.content;

  root.appendChild(
    createEl('section', { className: 'hero-panel hero-panel--brand' }, [
      createEl('img', {
        className: 'hero-panel__logo',
        src: './assets/images/school-logo.png',
        alt: 'شعار المدرسة',
        width: '64',
        height: '64',
      }),
      createEl('div', {}, [
        createEl('h2', { textContent: ctx.settings.platform_name || 'منصة النشاط الطلابي' }),
        createEl('p', {
          textContent: `رائدة النشاط / ${ctx.settings.leader_name || 'إيمان الرحيلي'}`,
        }),
        createEl('p', {
          className: 'hero-panel__sub',
          textContent: 'السجل الإلكتروني المتكامل لرائدة النشاط — اختاري القسم لعرض ملفاته أو إضافة ملفات جديدة.',
        }),
      ]),
    ])
  );

  const notice = createEl('div');
  root.appendChild(notice);

  const summary = createEl('div', { className: 'dash-summary' });
  root.appendChild(summary);

  const grid = createEl('section', { className: 'section-grid', 'aria-label': 'أقسام السجل الإلكتروني' });
  const countEls = {};
  SECTIONS.forEach((s, i) => {
    const count = createEl('span', { className: 'section-card__count is-loading', textContent: '…' });
    countEls[s.key] = count;
    grid.appendChild(
      createEl('a', { href: `./${s.page}`, className: 'section-card' }, [
        createEl('div', { className: 'section-card__top' }, [
          createEl('span', { className: 'section-card__num', textContent: String(i + 1) }),
          createEl('span', { className: 'section-card__icon' }, [icon(s.icon, { size: 26 })]),
        ]),
        createEl('h3', { className: 'section-card__title', textContent: s.title }),
        createEl('p', { className: 'section-card__desc', textContent: s.description }),
        createEl('div', { className: 'section-card__foot' }, [
          createEl('span', { className: 'section-card__files' }, [
            icon('paperclip', { size: 16 }),
            count,
            createEl('span', { textContent: 'ملف' }),
          ]),
          createEl('span', { className: 'section-card__go' }, [
            createEl('span', { textContent: 'فتح القسم' }),
            icon('chevronLeft', { size: 16 }),
          ]),
        ]),
      ])
    );
  });
  root.appendChild(grid);

  const pendingEl = createEl('span', { className: 'platform-link__badge', hidden: true });
  const platform = createEl('section', { className: 'section platform-links' }, [
    createEl('h3', { className: 'section__title', textContent: 'أقسام المنصة' }),
    createEl(
      'div',
      { className: 'platform-links__grid' },
      PLATFORM_PAGES.map((p) =>
        createEl('a', { href: p.href, className: 'platform-link' }, [
          createEl('span', { className: 'platform-link__icon' }, [icon(p.icon, { size: 22 })]),
          createEl('span', { className: 'platform-link__label', textContent: p.label }),
          p.key === 'parents' ? pendingEl : null,
        ])
      )
    ),
  ]);
  root.appendChild(platform);

  getSupabase()
    .from('parent_posts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'pending')
    .then(({ count, error }) => {
      if (error || !count) return;
      pendingEl.textContent = `${count} بانتظار المراجعة`;
      pendingEl.hidden = false;
    });

  let counts = null;
  try {
    counts = await fetchSectionFileCounts();
  } catch (err) {
    logDev(err);
    if (isMissingSchemaError(err)) renderSchemaNotice(notice);
    else ctx.handleError(err, 'تعذّر تحميل عدد الملفات');
  }

  let total = 0;
  SECTIONS.forEach((s) => {
    const el = countEls[s.key];
    el.classList.remove('is-loading');
    if (!counts) {
      el.textContent = '—';
      return;
    }
    const n = counts[s.key] || 0;
    total += n;
    el.textContent = String(n);
    el.closest('.section-card').classList.toggle('is-empty', n === 0);
  });

  if (counts) {
    const filled = SECTIONS.filter((s) => (counts[s.key] || 0) > 0).length;
    summary.append(
      createEl('div', { className: 'stat-card' }, [
        createEl('div', { className: 'stat-card__label', textContent: 'إجمالي الملفات في السجل' }),
        createEl('div', { className: 'stat-card__value', textContent: String(total) }),
      ]),
      createEl('div', { className: 'stat-card' }, [
        createEl('div', { className: 'stat-card__label', textContent: 'أقسام تحتوي ملفات' }),
        createEl('div', { className: 'stat-card__value', textContent: `${filled} / ${SECTIONS.length}` }),
      ])
    );
  }
});
