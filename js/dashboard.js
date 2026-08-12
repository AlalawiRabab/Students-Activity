/**
 * dashboard.js
 */
import { bootProtectedPage } from './app.js';
import { countRows, listRows } from './supabase-service.js';
import { createEl, clearElement, formatDate } from './utils.js';
import { renderEmpty } from './ui.js';

const LINKS = [
  { href: './elementary-calendar.html', title: 'خطة النشاط للصفوف الأولية', desc: 'تقويم شهري للأنشطة' },
  { href: './upper-calendar.html', title: 'خطة النشاط للصفوف العليا', desc: 'تقويم منفصل للصفوف العليا' },
  { href: './programs.html', title: 'البرامج والأنشطة', desc: 'النشاط الصفي واللاصفي' },
  { href: './schedule.html', title: 'جدول حصص النشاط', desc: 'رفع ومعاينة الجداول' },
  { href: './competitions.html', title: 'المسابقات', desc: 'المسابقات والشواهد' },
  { href: './honors.html', title: 'التكريم', desc: 'تكريم الطالبات والمعلمات' },
  { href: './gallery.html', title: 'معرض النشاط', desc: 'صور الفعاليات' },
];

bootProtectedPage({ title: 'الرئيسية' }, async (ctx) => {
  const root = ctx.content;

  const hero = createEl('section', { className: 'hero-panel' }, [
    createEl('h2', { textContent: ctx.settings.platform_name || 'منصة النشاط الطلابي' }),
    createEl('p', {
      textContent: `رائدة النشاط / ${ctx.settings.leader_name || 'إيمان الرحيلي'}`,
    }),
  ]);
  root.appendChild(hero);

  const stats = createEl('section', { className: 'stat-grid', 'aria-label': 'إحصائيات' });
  root.appendChild(stats);

  const cards = createEl('section', { className: 'dash-grid', 'aria-label': 'أقسام المنصة' });
  LINKS.forEach((item) => {
    const a = createEl('a', { href: item.href, className: 'dash-card' });
    a.append(
      createEl('h3', { textContent: item.title }),
      createEl('p', { textContent: item.desc })
    );
    cards.appendChild(a);
  });
  root.appendChild(cards);

  const recent = createEl('section', { className: 'section' });
  recent.appendChild(createEl('h3', { className: 'section__title', textContent: 'آخر التحديثات' }));
  const recentGrid = createEl('div', { className: 'dash-grid' });
  recent.appendChild(recentGrid);
  root.appendChild(recent);

  try {
    const [classroom, extra, competitions, honors, gallery] = await Promise.all([
      countRows('classroom_programs'),
      countRows('extracurricular_programs'),
      countRows('competitions'),
      countRows('honors'),
      countRows('gallery'),
    ]);

    const defs = [
      { label: 'عدد البرامج', value: classroom + extra },
      { label: 'عدد المسابقات', value: competitions },
      { label: 'عدد التكريمات', value: honors },
      { label: 'عدد صور المعرض', value: gallery },
    ];

    clearElement(stats);
    defs.forEach((d) => {
      const card = createEl('article', { className: 'stat-card' });
      card.append(
        createEl('div', { className: 'stat-card__label', textContent: d.label }),
        createEl('div', { className: 'stat-card__value', textContent: String(d.value) })
      );
      stats.appendChild(card);
    });

    const [lastPrograms, lastCompetitions, lastHonors] = await Promise.all([
      listRows('classroom_programs', { to: 4, orderBy: 'created_at' }),
      listRows('competitions', { to: 4, orderBy: 'created_at' }),
      listRows('honors', { to: 4, orderBy: 'created_at' }),
    ]);

    clearElement(recentGrid);
    recentGrid.append(
      buildRecent('آخر البرامج', lastPrograms.data, (r) => r.program_name, (r) => r.execution_date),
      buildRecent(
        'آخر المسابقات',
        lastCompetitions.data,
        (r) => r.competition_name,
        (r) => r.competition_date
      ),
      buildRecent(
        'آخر التكريمات',
        lastHonors.data,
        (r) => r.recipient_name,
        (r) => r.honor_date
      )
    );
  } catch (err) {
    ctx.handleError(err);
  }
});

function buildRecent(title, rows, nameFn, dateFn) {
  const box = createEl('div', { className: 'card', style: 'padding:1rem' });
  box.appendChild(createEl('h3', { className: 'section__title', textContent: title }));
  if (!rows.length) {
    renderEmpty(box, 'لا توجد بيانات بعد');
    return box;
  }
  const list = createEl('div', { className: 'list-block' });
  rows.forEach((r) => {
    const item = createEl('div', { className: 'list-item' });
    item.append(
      createEl('strong', { textContent: nameFn(r) || '—' }),
      createEl('span', { textContent: formatDate(dateFn(r)) })
    );
    list.appendChild(item);
  });
  box.appendChild(list);
  return box;
}
