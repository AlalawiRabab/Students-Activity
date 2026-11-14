/**
 * ui.js — Toast, Modal, Layout, Theme
 */
import { createEl, clearElement, logDev } from './utils.js';
import {
  canEdit,
  isAdmin,
  isFeatureManager,
  enterAdminMode,
  exitAdminMode,
  adminPinErrorMessage,
} from './auth.js';
import { userMessageFromError } from './supabase-service.js';
import { SECTIONS, PLATFORM_PAGES, ADMIN_PAGES } from './sections-config.js';
import { getSupabase } from './supabase-client.js';
import { PARENTS_SHARE_URL } from './config.js';
import { icon } from './icons.js';

const THEME_KEY = 'sap-theme';

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
    (danger ? cancelBtn : okBtn).focus();
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

function currentPageFile() {
  return (location.pathname.split('/').pop() || 'index.html').toLowerCase();
}

function navLink(href, label, iconName, activeFile, extra = null) {
  const file = href.replace('./', '').toLowerCase();
  const active = file === activeFile;
  const a = createEl('a', {
    href,
    className: `nav-link${active ? ' is-active' : ''}`,
    'aria-current': active ? 'page' : null,
    title: label,
  });
  a.append(
    createEl('span', { className: 'nav-link__icon' }, [icon(iconName, { size: 19 })]),
    createEl('span', { className: 'nav-link__label', textContent: label })
  );
  if (extra) a.appendChild(extra);
  return a;
}

function buildNav(adminMode) {
  const activeFile = currentPageFile();
  const nav = createEl('nav', { className: 'sidebar__nav' });
  nav.appendChild(navLink('./index.html', 'الرئيسية', 'home', activeFile));

  nav.appendChild(createEl('div', { className: 'nav-group__label', textContent: 'أقسام المنصة' }));
  PLATFORM_PAGES.forEach((p) => nav.appendChild(navLink(p.href, p.label, p.icon, activeFile)));

  nav.appendChild(createEl('div', { className: 'nav-group__label', textContent: 'السجل الإلكتروني لرائدة النشاط' }));
  SECTIONS.forEach((s, i) => {
    nav.appendChild(
      navLink(
        `./${s.page}`,
        s.title,
        s.icon,
        activeFile,
        createEl('span', { className: 'nav-link__num', textContent: String(i + 1) })
      )
    );
  });

  if (adminMode) {
    nav.appendChild(createEl('div', { className: 'nav-group__label', textContent: 'الإدارة' }));
    ADMIN_PAGES.forEach((p) => {
      const badge = p.key === 'parents_review'
        ? createEl('span', { className: 'nav-link__badge', id: 'nav-parents-pending', hidden: true })
        : null;
      nav.appendChild(navLink(p.href, p.label, p.icon, activeFile, badge));
    });
  }

  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) document.body.classList.remove('sidebar-open');
  });
  return nav;
}

