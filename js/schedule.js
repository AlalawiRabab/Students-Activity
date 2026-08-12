/**
 * schedule.js
 */
import { bootProtectedPage } from './app.js';
import { listRows, insertRow, updateRow, deleteRow } from './supabase-service.js';
import {
  uploadThenInsert,
  createSignedUrl,
  removeStorageObject,
  removeStorageObjects,
} from './storage.js';
import { writeAudit } from './supabase-service.js';
import { createEl, clearElement, formatBytes, formatDate, logDev } from './utils.js';
import {
  field,
  setButtonLoading,
  confirmDialog,
  openModal,
  renderEmpty,
  buildToolbar,
} from './ui.js';
import { validateRequired } from './validators.js';

bootProtectedPage({ title: 'جدول حصص النشاط' }, async (ctx) => {
  const root = ctx.content;
  let rows = [];

  const toolbar = buildToolbar(root, []);
  const searchInput = createEl('input', {
    className: 'input',
    type: 'search',
    placeholder: 'بحث بالعنوان...',
    'aria-label': 'بحث',
  });
  toolbar.appendChild(field('بحث', searchInput));

  if (ctx.canEdit) {
    const addBtn = createEl('button', {
      type: 'button',
      className: 'btn btn--primary',
      textContent: 'رفع جدول',
    });
    addBtn.addEventListener('click', () => openForm());
    toolbar.appendChild(addBtn);
  }

  const grid = createEl('div', { className: 'schedule-grid' });
  root.appendChild(grid);

  searchInput.addEventListener('input', render);

  async function load() {
    try {
      const res = await listRows('schedules', {
        from: 0,
        to: 199,
        orderBy: 'created_at',
        ascending: false,
      });
      rows = res.data;
      render();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  function render() {
    const q = searchInput.value.trim();
    const filtered = q
      ? rows.filter((r) => String(r.title).includes(q) || String(r.file_name).includes(q))
      : rows;
    clearElement(grid);
    if (!filtered.length) {
      renderEmpty(grid, 'لا توجد جداول مرفوعة بعد');
      return;
    }
    filtered.forEach((r) => {
      const card = createEl('article', { className: 'file-card' });
      card.append(
        createEl('h3', { textContent: r.title }),
        createEl('p', {
          className: 'muted',
          textContent: `${r.file_name} · ${formatBytes(r.file_size)} · ${formatDate(r.created_at)}`,
        })
      );
      const actions = createEl('div', { className: 'row-actions' });
      const previewBtn = createEl('button', {
        type: 'button',
        className: 'btn btn--ghost btn--sm',
        textContent: 'معاينة',
      });
      previewBtn.addEventListener('click', () => preview(r));
      const downloadBtn = createEl('button', {
        type: 'button',
        className: 'btn btn--ghost btn--sm',
        textContent: 'تنزيل',
      });
      downloadBtn.addEventListener('click', () => download(r));
      actions.append(previewBtn, downloadBtn);
      if (ctx.canEdit) {
        const replaceBtn = createEl('button', {
          type: 'button',
          className: 'btn btn--ghost btn--sm',
          textContent: 'استبدال',
        });
        replaceBtn.addEventListener('click', () => openForm(r));
        const delBtn = createEl('button', {
          type: 'button',
          className: 'btn btn--danger btn--sm',
          textContent: 'حذف',
        });
        delBtn.addEventListener('click', () => removeSchedule(r));
        actions.append(replaceBtn, delBtn);
      }
      card.appendChild(actions);
      grid.appendChild(card);
    });
  }

  async function preview(row) {
    try {
      const url = await createSignedUrl(row.file_path);
      const wrap = createEl('div');
      if (row.file_type === 'image') {
        const img = createEl('img', { alt: row.file_name, src: url, className: 'preview-frame' });
        wrap.appendChild(img);
      } else {
        const iframe = createEl('iframe', {
          className: 'preview-frame',
          title: row.file_name,
          src: url,
        });
        wrap.appendChild(iframe);
      }
      openModal({ title: row.title, contentNode: wrap });
    } catch (err) {
      ctx.handleError(err);
    }
  }

  async function download(row) {
    try {
      const url = await createSignedUrl(row.file_path, 60);
      const a = createEl('a', { href: url, download: row.file_name, target: '_blank', rel: 'noopener' });
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  function openForm(row = null) {
    const form = createEl('form', { className: 'form-grid' });
    const titleInput = createEl('input', {
      className: 'input',
      required: true,
      value: row?.title || 'جدول حصص النشاط',
    });
    const fileInput = createEl('input', {
      className: 'input',
      type: 'file',
      accept: '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*',
      required: !row,
    });
    form.append(
      field('العنوان', titleInput),
      field('الملف (PDF أو صورة)', fileInput, 'الصور ≤ 5 م.ب — PDF ≤ 10 م.ب')
    );
    const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: 'حفظ' });
    form.appendChild(createEl('div', { className: 'modal__actions' }, [saveBtn]));
    const { close } = openModal({
      title: row ? 'استبدال الجدول' : 'رفع جدول',
      contentNode: form,
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const tErr = validateRequired(titleInput.value, 'العنوان');
      if (tErr) {
        ctx.showToast(tErr, 'error');
        return;
      }
      setButtonLoading(saveBtn, true);
      try {
        if (!row) {
          const file = fileInput.files?.[0];
          if (!file) {
            ctx.showToast('اختر ملفاً', 'error');
            return;
          }
          await uploadThenInsert(file, 'schedules', 'document', async (uploaded) => {
            const data = await insertRow(
              'schedules',
              {
                title: titleInput.value.trim(),
                file_path: uploaded.path,
                file_name: uploaded.fileName,
                file_type: uploaded.fileType,
                file_size: uploaded.fileSize,
                mime_type: uploaded.mimeType,
                created_by: ctx.user.id,
              },
              'schedules'
            );
            await writeAudit('upload_file', 'schedules', data.id, { file_name: uploaded.fileName });
            return data;
          });
          ctx.showToast('تم الرفع بنجاح', 'success');
        } else {
          const file = fileInput.files?.[0];
          const updates = { title: titleInput.value.trim() };
          let oldPath = null;
          if (file) {
            const uploaded = await uploadThenInsert(file, 'schedules', 'document', async (u) => u);
            oldPath = row.file_path;
            updates.file_path = uploaded.path;
            updates.file_name = uploaded.fileName;
            updates.file_type = uploaded.fileType;
            updates.file_size = uploaded.fileSize;
            updates.mime_type = uploaded.mimeType;
          }
          await updateRow('schedules', row.id, updates, 'schedules');
          if (oldPath) {
            try {
              await removeStorageObject(oldPath);
            } catch (err) {
              logDev(err);
            }
          }
          ctx.showToast('تم التحديث', 'success');
        }
        close();
        await load();
      } catch (err) {
        ctx.handleError(err);
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  async function removeSchedule(row) {
    const ok = await confirmDialog({
      title: 'حذف الجدول',
      message: 'هل أنت متأكد من حذف هذا السجل؟ لا يمكن التراجع عن هذا الإجراء.',
      confirmText: 'حذف',
      danger: true,
    });
    if (!ok) return;
    try {
      const storageRes = await removeStorageObjects([row.file_path]);
      if (!storageRes.ok) {
        logDev(storageRes.error);
        ctx.showToast('تعذّر حذف الملف من التخزين، لم يُحذف السجل', 'error');
        return;
      }
      await deleteRow('schedules', row.id, 'schedules');
      await writeAudit('delete_file', 'schedules', row.id, { file_name: row.file_name });
      ctx.showToast('تم الحذف', 'success');
      await load();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  await load();
});
