/**
 * ui.js — Toast, Modal, Layout, Theme
 */
import { createEl, clearElement, logDev } from './utils.js';
import { canEdit, isAdmin, logout } from './auth.js';
import { userMessageFromError } from './supabase-service.js';

const THEME_KEY = 'sap-theme';

const NAV_ITEMS = [
  { href: './dashboard.html', id: 'dashboard', label: 'الرئيسية' },
  { href: './elementary-calendar.html', id: 'elementary', label: 'خطة الصفوف الأولية' },
  { href: './upper-calendar.html', id: 'upper', label: 'خطة الصفوف العليا' },
  { href: './programs.html', id: 'programs', label: 'البرامج والأنشطة' },
  { href: './schedule.html', id: 'schedule', label: 'جدول حصص النشاط' },
  { href: './competitions.html', id: 'competitions', label: 'المسابقات' },
  { href: './honors.html', id: 'honors', label: 'التكريم' },
  { href: './gallery.html', id: 'gallery', label: 'معرض النشاط' },
  { href: './settings.html', id: 'settings', label: 'الإعدادات' },
];

export function applyTheme(theme) {
  const t = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem(THEME_KEY, t);
}

export function initTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === 'dark' || saved === 'light') applyTheme(saved);
  else applyTheme('light');
}

export function toggleTheme() {
  const cur = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  applyTheme(cur === 'dark' ? 'light' : 'dark');
}

export function showToast(message, type = 'info') {
  let host = document.getElementById('toast-host');
  if (!host) {
    host = createEl('div', { id: 'toast-host', className: 'toast-host', 'aria-live': 'polite' });
    document.body.appendChild(host);
  }
  const el = createEl('div', {
    className: `toast toast--${type}`,
    role: 'status',
    textContent: message,
  });
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('toast--out');
    setTimeout(() => el.remove(), 280);
  }, 3200);
}

export function handleError(err, fallback = 'حدث خطأ') {
  logDev(err);
  showToast(userMessageFromError(err) || fallback, 'error');
}

export function confirmDialog({
  title = 'تأكيد',
  message = 'هل أنت متأكد؟',
  confirmText = 'تأكيد',
  cancelText = 'إلغاء',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const overlay = createEl('div', {
      className: 'modal-overlay',
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': 'confirm-title',
    });
    const modal = createEl('div', { className: 'modal' });
    const h = createEl('h2', { id: 'confirm-title', className: 'modal__title', textContent: title });
    const p = createEl('p', { className: 'modal__body', textContent: message });
    const actions = createEl('div', { className: 'modal__actions' });
    const cancelBtn = createEl('button', {
      type: 'button',
      className: 'btn btn--ghost',
      textContent: cancelText,
    });
    const okBtn = createEl('button', {
      type: 'button',
      className: danger ? 'btn btn--danger' : 'btn btn--primary',
      textContent: confirmText,
    });

    const close = (val) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') close(false);
    };

    cancelBtn.addEventListener('click', () => close(false));
    okBtn.addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
    document.addEventListener('keydown', onKey);

    actions.append(cancelBtn, okBtn);
    modal.append(h, p, actions);
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    okBtn.focus();
  });
}

export function openModal({ title, contentNode, onClose }) {
  const overlay = createEl('div', {
    className: 'modal-overlay',
    role: 'dialog',
    'aria-modal': 'true',
  });
  const modal = createEl('div', { className: 'modal modal--lg' });
  const head = createEl('div', { className: 'modal__head' });
  const h = createEl('h2', { className: 'modal__title', textContent: title || '' });
  const closeBtn = createEl('button', {
    type: 'button',
    className: 'icon-btn',
    'aria-label': 'إغلاق',
    textContent: '×',
  });
  const body = createEl('div', { className: 'modal__body' });
  if (contentNode) body.appendChild(contentNode);

  const close = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
    if (typeof onClose === 'function') onClose();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
  };

  closeBtn.addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', onKey);

  head.append(h, closeBtn);
  modal.append(head, body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);
  return { overlay, modal, body, close };
}

export function setButtonLoading(btn, loading, label = 'جارٍ الحفظ...') {
  if (!btn) return;
  if (loading) {
    btn.dataset.label = btn.textContent;
    btn.disabled = true;
    btn.setAttribute('aria-busy', 'true');
    clearElement(btn);
    btn.append(
      createEl('span', { className: 'spinner', 'aria-hidden': 'true' }),
      document.createTextNode(' ' + label)
    );
  } else {
    btn.disabled = false;
    btn.removeAttribute('aria-busy');
    clearElement(btn);
    btn.textContent = btn.dataset.label || 'حفظ';
  }
}

export function renderEmpty(container, message = 'لا توجد بيانات بعد') {
  clearElement(container);
  const box = createEl('div', { className: 'empty-state' });
  box.append(
    createEl('div', { className: 'empty-state__icon', textContent: '◇', 'aria-hidden': 'true' }),
    createEl('p', { textContent: message })
  );
  container.appendChild(box);
}

export function renderSkeleton(container, rows = 4) {
  clearElement(container);
  for (let i = 0; i < rows; i += 1) {
    container.appendChild(createEl('div', { className: 'skeleton skeleton-row' }));
  }
}

