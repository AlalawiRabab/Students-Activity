/**
 * gallery.js
 */
import { bootProtectedPage } from './app.js';
import { listRows, insertRow, updateRow, deleteRow, writeAudit } from './supabase-service.js';
import {
  uploadThenInsert,
  createSignedUrl,
  removeStorageObjects,
} from './storage.js';
import { PAGE_SIZE } from './config.js';
import {
  createEl,
  clearElement,
  formatDate,
  debounce,
  arabicIncludes,
  logDev,
} from './utils.js';
import {
  field,
  setButtonLoading,
  confirmDialog,
  openModal,
  renderEmpty,
  renderPagination,
  buildToolbar,
} from './ui.js';
import { validateRequired, validateLength } from './validators.js';

bootProtectedPage({ title: 'معرض النشاط' }, async (ctx) => {
  const root = ctx.content;
  let page = 1;
  let rows = [];
  let total = 0;
  const urlCache = new Map();

  const toolbar = buildToolbar(root, []);
  const searchInput = createEl('input', { className: 'input', type: 'search', 'aria-label': 'بحث' });
  const fromInput = createEl('input', { className: 'input', type: 'date' });
  const toInput = createEl('input', { className: 'input', type: 'date' });
  toolbar.append(field('بحث', searchInput), field('من', fromInput), field('إلى', toInput));

  if (ctx.canEdit) {
    const addBtn = createEl('button', {
      type: 'button',
      className: 'btn btn--primary',
      textContent: 'رفع صور',
    });
    addBtn.addEventListener('click', () => openUpload());
    toolbar.appendChild(addBtn);
  }

  const grid = createEl('div', { className: 'gallery-grid' });
  root.appendChild(grid);
  const pager = createEl('div', { className: 'pagination' });
  root.appendChild(pager);

  const reload = debounce(() => {
    page = 1;
    load();
  }, 250);
  searchInput.addEventListener('input', () => render());
  fromInput.addEventListener('change', reload);
  toInput.addEventListener('change', reload);

  async function signed(path) {
    if (urlCache.has(path)) return urlCache.get(path);
    const url = await createSignedUrl(path, 300);
    urlCache.set(path, url);
    return url;
  }

  async function load() {
    try {
      const from = (page - 1) * PAGE_SIZE;
      const res = await listRows('gallery', {
        from,
        to: from + PAGE_SIZE - 1,
        orderBy: 'event_date',
        ascending: false,
        filters: [
          { column: 'event_date', op: 'gte', value: fromInput.value || null },
          { column: 'event_date', op: 'lte', value: toInput.value || null },
        ],
      });
      rows = res.data;
      total = res.count;
      await render();
      renderPagination(pager, {
        page,
        pageSize: PAGE_SIZE,
        total,
        onChange: (p) => {
          page = p;
          load();
        },
      });
    } catch (err) {
      ctx.handleError(err);
    }
  }

  function filtered() {
    const q = searchInput.value.trim();
    if (!q) return rows;
    return rows.filter(
      (r) => arabicIncludes(r.title, q) || arabicIncludes(r.description, q)
    );
  }

  async function render() {
    const data = filtered();
    clearElement(grid);
    if (!data.length) {
      renderEmpty(grid, 'لا توجد صور في المعرض بعد');
      return;
    }
    for (const r of data) {
      const card = createEl('article', { className: 'gallery-card' });
      const img = createEl('img', {
        alt: r.title || 'صورة معرض',
        loading: 'lazy',
        decoding: 'async',
      });
      try {
        img.src = await signed(r.image_path);
      } catch (err) {
        logDev(err);
        img.alt = 'تعذّر تحميل الصورة';
      }
      img.addEventListener('click', () => lightbox(r, img.src));
      const body = createEl('div', { className: 'gallery-card__body' });
      body.append(
        createEl('strong', { textContent: r.title }),
        createEl('p', { className: 'muted', textContent: formatDate(r.event_date) })
      );
      const actions = createEl('div', { className: 'row-actions' });
      if (ctx.canEdit) {
        const editBtn = createEl('button', {
          type: 'button',
          className: 'btn btn--ghost btn--sm',
          textContent: 'تعديل',
        });
        editBtn.addEventListener('click', () => openEdit(r));
        const delBtn = createEl('button', {
          type: 'button',
          className: 'btn btn--danger btn--sm',
          textContent: 'حذف',
        });
        delBtn.addEventListener('click', () => removeItem(r));
        actions.append(editBtn, delBtn);
      }
      body.appendChild(actions);
      card.append(img, body);
      grid.appendChild(card);
    }
  }

  function lightbox(row, src) {
    const wrap = createEl('div');
    wrap.append(
      createEl('img', { src, alt: row.title, className: 'preview-frame' }),
      createEl('p', { textContent: row.description || '' })
    );
    openModal({ title: row.title, contentNode: wrap });
  }

  function openUpload() {
    const form = createEl('form', { className: 'form-grid' });
    const titleInput = createEl('input', { className: 'input' });
    const descInput = createEl('textarea', { className: 'textarea' });
    const dateInput = createEl('input', { className: 'input', type: 'date' });
    const filesInput = createEl('input', {
      className: 'input',
      type: 'file',
      multiple: true,
      accept: 'image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp',
      required: true,
    });
    form.append(
      field('العنوان', titleInput),
      field('الوصف', descInput),
      field('تاريخ الفعالية', dateInput),
      field('الصور', filesInput, 'يمكن رفع عدة صور — كل صورة ≤ 5 م.ب')
    );
    const saveBtn = createEl('button', {
      type: 'submit',
      className: 'btn btn--primary',
      textContent: 'رفع',
    });
    form.appendChild(createEl('div', { className: 'modal__actions' }, [saveBtn]));
    const { close } = openModal({ title: 'رفع صور للمعرض', contentNode: form });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err =
        validateRequired(titleInput.value, 'العنوان') ||
        validateLength(titleInput.value, 'العنوان', 1, 200);
      if (err) {
        ctx.showToast(err, 'error');
        return;
      }
      const files = [...(filesInput.files || [])];
      if (!files.length) {
        ctx.showToast('اختر صورة واحدة على الأقل', 'error');
        return;
      }
      setButtonLoading(saveBtn, true, 'جارٍ الرفع...');
      try {
        for (const file of files) {
          await uploadThenInsert(file, 'gallery', 'image', async (u) => {
            const data = await insertRow(
              'gallery',
              {
                title: titleInput.value.trim(),
                description: descInput.value.trim() || null,
                event_date: dateInput.value || null,
                image_path: u.path,
                image_name: u.fileName,
                mime_type: u.mimeType,
                file_size: u.fileSize,
                created_by: ctx.user.id,
              },
              'gallery'
            );
            await writeAudit('upload_file', 'gallery', data.id, { file_name: u.fileName });
            return data;
          });
        }
        ctx.showToast('تم رفع الصور', 'success');
        close();
        urlCache.clear();
        load();
      } catch (error) {
        ctx.handleError(error);
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  function openEdit(row) {
    const form = createEl('form', { className: 'form-grid' });
    const titleInput = createEl('input', { className: 'input', value: row.title || '' });
    const descInput = createEl('textarea', { className: 'textarea' });
    descInput.value = row.description || '';
    const dateInput = createEl('input', {
      className: 'input',
      type: 'date',
      value: row.event_date || '',
    });
    form.append(
      field('العنوان', titleInput),
      field('الوصف', descInput),
      field('تاريخ الفعالية', dateInput)
    );
    const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: 'حفظ' });
    form.appendChild(createEl('div', { className: 'modal__actions' }, [saveBtn]));
    const { close } = openModal({ title: 'تعديل صورة', contentNode: form });
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      setButtonLoading(saveBtn, true);
      try {
        await updateRow(
          'gallery',
          row.id,
          {
            title: titleInput.value.trim(),
            description: descInput.value.trim() || null,
            event_date: dateInput.value || null,
          },
          'gallery'
        );
        ctx.showToast('تم التحديث', 'success');
        close();
        load();
      } catch (err) {
        ctx.handleError(err);
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  async function removeItem(row) {
    const ok = await confirmDialog({
      title: 'حذف الصورة',
      message: 'هل أنت متأكد من حذف هذه الصورة؟ لا يمكن التراجع.',
      confirmText: 'حذف',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await removeStorageObjects([row.image_path]);
      if (!res.ok) {
        ctx.showToast('تعذّر حذف الملف من التخزين', 'error');
        return;
      }
      await deleteRow('gallery', row.id, 'gallery');
      await writeAudit('delete_file', 'gallery', row.id, {});
      ctx.showToast('تم الحذف', 'success');
      urlCache.clear();
      load();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  await load();
});
