/**
 * parents-eyes-admin.js — إدارة «بعيون أهالينا» لرائدة النشاط:
 * مراجعة المشاركات (بانتظار المراجعة / منشورة / مرفوضة) وإدارة المناسبات.
 * صفحة إدارية بحتة: الزائر لا يرى أي بيانات. كل الإجراءات تخضع لـ RLS (is_feature_manager مع
 * جلسة إدارة فُتحت بالرقم السري) في الخادم؛ إخفاء الأزرار هنا للتنظيم فقط.
 */
import { bootAdminPage } from './app.js';
import { isFeatureManager } from './auth.js';
import {
  STATUS_LABELS,
  listEvents,
  adminListPosts,
  adminCounts,
  adminSignedUrls,
  setPostStatus,
  updatePostText,
  deletePost,
  deletePostImage,
  createEvent,
  updateEvent,
  replaceCover,
  deleteEvent,
} from './parents-service.js';
import { postGallery, lazyImage } from './parents-ui.js';
import { isMissingSchemaError, renderSchemaNotice } from './file-manager.js';
import { openModal, confirmDialog, setButtonLoading, field, refreshParentsPendingBadge, copyShareLinkButton } from './ui.js';
import { validateRequired, validateLength, validateParentImage } from './validators.js';
import { createEl, clearElement, formatDate, logDev } from './utils.js';
import { icon } from './icons.js';

const STATUSES = ['pending', 'approved', 'rejected'];