export function mountShell({
  title,
  profile,
  settings,
  showPrint = true,
  adminMode = false,
}) {
  initTheme();
  const app = document.getElementById('app');
  if (!app) return;

  clearElement(app);
  app.className = '';
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

  const nav = buildNav(adminMode);

  sidebar.append(brand, nav, adminToggleButton(adminMode, 'btn btn--ghost sidebar__logout'));

  const main = createEl('div', { className: 'main' });
  const header = createEl('header', { className: 'topbar' });
  const right = createEl('div', { className: 'topbar__right' });
  const menuBtn = createEl('button', {
    type: 'button',
    className: 'icon-btn menu-toggle',
    'aria-label': 'فتح القائمة',
    'aria-controls': 'sidebar',
  }, [icon('menu', { size: 22 })]);
  menuBtn.addEventListener('click', () => {
    document.body.classList.toggle('sidebar-open');
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.body.classList.remove('sidebar-open');
  });
  const heading = createEl('div', { className: 'topbar__titles' }, [
    createEl('h1', { textContent: title || '' }),
    adminMode
      ? createEl('p', { className: 'admin-chip' }, [
          icon('unlock', { size: 14 }),
          createEl('span', { textContent: 'وضع الإدارة مفعّل' }),
        ])
      : createEl('p', {
          className: 'muted',
          textContent: `رائدة النشاط / ${settings?.leader_name || 'إيمان الرحيلي'}`,
        }),
  ]);
  right.append(menuBtn, heading);

  const left = createEl('div', { className: 'topbar__actions' });
  const themeBtn = createEl('button', {
    type: 'button',
    className: 'icon-btn',
    'aria-label': 'تبديل الوضع الليلي',
    title: 'الوضع الليلي',
  }, [icon('moon', { size: 20 })]);
  themeBtn.addEventListener('click', toggleTheme);
  left.appendChild(themeBtn);

  if (showPrint) {
    const printBtn = createEl('button', {
      type: 'button',
      className: 'btn btn--ghost btn--sm no-print topbar__print',
      textContent: 'طباعة',
    });
    printBtn.addEventListener('click', () => window.print());
    left.appendChild(printBtn);
  }
  left.appendChild(adminToggleButton(adminMode, 'btn btn--ghost btn--sm no-print admin-btn'));

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

  if (adminMode) refreshParentsPendingBadge();

  return {
    content,
    canEdit: adminMode && canEdit(profile),
    isAdmin: adminMode && isAdmin(profile),
    profile,
    settings,
  };
}

// ---------------------------------------------------------------------
// وضع الإدارة (الرقم السري يتحقق منه الخادم؛ لا يُحفظ في المتصفح)
// ---------------------------------------------------------------------
function adminToggleButton(adminMode, className) {
  if (adminMode) {
    const btn = createEl('button', { type: 'button', className: `${className} admin-btn--exit`, title: 'الخروج من وضع الإدارة' }, [
      icon('logout', { size: 18 }),
      createEl('span', { className: 'admin-btn__label', textContent: 'الخروج من وضع الإدارة' }),
    ]);
    btn.addEventListener('click', async () => {
      const ok = await confirmDialog({
        title: 'الخروج من وضع الإدارة',
        message: 'ستُخفى أدوات الإدارة وتنتهي صلاحيتها على هذا الجهاز فوراً.',
        confirmText: 'خروج',
        danger: true,
      });
      if (ok) await exitAdminMode();
    });
    return btn;
  }
  const btn = createEl('button', { type: 'button', className, title: 'إدارة المنصة' }, [
    icon('lock', { size: 18 }),
    createEl('span', { className: 'admin-btn__label', textContent: 'إدارة المنصة' }),
  ]);
  btn.addEventListener('click', () => openAdminPinDialog());
  return btn;
}

export function openAdminPinDialog() {
  const form = createEl('form', { className: 'form-grid admin-pin-form', novalidate: true });
  const alertBox = createEl('div', { className: 'alert alert--error', role: 'alert' });
  const input = createEl('input', {
    className: 'input admin-pin-input',
    type: 'password',
    inputmode: 'numeric',
    autocomplete: 'off',
    maxlength: '12',
    dir: 'ltr',
    'aria-label': 'الرقم السري',
    required: true,
  });
  const submit = createEl('button', { type: 'submit', className: 'btn btn--primary' }, [
    icon('unlock', { size: 18 }),
    createEl('span', { textContent: 'دخول وضع الإدارة' }),
  ]);
  form.append(
    createEl('p', {
      className: 'muted',
      textContent: 'أدخلي الرقم السري الخاص برائدة النشاط لتفعيل أدوات الإضافة والتعديل والحذف والنشر والاعتماد.',
    }),
    alertBox,
    field('الرقم السري', input),
    createEl('div', { className: 'modal__actions' }, [submit])
  );
  const { close } = openModal({ title: 'إدارة المنصة', contentNode: form });
  setTimeout(() => input.focus(), 30);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    alertBox.classList.remove('is-visible');
    const pin = input.value.trim();
    if (!/^[0-9]{6,12}$/.test(pin)) {
      alertBox.textContent = 'الرقم السري من 6 إلى 12 رقماً';
      alertBox.classList.add('is-visible');
      return;
    }
    setButtonLoading(submit, true, 'جارٍ التحقق...');
    try {
      await enterAdminMode(pin);
      input.value = '';
      close();
      showToast('تم تفعيل وضع الإدارة', 'success');
      setTimeout(() => window.location.reload(), 400);
    } catch (err) {
      logDev(err);
      input.value = '';
      alertBox.textContent = adminPinErrorMessage(err);
      alertBox.classList.add('is-visible');
      setButtonLoading(submit, false);
      submit.replaceChildren(icon('unlock', { size: 18 }), createEl('span', { textContent: 'دخول وضع الإدارة' }));
      input.focus();
    }
  });
}

