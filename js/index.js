/**
 * index.js — الواجهة العامة الترحيبية (بدون تسجيل دخول)
 */
import { bootPublicPage } from './app.js';
import { listEvents } from './parents-service.js';
import { createEl, logDev } from './utils.js';
import { icon } from './icons.js';

bootPublicPage({ title: 'الرئيسية' }, async (ctx) => {
  const root = ctx.content;
  const leader = ctx.canEdit;

  root.appendChild(
    createEl('section', { className: 'pub-hero' }, [
      createEl('img', {
        className: 'pub-hero__logo',
        src: './assets/images/school-logo.png',
        alt: 'شعار المدرسة',
        width: '120',
        height: '120',
      }),
      createEl('h1', { className: 'pub-hero__title', textContent: ctx.settings.platform_name }),
      createEl('p', { className: 'pub-hero__leader', textContent: `رائدة النشاط / ${ctx.settings.leader_name}` }),
      createEl('p', {
        className: 'pub-hero__intro',
        textContent:
          'أهلاً بكم في منصة النشاط الطلابي. تابعوا مسابقات المدرسة، وشاركونا صوركم وانطباعاتكم عن أنشطتها ومناسباتها في «بعيون أهالينا».',
      }),
      createEl('div', { className: 'pub-hero__actions' }, [
        createEl('a', { href: './parents-share.html', className: 'btn btn--primary btn--lg' }, [
          icon('camera', { size: 20 }),
          createEl('span', { textContent: 'شاركونا في «بعيون أهالينا»' }),
        ]),
        createEl('a', { href: './competitions.html', className: 'btn btn--ghost btn--lg' }, [
          icon('trophy', { size: 20 }),
          createEl('span', { textContent: 'المسابقات' }),
        ]),
      ]),
    ])
  );

  root.appendChild(
    createEl('section', { className: 'pub-cards', 'aria-label': 'أقسام المنصة العامة' }, [
      featureCard({
        href: './parents-eyes.html',
        iconName: 'heart',
        title: 'بعيون أهالينا',
        text: 'مشاركات أولياء الأمور المعتمدة عن أنشطة المدرسة ومناسباتها، ونموذج مشاركة دون حساب.',
        cta: 'تصفح المشاركات',
      }),
      featureCard({
        href: './competitions.html',
        iconName: 'trophy',
        title: 'المسابقات',
        text: 'إعلانات المسابقات وملفاتها: استعراض وتنزيل مباشرة.',
        cta: 'عرض المسابقات',
      }),
      featureCard({
        href: leader ? './dashboard.html' : './login.html',
        iconName: leader ? 'home' : 'lock',
        title: leader ? 'لوحة التحكم' : 'دخول رائدة النشاط',
        text: leader
          ? 'العودة إلى السجل الإلكتروني وإدارة المحتوى.'
          : 'تسجيل الدخول الإداري الخاص برائدة النشاط لإدارة المنصة.',
        cta: leader ? 'فتح لوحة التحكم' : 'تسجيل الدخول',
        variant: 'leader',
      }),
    ])
  );

  const openWrap = createEl('section', { className: 'pub-section', hidden: true });
  root.appendChild(openWrap);
  try {
    const events = await listEvents({ openOnly: true });
    if (!events.length) return;
    openWrap.hidden = false;
    openWrap.append(
      createEl('h2', { className: 'pub-section__title' }, [
        icon('camera', { size: 20 }),
        createEl('span', { textContent: 'مناسبات تستقبل مشاركاتكم الآن' }),
      ]),
      createEl(
        'div',
        { className: 'pub-open-list' },
        events.slice(0, 6).map((ev) =>
          createEl('article', { className: 'pub-open-item' }, [
            createEl('div', { className: 'pub-open-item__text' }, [
              createEl('strong', { textContent: ev.title }),
              ev.description ? createEl('p', { className: 'muted', textContent: ev.description }) : null,
            ]),
            createEl('div', { className: 'row-actions' }, [
              createEl('a', {
                href: `./parents-share.html?event=${encodeURIComponent(ev.id)}`,
                className: 'btn btn--primary btn--sm',
                textContent: 'شارك الآن',
              }),
              createEl('a', {
                href: `./parents-eyes.html?event=${encodeURIComponent(ev.id)}`,
                className: 'btn btn--ghost btn--sm',
                textContent: 'المشاركات',
              }),
            ]),
          ])
        )
      )
    );
  } catch (err) {
    logDev('open events', err);
  }
});

function featureCard({ href, iconName, title, text, cta, variant = '' }) {
  return createEl('a', { href, className: `pub-card${variant ? ` pub-card--${variant}` : ''}` }, [
    createEl('span', { className: 'pub-card__icon' }, [icon(iconName, { size: 28 })]),
    createEl('h2', { className: 'pub-card__title', textContent: title }),
    createEl('p', { className: 'pub-card__text', textContent: text }),
    createEl('span', { className: 'pub-card__cta' }, [
      createEl('span', { textContent: cta }),
      icon('chevronLeft', { size: 16 }),
    ]),
  ]);
}
