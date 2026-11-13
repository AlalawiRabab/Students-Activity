/**
 * parents-eyes.js — «بعيون أهالينا» للعامة: المناسبات والمشاركات المعتمدة فقط
 * ?event=<id> يعرض صفحة المناسبة
 */
import { bootPublicPage } from './app.js';
import { isFeatureManager } from './auth.js';
import {
  listEvents,
  getEvent,
  listApprovedPosts,
  approvedCounts,
  imageObjectUrl,
} from './parents-service.js';
import { lazyImage, postGallery } from './parents-ui.js';
import { isMissingSchemaError } from './file-manager.js';
import { createEl, formatDate, logDev } from './utils.js';
import { icon } from './icons.js';

const UUID_RE = /^[0-9a-f-]{36}$/i;

bootPublicPage({ title: 'بعيون أهالينا' }, async (ctx) => {
  const root = ctx.content;
  ctx.canEdit = ctx.canEdit && (await isFeatureManager());
  const eventId = new URLSearchParams(location.search).get('event');
  try {
    if (eventId && UUID_RE.test(eventId)) await renderEvent(ctx, root, eventId);
    else await renderEvents(ctx, root);
  } catch (err) {
    logDev(err);
    root.appendChild(
      createEl('div', { className: 'fm-empty' }, [
        createEl('strong', {
          textContent: isMissingSchemaError(err)
            ? 'قسم «بعيون أهالينا» غير مفعّل بعد'
            : 'تعذّر تحميل المحتوى، حاول لاحقاً',
        }),
      ])
    );
  }
});

function pageHeader(ctx) {
  return createEl('section', { className: 'pub-page-head' }, [
    createEl('span', { className: 'pub-page-head__icon' }, [icon('heart', { size: 30 })]),
    createEl('div', { className: 'pub-page-head__text' }, [
      createEl('h1', { textContent: 'بعيون أهالينا' }),
      createEl('p', {
        textContent:
          'مشاركات أولياء الأمور عن أنشطة المدرسة ومناسباتها. تُنشر المشاركات بعد مراجعتها واعتمادها من رائدة النشاط.',
      }),
    ]),
    createEl('div', { className: 'pub-page-head__actions' }, [
      createEl('a', { href: './parents-share.html', className: 'btn btn--primary' }, [
        icon('camera', { size: 18 }),
        createEl('span', { textContent: 'أرسل مشاركتك' }),
      ]),
      ctx.canEdit
        ? createEl('a', { href: './parents-eyes-admin.html', className: 'btn btn--ghost' }, [
            icon('settings', { size: 18 }),
            createEl('span', { textContent: 'إدارة المشاركات' }),
          ])
        : null,
    ]),
  ]);
}

function openChip(ev) {
  return createEl('span', {
    className: `chip ${ev.is_open ? 'chip--open' : 'chip--closed'}`,
    textContent: ev.is_open ? 'تستقبل المشاركات' : 'الاستقبال مغلق',
  });
}

function cover(ev, className) {
  if (!ev.cover_path) {
    return createEl('div', { className: `${className} ${className}--empty` }, [icon('camera', { size: 34 })]);
  }
  return lazyImage({ getUrl: () => imageObjectUrl(ev.cover_path), className, alt: '' });
}

async function renderEvents(ctx, root) {
  root.appendChild(pageHeader(ctx));
  const grid = createEl('div', { className: 'pe-event-grid', 'aria-live': 'polite' });
  root.appendChild(grid);
  for (let i = 0; i < 3; i += 1) grid.appendChild(createEl('div', { className: 'pe-event-card skeleton' }));

  const [events, counts] = await Promise.all([listEvents(), approvedCounts()]);
  grid.replaceChildren();
  if (!events.length) {
    grid.appendChild(createEl('div', { className: 'fm-empty' }, [
      createEl('div', { className: 'fm-empty__icon' }, [icon('heart', { size: 30 })]),
      createEl('strong', { textContent: 'لا توجد مناسبات بعد' }),
    ]));
    return;
  }
  events.forEach((ev) => {
    const n = counts[ev.id] || 0;
    grid.appendChild(
      createEl('a', { href: `./parents-eyes.html?event=${encodeURIComponent(ev.id)}`, className: 'pe-event-card' }, [
        cover(ev, 'pe-event-card__cover'),
        createEl('div', { className: 'pe-event-card__body' }, [
          createEl('h2', { className: 'pe-event-card__title', textContent: ev.title }),
          ev.description ? createEl('p', { className: 'pe-event-card__desc', textContent: ev.description }) : null,
          createEl('div', { className: 'pe-event-card__meta' }, [
            openChip(ev),
            createEl('span', { className: 'muted', textContent: n ? `${n} مشاركة منشورة` : 'لا توجد مشاركات منشورة بعد' }),
          ]),
        ]),
      ])
    );
  });
}

async function renderEvent(ctx, root, eventId) {
  const ev = await getEvent(eventId);
  root.appendChild(
    createEl('a', { href: './parents-eyes.html', className: 'btn btn--ghost back-btn' }, [
      icon('chevronRight', { size: 18 }),
      createEl('span', { textContent: 'كل المناسبات' }),
    ])
  );
  if (!ev) {
    root.appendChild(createEl('div', { className: 'fm-empty' }, [createEl('strong', { textContent: 'المناسبة غير موجودة' })]));
    return;
  }
  document.title = `${ev.title} | بعيون أهالينا`;

  root.appendChild(
    createEl('section', { className: 'pe-event-head' }, [
      cover(ev, 'pe-event-head__cover'),
      createEl('div', { className: 'pe-event-head__body' }, [
        createEl('span', { className: 'pe-kicker', textContent: 'بعيون أهالينا' }),
        createEl('h1', { textContent: ev.title }),
        ev.description ? createEl('p', { className: 'pe-event-head__desc', textContent: ev.description }) : null,
        createEl('div', { className: 'row-actions' }, [
          openChip(ev),
          ev.is_open
            ? createEl('a', {
                href: `./parents-share.html?event=${encodeURIComponent(ev.id)}`,
                className: 'btn btn--primary btn--sm',
              }, [icon('camera', { size: 16 }), createEl('span', { textContent: 'شارك في هذه المناسبة' })])
            : null,
        ]),
      ]),
    ])
  );

  const list = createEl('div', { className: 'pe-post-grid', 'aria-live': 'polite' });
  root.appendChild(list);
  const posts = await listApprovedPosts(ev.id);
  if (!posts.length) {
    list.appendChild(createEl('div', { className: 'fm-empty' }, [
      createEl('div', { className: 'fm-empty__icon' }, [icon('camera', { size: 30 })]),
      createEl('strong', { textContent: 'لا توجد مشاركات منشورة لهذه المناسبة بعد' }),
    ]));
    return;
  }
  posts.forEach((p) => list.appendChild(postCard(p, ev)));
}

function postCard(post, ev) {
  const author = post.author_name || 'ولي أمر';
  return createEl('article', { className: 'pe-post' }, [
    postGallery(post.images, {
      getUrl: (img) => imageObjectUrl(img.storage_path),
      caption: `${ev.title} — ${author}`,
    }),
    createEl('div', { className: 'pe-post__body' }, [
      post.comment ? createEl('p', { className: 'pe-post__comment', dir: 'auto', textContent: post.comment }) : null,
      createEl('div', { className: 'pe-post__meta' }, [
        createEl('strong', { dir: 'auto', textContent: author }),
        createEl('span', { className: 'muted', textContent: formatDate(post.published_at) }),
      ]),
    ]),
  ]);
}