/** محتوى الصفحات الإدارية البحتة للزائر: لا بيانات، فقط طلب وضع الإدارة */
export function renderAdminLock(container) {
  const btn = createEl('button', { type: 'button', className: 'btn btn--primary' }, [
    icon('lock', { size: 18 }),
    createEl('span', { textContent: 'إدارة المنصة' }),
  ]);
  btn.addEventListener('click', () => openAdminPinDialog());
  container.appendChild(
    createEl('div', { className: 'notice notice--warn admin-lock' }, [
      icon('lock', { size: 22 }),
      createEl('div', {}, [
        createEl('strong', { textContent: 'هذه الصفحة متاحة في وضع الإدارة فقط' }),
        createEl('p', { textContent: 'يلزم الرقم السري الخاص برائدة النشاط لعرض هذه الصفحة.' }),
        btn,
      ]),
    ])
  );
}

// ---------------------------------------------------------------------
// رابط مشاركة الأهالي
// ---------------------------------------------------------------------
export async function copyText(text) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    logDev('clipboard', err);
  }
  const ta = createEl('textarea', { readonly: true, className: 'visually-hidden' });
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  ta.remove();
  return ok;
}

export function copyShareLinkButton(className = 'btn btn--ghost') {
  const btn = createEl('button', { type: 'button', className: `${className} copy-share-btn` }, [
    icon('copy', { size: 18 }),
    createEl('span', { textContent: 'نسخ رابط مشاركة الأهالي' }),
  ]);
  btn.addEventListener('click', async () => {
    if (await copyText(PARENTS_SHARE_URL)) {
      showToast(`تم نسخ رابط مشاركة الأهالي: ${PARENTS_SHARE_URL}`, 'success');
      return;
    }
    const linkInput = createEl('input', { className: 'input', readonly: true, dir: 'ltr', value: PARENTS_SHARE_URL });
    openModal({
      title: 'رابط مشاركة الأهالي',
      contentNode: createEl('div', { className: 'form-grid' }, [
        createEl('p', { textContent: 'تعذّر النسخ تلقائياً؛ انسخ الرابط من الحقل:' }),
        linkInput,
      ]),
    });
    linkInput.select();
  });
  return btn;
}

/** عدد مشاركات «بعيون أهالينا» المنتظرة بجانب الرابط (يتجاهل الخطأ قبل تشغيل 004) */
export async function refreshParentsPendingBadge() {
  const badge = document.getElementById('nav-parents-pending');
  if (!badge || !(await isFeatureManager())) return;
  try {
    const { count, error } = await getSupabase()
      .from('parent_posts')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending');
    if (error) throw error;
    badge.textContent = String(count || 0);
    badge.hidden = !count;
    badge.title = `${count || 0} مشاركة بانتظار المراجعة`;
  } catch (err) {
    logDev('pending badge', err);
    badge.hidden = true;
  }
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