bootAdminPage({ title: 'مراجعة مشاركات الأهالي' }, async (ctx) => {
  const root = ctx.content;
  root.appendChild(
    createEl('section', { className: 'section-header' }, [
      createEl('div', { className: 'section-header__nav no-print' }, [
        createEl('a', { href: './index.html', className: 'btn btn--ghost back-btn' }, [
          icon('chevronRight', { size: 18 }),
          createEl('span', { textContent: 'العودة إلى الرئيسية' }),
        ]),
        createEl('div', { className: 'section-header__steps' }, [
          createEl('a', { href: './parents-eyes.html', className: 'btn btn--ghost btn--sm' }, [
            icon('globe', { size: 16 }),
            createEl('span', { textContent: 'عرض الصفحة العامة' }),
          ]),
          copyShareLinkButton('btn btn--ghost btn--sm'),
        ]),
      ]),
      createEl('div', { className: 'section-header__main' }, [
        createEl('div', { className: 'section-header__icon' }, [icon('heart', { size: 30 })]),
        createEl('div', { className: 'section-header__text' }, [
          createEl('h2', { textContent: 'بعيون أهالينا' }),
          createEl('p', { textContent: 'مراجعة مشاركات أولياء الأمور واعتمادها، وإدارة المناسبات وفتح استقبال المشاركات وإغلاقه.' }),
        ]),
      ]),
    ])
  );

  if (!ctx.canEdit || !(await isFeatureManager())) {
    root.appendChild(createEl('div', { className: 'notice notice--warn' }, [
      icon('lock', { size: 22 }),
      createEl('div', {}, [
        createEl('strong', { textContent: 'هذه الصفحة متاحة في وضع الإدارة فقط' }),
        createEl('p', { textContent: 'انتهت جلسة الإدارة أو لم تُفعَّل؛ أعيدي إدخال الرقم السري من زر «إدارة المنصة».' }),
      ]),
    ]));
    return;
  }

  const state = {
    view: location.hash === '#events' ? 'events' : 'posts',
    status: 'pending',
    eventId: '',
    events: [],
    counts: { byEvent: {}, total: { pending: 0, approved: 0, rejected: 0 } },
  };

  const mainTabs = createEl('div', { className: 'seg-tabs no-print', role: 'tablist', 'aria-label': 'الأقسام' });
  const postsPanel = createEl('div', { className: 'pe-admin-panel' });
  const eventsPanel = createEl('div', { className: 'pe-admin-panel' });
  const tabBtn = (key, label, iconName) => {
    const b = createEl('button', { type: 'button', className: 'seg-tab', role: 'tab' }, [
      icon(iconName, { size: 18 }),
      createEl('span', { textContent: label }),
      createEl('span', { className: 'seg-tab__count' }),
    ]);
    b.addEventListener('click', () => switchView(key));
    mainTabs.appendChild(b);
    return b;
  };
  const postsTab = tabBtn('posts', 'المشاركات', 'message');
  const eventsTab = tabBtn('events', 'المناسبات', 'calendarSmall');
  const notice = createEl('div');
  root.append(notice, mainTabs, postsPanel, eventsPanel);

  // ------------------------------------------------------------------
  // المشاركات
  // ------------------------------------------------------------------
  const statusTabs = createEl('div', { className: 'seg-tabs pe-status-tabs no-print', role: 'tablist', 'aria-label': 'حالة المشاركات' });
  const statusBtns = {};
  STATUSES.forEach((s) => {
    const b = createEl('button', { type: 'button', className: 'seg-tab', role: 'tab' }, [
      createEl('span', { textContent: STATUS_LABELS[s] }),
      createEl('span', { className: 'seg-tab__count' }),
    ]);
    b.addEventListener('click', () => {
      state.status = s;
      loadPosts();
    });
    statusBtns[s] = b;
    statusTabs.appendChild(b);
  });
  const eventFilter = createEl('select', { className: 'select fm-sort', 'aria-label': 'تصفية حسب المناسبة' });
  eventFilter.addEventListener('change', () => {
    state.eventId = eventFilter.value;
    loadPosts();
  });
  const postsCount = createEl('span', { className: 'fm-count muted' });
  const postGrid = createEl('div', { className: 'pe-admin-grid', 'aria-live': 'polite' });
  postsPanel.append(
    statusTabs,
    createEl('div', { className: 'fm-toolbar no-print' }, [
      createEl('label', { className: 'pe-filter' }, [icon('layers', { size: 18 }), eventFilter]),
      postsCount,
    ]),
    postGrid
  );

  function eventTitle(id) {
    return state.events.find((e) => e.id === id)?.title || 'مناسبة';
  }

  function renderCounts() {
    const t = state.eventId
      ? state.counts.byEvent[state.eventId] || { pending: 0, approved: 0, rejected: 0 }
      : state.counts.total;
    STATUSES.forEach((s) => {
      const on = s === state.status;
      statusBtns[s].classList.toggle('is-active', on);
      statusBtns[s].setAttribute('aria-selected', on ? 'true' : 'false');
      statusBtns[s].querySelector('.seg-tab__count').textContent = String(t[s] || 0);
    });
    postsTab.querySelector('.seg-tab__count').textContent = state.counts.total.pending ? String(state.counts.total.pending) : '';
    eventsTab.querySelector('.seg-tab__count').textContent = String(state.events.length);

    const cur = eventFilter.value;
    clearElement(eventFilter);
    eventFilter.appendChild(createEl('option', {
      value: '',
      textContent: `كل المناسبات (${state.counts.total.pending} بانتظار المراجعة)`,
    }));
    state.events.forEach((ev) => {
      const n = state.counts.byEvent[ev.id]?.pending || 0;
      eventFilter.appendChild(createEl('option', { value: ev.id, textContent: `${ev.title} (${n} بانتظار)` }));
    });
    eventFilter.value = state.events.some((e) => e.id === cur) ? cur : '';
    state.eventId = eventFilter.value;
  }

  async function refreshMeta() {
    const [events, counts] = await Promise.all([listEvents(), adminCounts()]);
    state.events = events;
    state.counts = counts;
    renderCounts();
    refreshParentsPendingBadge();
  }

  const signedCache = new Map();
  async function signedUrl(path) {
    const hit = signedCache.get(path);
    if (hit && hit.exp > Date.now()) return hit.url;
    const map = await adminSignedUrls([path]);
    if (!map[path]) throw new Error('تعذّر تحميل الصورة');
    signedCache.set(path, { url: map[path], exp: Date.now() + 8 * 60 * 1000 });
    return map[path];
  }
  async function primeSigned(paths) {
    const need = paths.filter((p) => !(signedCache.get(p)?.exp > Date.now()));
    if (!need.length) return;
    try {
      const map = await adminSignedUrls(need);
      Object.entries(map).forEach(([p, url]) => signedCache.set(p, { url, exp: Date.now() + 8 * 60 * 1000 }));
    } catch (err) {
      logDev(err);
    }
  }

  async function loadPosts() {
    renderCounts();
    clearElement(postGrid);
    for (let i = 0; i < 2; i += 1) postGrid.appendChild(createEl('div', { className: 'pe-admin-post skeleton' }));
    try {
      const posts = await adminListPosts({ status: state.status, eventId: state.eventId || null });
      await primeSigned(posts.flatMap((p) => p.images.map((i) => i.storage_path)));
      clearElement(postGrid);
      postsCount.textContent = `${posts.length} مشاركة`;
      if (!posts.length) {
        postGrid.appendChild(createEl('div', { className: 'fm-empty' }, [
          createEl('div', { className: 'fm-empty__icon' }, [icon('message', { size: 30 })]),
          createEl('strong', { textContent: `لا توجد مشاركات ${STATUS_LABELS[state.status]}` }),
        ]));
        return;
      }
      posts.forEach((p) => postGrid.appendChild(adminPostCard(p)));
    } catch (err) {
      clearElement(postGrid);
      if (isMissingSchemaError(err)) renderSchemaNotice(postGrid);
      else ctx.handleError(err, 'تعذّر تحميل المشاركات');
    }
  }

  async function afterChange(msg) {
    ctx.showToast(msg, 'success');
    await refreshMeta();
    await loadPosts();
  }

  function adminPostCard(post) {
    const author = post.author_name || 'بدون اسم';
    const act = (label, iconName, fn, cls = '') => {
      const b = createEl('button', { type: 'button', className: `fc-btn ${cls}`, title: label }, [
        icon(iconName, { size: 16 }),
        createEl('span', { textContent: label }),
      ]);
      b.addEventListener('click', async () => {
        b.disabled = true;
        try {
          await fn();
        } catch (err) {
          ctx.handleError(err);
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      });
      return b;
    };

    const actions = createEl('div', { className: 'file-card__actions pe-admin-post__actions' });
    if (post.status !== 'approved') {
      actions.appendChild(act('اعتماد ونشر', 'check', async () => {
        await setPostStatus(post, 'approved');
        await afterChange('تم اعتماد المشاركة ونشرها');
      }, 'fc-btn--primary'));
    }
    if (post.status === 'pending') {
      actions.appendChild(act('رفض', 'ban', async () => {
        const ok = await confirmDialog({
          title: 'رفض المشاركة',
          message: 'لن تظهر المشاركة للعامة، وستنتقل إلى «مرفوضة». هل تريدين المتابعة؟',
          confirmText: 'رفض',
          danger: true,
        });
        if (!ok) return;
        await setPostStatus(post, 'rejected');
        await afterChange('تم رفض المشاركة');
      }));
    }
    if (post.status === 'approved') {
      actions.appendChild(act('إلغاء النشر', 'eyeOff', async () => {
        const ok = await confirmDialog({
          title: 'إلغاء نشر المشاركة',
          message: 'ستختفي المشاركة وصورها من الصفحة العامة فوراً وتعود إلى «بانتظار المراجعة».',
          confirmText: 'إلغاء النشر',
          danger: true,
        });
        if (!ok) return;
        await setPostStatus(post, 'pending');
        await afterChange('تم إلغاء نشر المشاركة');
      }));
    }
    actions.append(
      act('تعديل', 'edit', async () => openEditPost(post)),
      act('حذف', 'trash', async () => {
        const ok = await confirmDialog({
          title: 'حذف المشاركة نهائياً',
          message: `سيتم حذف المشاركة${post.images.length ? ` و${post.images.length} صورة` : ''} نهائياً ولا يمكن التراجع. هل تريدين المتابعة؟`,
          confirmText: 'نعم، احذف',
          cancelText: 'تراجع',
          danger: true,
        });
        if (!ok) return;
        await deletePost(post);
        await afterChange('تم حذف المشاركة');
      }, 'fc-btn--danger')
    );

    return createEl('article', { className: `pe-admin-post pe-admin-post--${post.status}` }, [
      postGallery(post.images, { getUrl: (img) => signedUrl(img.storage_path), caption: author }),
      createEl('div', { className: 'pe-post__body' }, [
        createEl('div', { className: 'pe-admin-post__tags' }, [
          createEl('span', { className: 'chip', textContent: eventTitle(post.event_id) }),
          createEl('span', { className: `chip chip--status-${post.status}`, textContent: STATUS_LABELS[post.status] }),
          post.images.length ? createEl('span', { className: 'meta-chip' }, [icon('image', { size: 15 }), createEl('span', { textContent: String(post.images.length) })]) : null,
        ]),
        post.comment
          ? createEl('p', { className: 'pe-post__comment', dir: 'auto', textContent: post.comment })
          : createEl('p', { className: 'muted', textContent: 'بدون تعليق' }),
        createEl('div', { className: 'pe-post__meta' }, [
          createEl('strong', { dir: 'auto', textContent: author }),
          createEl('span', { className: 'muted', textContent: `أُرسلت: ${formatDate(post.submitted_at)}` }),
          post.published_at ? createEl('span', { className: 'muted', textContent: `نُشرت: ${formatDate(post.published_at)}` }) : null,
        ]),
      ]),
      actions,
    ]);
  }

  function openEditPost(post) {
    let current = post;
    const form = createEl('form', { className: 'form-grid' });
    const nameInput = createEl('input', { className: 'input', maxlength: '80', value: post.author_name || '' });
    const comment = createEl('textarea', { className: 'textarea', maxlength: '2000', rows: '5' });
    comment.value = post.comment || '';
    const imgs = createEl('div', { className: 'pe-edit-images' });
    const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: 'حفظ التعديلات' });
    let dirty = false;

    function renderImgs() {
      clearElement(imgs);
      if (!current.images.length) {
        imgs.appendChild(createEl('p', { className: 'muted', textContent: 'لا توجد صور' }));
        return;
      }
      current.images.forEach((img) => {
        const del = createEl('button', { type: 'button', className: 'btn btn--danger btn--sm' }, [
          icon('trash', { size: 15 }),
          createEl('span', { textContent: 'حذف الصورة' }),
        ]);
        del.addEventListener('click', async () => {
          if (current.images.length === 1 && !comment.value.trim()) {
            ctx.showToast('لا يمكن حذف آخر صورة لمشاركة بلا تعليق؛ احذفي المشاركة بدلاً من ذلك', 'error');
            return;
          }
          const ok = await confirmDialog({
            title: 'حذف الصورة',
            message: 'سيتم حذف هذه الصورة من المشاركة نهائياً. هل تريدين المتابعة؟',
            confirmText: 'حذف الصورة',
            danger: true,
          });
          if (!ok) return;
          del.disabled = true;
          try {
            await deletePostImage(img);
            current = { ...current, images: current.images.filter((i) => i.id !== img.id) };
            renderImgs();
            ctx.showToast('تم حذف الصورة', 'success');
            dirty = true;
          } catch (err) {
            del.disabled = false;
            ctx.handleError(err);
          }
        });
        imgs.appendChild(createEl('div', { className: 'pe-edit-image' }, [
          lazyImage({ getUrl: () => signedUrl(img.storage_path), className: 'pe-img' }),
          del,
        ]));
      });
    }
    renderImgs();

    form.append(
      field('اسم المشارك', nameInput, 'اتركيه فارغاً لعرض «ولي أمر»'),
      field('التعليق', comment),
      createEl('div', { className: 'field' }, [createEl('span', { className: 'field__label', textContent: 'الصور' }), imgs]),
      createEl('div', { className: 'modal__actions' }, [saveBtn])
    );
    const { close } = openModal({
      title: 'تعديل المشاركة',
      contentNode: form,
      onClose: () => {
        if (dirty) afterChange('تم تحديث المشاركة');
      },
    });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!comment.value.trim() && !current.images.length) {
        ctx.showToast('يلزم بقاء صورة أو تعليق في المشاركة', 'error');
        return;
      }
      setButtonLoading(saveBtn, true);
      try {
        await updatePostText(current, { authorName: nameInput.value.trim(), comment: comment.value.trim() });
        dirty = true;
        close();
      } catch (err) {
        ctx.handleError(err);
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  // ------------------------------------------------------------------
  // المناسبات
  // ------------------------------------------------------------------
  const addEventBtn = createEl('button', { type: 'button', className: 'btn btn--primary btn--upload' }, [
    icon('plus', { size: 18 }),
    createEl('span', { textContent: 'إضافة مناسبة' }),
  ]);
  addEventBtn.addEventListener('click', () => openEventForm(null));
  const eventGrid = createEl('div', { className: 'pe-admin-events', 'aria-live': 'polite' });
  eventsPanel.append(
    createEl('div', { className: 'fm-toolbar no-print' }, [
      createEl('span', { className: 'muted', textContent: 'تظهر للعامة كل المناسبات ومشاركاتها المنشورة؛ ونموذج المشاركة يعرض المناسبات المفتوحة فقط.' }),
      addEventBtn,
    ]),
    eventGrid
  );

  function renderEvents() {
    clearElement(eventGrid);
    if (!state.events.length) {
      eventGrid.appendChild(createEl('div', { className: 'fm-empty' }, [
        createEl('div', { className: 'fm-empty__icon' }, [icon('calendarSmall', { size: 30 })]),
        createEl('strong', { textContent: 'لا توجد مناسبات بعد' }),
        createEl('span', { className: 'muted', textContent: 'أضيفي مناسبة ثم افتحي استقبال المشاركات.' }),
      ]));
      return;
    }
    state.events.forEach((ev) => {
      const c = state.counts.byEvent[ev.id] || { pending: 0, approved: 0, rejected: 0 };
      const toggle = createEl('button', { type: 'button', className: `fc-btn ${ev.is_open ? '' : 'fc-btn--primary'}` }, [
        icon(ev.is_open ? 'lock' : 'unlock', { size: 16 }),
        createEl('span', { textContent: ev.is_open ? 'إغلاق الاستقبال' : 'فتح الاستقبال' }),
      ]);
      toggle.addEventListener('click', async () => {
        toggle.disabled = true;
        try {
          await updateEvent(ev, { is_open: !ev.is_open });
          ctx.showToast(ev.is_open ? 'تم إغلاق استقبال المشاركات' : 'تم فتح استقبال المشاركات', 'success');
          await refreshMeta();
          renderEvents();
        } catch (err) {
          toggle.disabled = false;
          ctx.handleError(err);
        }
      });
      const edit = createEl('button', { type: 'button', className: 'fc-btn' }, [icon('edit', { size: 16 }), createEl('span', { textContent: 'تعديل' })]);
      edit.addEventListener('click', () => openEventForm(ev));
      const del = createEl('button', { type: 'button', className: 'fc-btn fc-btn--danger' }, [icon('trash', { size: 16 }), createEl('span', { textContent: 'حذف' })]);
      del.addEventListener('click', async () => {
        const ok = await confirmDialog({
          title: 'حذف المناسبة',
          message: `سيتم حذف المناسبة «${ev.title}» نهائياً. لا يمكن حذف مناسبة تحتوي مشاركات.`,
          confirmText: 'حذف',
          danger: true,
        });
        if (!ok) return;
        del.disabled = true;
        try {
          await deleteEvent(ev);
          ctx.showToast('تم حذف المناسبة', 'success');
          await refreshMeta();
          renderEvents();
        } catch (err) {
          del.disabled = false;
          ctx.handleError(err);
        }
      });

      eventGrid.appendChild(createEl('article', { className: 'file-card pe-admin-event' }, [
        ev.cover_path
          ? lazyImage({ getUrl: () => signedUrl(ev.cover_path), className: 'pe-admin-event__cover' })
          : createEl('div', { className: 'pe-admin-event__cover pe-admin-event__cover--empty' }, [icon('camera', { size: 30 })]),
        createEl('div', { className: 'file-card__body' }, [
          createEl('h4', { className: 'file-card__title', textContent: ev.title }),
          ev.description ? createEl('p', { className: 'file-card__desc', textContent: ev.description }) : null,
          createEl('div', { className: 'file-card__meta' }, [
            createEl('span', { className: `chip ${ev.is_open ? 'chip--open' : 'chip--closed'}`, textContent: ev.is_open ? 'تستقبل المشاركات' : 'الاستقبال مغلق' }),
            createEl('span', { textContent: `${c.pending} بانتظار · ${c.approved} منشورة · ${c.rejected} مرفوضة` }),
          ]),
        ]),
        createEl('div', { className: 'file-card__actions pe-admin-event__actions' }, [toggle, edit, del]),
      ]));
    });
  }

  function openEventForm(ev) {
    const form = createEl('form', { className: 'form-grid' });
    const title = createEl('input', { className: 'input', maxlength: '200', value: ev?.title || '', required: true });
    const desc = createEl('textarea', { className: 'textarea', maxlength: '4000', rows: '4' });
    desc.value = ev?.description || '';
    const coverInput = createEl('input', { className: 'input', type: 'file', accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp' });
    const removeCover = createEl('input', { type: 'checkbox' });
    const isOpen = createEl('input', { type: 'checkbox' });
    isOpen.checked = ev ? ev.is_open : true;
    const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: ev ? 'حفظ' : 'إضافة المناسبة' });

    form.append(
      field('اسم المناسبة', title),
      field('الوصف', desc),
      field(ev?.cover_path ? 'استبدال صورة الغلاف (اختياري)' : 'صورة الغلاف (اختياري)', coverInput, 'JPG أو PNG أو WEBP حتى 5 ميجابايت'),
      ev?.cover_path ? createEl('label', { className: 'pe-consent' }, [removeCover, createEl('span', { textContent: 'إزالة صورة الغلاف الحالية' })]) : null,
      createEl('label', { className: 'pe-consent' }, [isOpen, createEl('span', { textContent: 'استقبال مشاركات أولياء الأمور مفتوح' })]),
      createEl('div', { className: 'modal__actions' }, [saveBtn])
    );
    const { close } = openModal({ title: ev ? 'تعديل المناسبة' : 'إضافة مناسبة', contentNode: form });
    title.focus();

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err =
        validateRequired(title.value, 'اسم المناسبة') ||
        validateLength(title.value, 'اسم المناسبة', 1, 200) ||
        (desc.value.length > 4000 ? 'الوصف أطول من المسموح' : null);
      if (err) {
        ctx.showToast(err, 'error');
        return;
      }
      const file = coverInput.files?.[0] || null;
      if (file) {
        const check = validateParentImage(file);
        if (!check.ok) {
          ctx.showToast(check.error, 'error');
          return;
        }
      }
      setButtonLoading(saveBtn, true);
      try {
        if (!ev) {
          await createEvent({ title: title.value.trim(), description: desc.value.trim(), isOpen: isOpen.checked, coverFile: file });
          ctx.showToast('تمت إضافة المناسبة', 'success');
        } else {
          let updated = await updateEvent(ev, {
            title: title.value.trim(),
            description: desc.value.trim() || null,
            is_open: isOpen.checked,
          });
          if (file) updated = await replaceCover(updated, file);
          else if (removeCover.checked && updated.cover_path) updated = await replaceCover(updated, null);
          ctx.showToast('تم حفظ المناسبة', 'success');
        }
        close();
        await refreshMeta();
        renderEvents();
      } catch (error) {
        ctx.handleError(error);
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  function switchView(view) {
    state.view = view;
    postsTab.classList.toggle('is-active', view === 'posts');
    eventsTab.classList.toggle('is-active', view === 'events');
    postsTab.setAttribute('aria-selected', view === 'posts' ? 'true' : 'false');
    eventsTab.setAttribute('aria-selected', view === 'events' ? 'true' : 'false');
    postsPanel.hidden = view !== 'posts';
    eventsPanel.hidden = view !== 'events';
    history.replaceState(null, '', view === 'events' ? '#events' : '#posts');
    if (view === 'events') renderEvents();
  }

  try {
    await refreshMeta();
  } catch (err) {
    if (isMissingSchemaError(err)) {
      renderSchemaNotice(notice);
      notice.querySelector('p').textContent =
        'يلزم تشغيل ملف الترحيل migrations/004_public_parents_competitions.sql في Supabase SQL Editor مرة واحدة، ثم تحديث الصفحة.';
      mainTabs.hidden = true;
      postsPanel.hidden = true;
      eventsPanel.hidden = true;
      return;
    }
    ctx.handleError(err);
  }
  switchView(state.view);
  await loadPosts();
});
