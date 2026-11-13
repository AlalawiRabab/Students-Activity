/**
 * public-shell.js — هيكل الصفحات العامة (بدون قائمة الإدارة)
 * الزائر يتصفح المحتوى العام ويشارك في «بعيون أهالينا» دون تسجيل دخول.
 */
import { createEl, clearElement } from './utils.js';
import { initTheme, toggleTheme } from './ui.js';
import { canEdit } from './auth.js';
import { icon } from './icons.js';

export const PUBLIC_NAV = Object.freeze([
  { href: './index.html', label: 'الرئيسية', icon: 'home' },
  { href: './parents-eyes.html', label: 'بعيون أهالينا', icon: 'heart' },
  { href: './competitions.html', label: 'المسابقات', icon: 'trophy' },
]);

function currentFile() {
  return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
}

/**
 * @param {{ settings: object, auth: object|null, activeHref?: string }} opts
 * @returns {{ content: HTMLElement }}
 */
export function mountPublicShell({ settings, auth, activeHref }) {
  initTheme();
  const app = document.getElementById('app');
  clearElement(app);
  app.className = 'app--public';

  const active = (activeHref || currentFile()).replace('./', '').toLowerCase();
  const header = createEl('header', { className: 'pub-header' });
  const brand = createEl('a', { href: './index.html', className: 'pub-brand' }, [
    createEl('img', {
      className: 'pub-brand__logo',
      src: './assets/images/school-logo.png',
      alt: 'شعار المدرسة',
      width: '52',
      height: '52',
    }),
    createEl('span', { className: 'pub-brand__text' }, [
      createEl('strong', { textContent: settings.platform_name }),
      createEl('span', { textContent: `رائدة النشاط / ${settings.leader_name}` }),
    ]),
  ]);

  const nav = createEl('nav', { className: 'pub-nav', id: 'pub-nav', 'aria-label': 'روابط المنصة' });
  PUBLIC_NAV.forEach((l) => {
    const isActive = l.href.replace('./', '') === active;
    nav.appendChild(
      createEl('a', {
        href: l.href,
        className: `pub-nav__link${isActive ? ' is-active' : ''}`,
        'aria-current': isActive ? 'page' : null,
      }, [icon(l.icon, { size: 18 }), createEl('span', { textContent: l.label })])
    );
  });

  const leader = auth && canEdit(auth.profile);
  const leaderBtn = createEl('a', {
    href: leader ? './dashboard.html' : './login.html',
    className: 'btn btn--primary pub-leader-btn',
  }, [
    icon(leader ? 'home' : 'login', { size: 18 }),
    createEl('span', { textContent: leader ? 'لوحة التحكم' : 'دخول رائدة النشاط' }),
  ]);
  nav.appendChild(leaderBtn.cloneNode(true));

  const themeBtn = createEl('button', {
    type: 'button',
    className: 'icon-btn',
    'aria-label': 'تبديل الوضع الليلي',
    title: 'الوضع الليلي',
  }, [icon('moon', { size: 20 })]);
  themeBtn.addEventListener('click', toggleTheme);

  const menuBtn = createEl('button', {
    type: 'button',
    className: 'icon-btn pub-menu-toggle',
    'aria-label': 'القائمة',
    'aria-controls': 'pub-nav',
    'aria-expanded': 'false',
  }, [icon('menu', { size: 22 })]);
  menuBtn.addEventListener('click', () => {
    const open = header.classList.toggle('is-open');
    menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  });

  const actions = createEl('div', { className: 'pub-actions' }, [themeBtn, leaderBtn, menuBtn]);
  header.append(brand, nav, actions);

  const content = createEl('main', { className: 'pub-main', id: 'page-content' });
  const footer = createEl('footer', { className: 'pub-footer' }, [
    createEl('span', { textContent: `${settings.platform_name} — رائدة النشاط / ${settings.leader_name}` }),
  ]);
  app.append(header, content, footer);
  return { content };
}