export function renderPagination(container, { page, pageSize, total, onChange }) {
  clearElement(container);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return;

  const info = createEl('span', {
    className: 'pagination__info',
    textContent: `صفحة ${page} من ${pages} — إجمالي ${total}`,
  });
  const prev = createEl('button', {
    type: 'button',
    className: 'btn btn--ghost btn--sm',
    textContent: 'السابق',
    disabled: page <= 1,
  });
  const next = createEl('button', {
    type: 'button',
    className: 'btn btn--ghost btn--sm',
    textContent: 'التالي',
    disabled: page >= pages,
  });
  prev.addEventListener('click', () => onChange(page - 1));
  next.addEventListener('click', () => onChange(page + 1));
  container.append(prev, info, next);
}

function currentPageId() {
  const file = (location.pathname.split('/').pop() || 'dashboard.html').toLowerCase();
  const map = {
    'dashboard.html': 'dashboard',
    'elementary-calendar.html': 'elementary',
    'upper-calendar.html': 'upper',
    'programs.html': 'programs',
    'schedule.html': 'schedule',
    'competitions.html': 'competitions',
    'honors.html': 'honors',
    'gallery.html': 'gallery',
    'settings.html': 'settings',
  };
  return map[file] || '';
}

export function mountShell({
  title,
  profile,
  settings,
  showPrint = true,
}) {
  initTheme();
  const app = document.getElementById('app');
  if (!app) return;

  clearElement(app);
  const sidebar = createEl('aside', {
    className: 'sidebar',
    id: 'sidebar',
    'aria-label': 'القائمة الرئيسية',
  });
  const brand = createEl('div', { className: 'sidebar__brand' });
  const logo = createEl('img', {
    className: 'brand-logo',
    src: './assets/images/school-logo.png',
    alt: 'شعار المدرسة',
    width: '72',
    height: '72',
  });
  brand.append(
    logo,
    createEl('div', { className: 'brand-text' }, [
      createEl('strong', {
        textContent: settings?.platform_name || 'منصة النشاط الطلابي',
      }),
      createEl('span', {
        textContent: `رائدة النشاط / ${settings?.leader_name || 'إيمان الرحيلي'}`,
      }),
    ])
  );

  const nav = createEl('nav', { className: 'sidebar__nav' });
  const activeId = currentPageId();
  NAV_ITEMS.forEach((item) => {
    const a = createEl('a', {
      href: item.href,
      className: `nav-link${item.id === activeId ? ' is-active' : ''}`,
      'aria-current': item.id === activeId ? 'page' : null,
    });
    a.textContent = item.label;
    nav.appendChild(a);
  });

  const logoutBtn = createEl('button', {
    type: 'button',
    className: 'btn btn--ghost sidebar__logout',
    textContent: 'تسجيل الخروج',
  });
  logoutBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'تسجيل الخروج',
      message: 'هل تريد تسجيل الخروج من المنصة؟',
      confirmText: 'خروج',
      danger: true,
    });
    if (ok) await logout();
  });

  sidebar.append(brand, nav, logoutBtn);

  const main = createEl('div', { className: 'main' });
  const header = createEl('header', { className: 'topbar' });
  const right = createEl('div', { className: 'topbar__right' });
  const menuBtn = createEl('button', {
    type: 'button',
    className: 'icon-btn menu-toggle',
    'aria-label': 'فتح القائمة',
    textContent: '☰',
  });
  menuBtn.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
  const heading = createEl('div', { className: 'topbar__titles' }, [
    createEl('h1', { textContent: title || '' }),
    createEl('p', {
      className: 'muted',
      textContent: profile?.full_name
        ? `${profile.full_name} · ${roleLabel(profile.role)}`
        : '',
    }),
  ]);
  right.append(menuBtn, heading);

  const left = createEl('div', { className: 'topbar__actions' });
  const themeBtn = createEl('button', {
    type: 'button',
    className: 'icon-btn',
    'aria-label': 'تبديل الوضع الليلي',
    textContent: '◐',
  });
  themeBtn.addEventListener('click', toggleTheme);
  left.appendChild(themeBtn);

  if (showPrint) {
    const printBtn = createEl('button', {
      type: 'button',
      className: 'btn btn--ghost btn--sm no-print',
      textContent: 'طباعة',
    });
    printBtn.addEventListener('click', () => window.print());
    left.appendChild(printBtn);
  }

  header.append(right, left);
  const content = createEl('main', {
    className: 'content',
    id: 'page-content',
  });
  const backdrop = createEl('div', {
    className: 'sidebar-backdrop',
    'aria-hidden': 'true',
  });
  backdrop.addEventListener('click', () => document.body.classList.remove('sidebar-open'));

  main.append(header, content);
  app.append(sidebar, main, backdrop);

  return {
    content,
    canEdit: canEdit(profile),
    isAdmin: isAdmin(profile),
    profile,
    settings,
  };
}

function roleLabel(role) {
  if (role === 'admin') return 'مدير';
  if (role === 'activity_leader') return 'رائدة نشاط';
  return 'عرض فقط';
}

export function buildToolbar(parent, controls = []) {
  const bar = createEl('div', { className: 'toolbar no-print' });
  controls.forEach((c) => {
    if (c) bar.appendChild(c);
  });
  parent.appendChild(bar);
  return bar;
}

export function field(labelText, inputEl, hint) {
  const wrap = createEl('label', { className: 'field' });
  wrap.appendChild(createEl('span', { className: 'field__label', textContent: labelText }));
  wrap.appendChild(inputEl);
  if (hint) wrap.appendChild(createEl('span', { className: 'field__hint', textContent: hint }));
  return wrap;
}
