/**
 * honors.js
 */
import { bootProtectedPage } from './app.js';
import {
  listRows,
  insertRow,
  updateRow,
  deleteRow,
  fetchChildren,
  writeAudit,
} from './supabase-service.js';
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
  recipientTypeLabel,
  formatBytes,
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
import { exportExcel } from './export.js';
import { validateRequired, validateLength } from './validators.js';
import { getSupabase } from './supabase-client.js';

bootProtectedPage({ title: 'التكريم' }, async (ctx) => {
  const root = ctx.content;
  let page = 1;
  let rows = [];
  let total = 0;

  const toolbar = buildToolbar(root, []);
  const searchInput = createEl('input', { className: 'input', type: 'search', 'aria-label': 'بحث' });
  const fromInput = createEl('input', { className: 'input', type: 'date' });
  const toInput = createEl('input', { className: 'input', type: 'date' });
  const typeFilter = createEl('select', { className: 'select' }, [
    createEl('option', { value: '', textContent: 'كل الأنواع' }),
    createEl('option', { value: 'student', textContent: 'طالبة' }),
    createEl('option', { value: 'teacher', textContent: 'معلمة' }),
    createEl('option', { value: 'other', textContent: 'أخرى' }),
  ]);
  toolbar.append(
    field('بحث', searchInput),
    field('من', fromInput),
    field('إلى', toInput),
    field('النوع', typeFilter)
  );

  if (ctx.canEdit) {
    const addBtn = createEl('button', {
      type: 'button',
      className: 'btn btn--primary',
      textContent: 'إضافة تكريم',
    });
    addBtn.addEventListener('click', () => openForm());
    toolbar.appendChild(addBtn);
  }

  const exportBtn = createEl('button', {
    type: 'button',
    className: 'btn btn--ghost',
    textContent: 'تصدير Excel',
  });
  exportBtn.addEventListener('click', async () => {
    try {
      await exportExcel(
        'honors.xlsx',
        rows.map((r) => ({
          الاسم: r.recipient_name,
          النوع: recipientTypeLabel(r.recipient_type),
          السبب: r.reason || '',
          التاريخ: r.honor_date || '',
          ملاحظات: r.notes || '',
        })),
        'التكريم'
      );
      ctx.showToast('تم التصدير', 'success');
    } catch (err) {
      ctx.handleError(err);
    }
  });
  toolbar.appendChild(exportBtn);

  const tableWrap = createEl('div', { className: 'table-wrap' });
  const tableEl = createEl('table', { className: 'data-table' });
  tableWrap.appendChild(tableEl);
  root.appendChild(tableWrap);
  const pager = createEl('div', { className: 'pagination' });
  root.appendChild(pager);

  const reload = debounce(() => {
    page = 1;
    load();
  }, 250);
  searchInput.addEventListener('input', () => render());
  fromInput.addEventListener('change', reload);
  toInput.addEventListener('change', reload);
  typeFilter.addEventListener('change', reload);

  async function load() {
    try {
      const from = (page - 1) * PAGE_SIZE;
      const filters = [
        { column: 'honor_date', op: 'gte', value: fromInput.value || null },
        { column: 'honor_date', op: 'lte', value: toInput.value || null },
      ];
      if (typeFilter.value) {
        filters.push({ column: 'recipient_type', op: 'eq', value: typeFilter.value });
      }
      const res = await listRows('honors', {
        from,
        to: from + PAGE_SIZE - 1,
        orderBy: 'honor_date',
        ascending: false,
        filters,
      });
      rows = res.data;
      total = res.count;
      render();
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
      (r) => arabicIncludes(r.recipient_name, q) || arabicIncludes(r.reason, q)
    );
  }

  function render() {
    const data = filtered();
    clearElement(tableEl);
    if (!data.length) {
      renderEmpty(tableEl, 'لا توجد تكريمات مطابقة');
      return;
    }
    const thead = createEl('thead');
    const hr = createEl('tr');
    ['الاسم', 'النوع', 'السبب', 'التاريخ', 'إجراءات'].forEach((h) =>
      hr.appendChild(createEl('th', { textContent: h }))
    );
    thead.appendChild(hr);
    const tbody = createEl('tbody');
    data.forEach((r) => {
      const tr = createEl('tr');
      tr.append(
        createEl('td', { textContent: r.recipient_name }),
        createEl('td', { textContent: recipientTypeLabel(r.recipient_type) }),
        createEl('td', { textContent: r.reason || '—' }),
        createEl('td', { textContent: formatDate(r.honor_date) })
      );
      const actions = createEl('td', { className: 'row-actions' });
      const filesBtn = createEl('button', {
        type: 'button',
        className: 'btn btn--ghost btn--sm',
        textContent: 'الشواهد',
      });
      filesBtn.addEventListener('click', () => manageFiles(r));
      actions.appendChild(filesBtn);
      if (ctx.canEdit) {
        const editBtn = createEl('button', {
          type: 'button',
          className: 'btn btn--ghost btn--sm',
          textContent: 'تعديل',
        });
        editBtn.addEventListener('click', () => openForm(r));
        const delBtn = createEl('button', {
          type: 'button',
          className: 'btn btn--danger btn--sm',
          textContent: 'حذف',
        });
        delBtn.addEventListener('click', () => removeHonor(r));
        actions.append(editBtn, delBtn);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    tableEl.append(thead, tbody);
  }

  function openForm(row = null) {
    const form = createEl('form', { className: 'form-grid' });
    const nameInput = createEl('input', { className: 'input', value: row?.recipient_name || '' });
    const typeInput = createEl('select', { className: 'select' }, [
      createEl('option', { value: 'student', textContent: 'طالبة' }),
      createEl('option', { value: 'teacher', textContent: 'معلمة' }),
      createEl('option', { value: 'other', textContent: 'أخرى' }),
    ]);
    typeInput.value = row?.recipient_type || 'student';
    const reasonInput = createEl('textarea', { className: 'textarea' });
    reasonInput.value = row?.reason || '';
    const dateInput = createEl('input', {
      className: 'input',
      type: 'date',
      value: row?.honor_date || '',
    });
    const notesInput = createEl('textarea', { className: 'textarea' });
    notesInput.value = row?.notes || '';
    const filesInput = createEl('input', {
      className: 'input',
      type: 'file',
      multiple: true,
      accept: '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*',
    });

    form.append(
      field('اسم المكرَّم/ة', nameInput),
      field('النوع', typeInput),
      field('سبب التكريم', reasonInput),
      field('تاريخ التكريم', dateInput),
      field('ملاحظات', notesInput)
    );
    if (!row) form.appendChild(field('شواهد (اختياري)', filesInput));

    const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: 'حفظ' });
    form.appendChild(createEl('div', { className: 'modal__actions' }, [saveBtn]));
    const { close } = openModal({
      title: row ? 'تعديل تكريم' : 'إضافة تكريم',
      contentNode: form,
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err =
        validateRequired(nameInput.value, 'الاسم') ||
        validateLength(nameInput.value, 'الاسم', 1, 200);
      if (err) {
        ctx.showToast(err, 'error');
        return;
      }
      const payload = {
        recipient_name: nameInput.value.trim(),
        recipient_type: typeInput.value,
        reason: reasonInput.value.trim() || null,
        honor_date: dateInput.value || null,
        notes: notesInput.value.trim() || null,
      };
      setButtonLoading(saveBtn, true);
      try {
        let honorId = row?.id;
        if (row?.id) {
          await updateRow('honors', row.id, payload, 'honors');
        } else {
          payload.created_by = ctx.user.id;
          const created = await insertRow('honors', payload, 'honors');
          honorId = created.id;
          for (const file of [...(filesInput.files || [])]) {
            await uploadThenInsert(file, 'honors', 'document', async (u) => {
              const sb = getSupabase();
              const { data, error } = await sb
                .from('honor_files')
                .insert({
                  honor_id: honorId,
                  file_path: u.path,
                  file_name: u.fileName,
                  file_type: u.fileType,
                  mime_type: u.mimeType,
                  file_size: u.fileSize,
                  uploaded_by: ctx.user.id,
                })
                .select()
                .single();
              if (error) throw error;
              await writeAudit('upload_file', 'honor_files', data.id, {});
              return data;
            });
          }
        }
        ctx.showToast('تم الحفظ', 'success');
        close();
        load();
      } catch (error) {
        ctx.handleError(error);
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  async function manageFiles(honor) {
    const wrap = createEl('div', { className: 'form-grid' });
    const list = createEl('div', { className: 'list-block' });
    wrap.appendChild(list);

    async function refreshFiles() {
      clearElement(list);
      const files = await fetchChildren('honor_files', 'honor_id', honor.id);
      if (!files.length) {
        renderEmpty(list, 'لا توجد شواهد بعد');
        return;
      }
      for (const f of files) {
        const item = createEl('div', { className: 'list-item' });
        item.append(
          createEl('strong', { textContent: f.file_name }),
          createEl('span', { textContent: formatBytes(f.file_size) })
        );
        const actions = createEl('div', { className: 'row-actions' });
        const previewBtn = createEl('button', {
          type: 'button',
          className: 'btn btn--ghost btn--sm',
          textContent: 'معاينة',
        });
        previewBtn.addEventListener('click', async () => {
          try {
            const url = await createSignedUrl(f.file_path);
            const body = createEl('div');
            if (f.file_type === 'image') {
              body.appendChild(createEl('img', { src: url, alt: f.file_name, className: 'preview-frame' }));
            } else {
              body.appendChild(
                createEl('iframe', { src: url, title: f.file_name, className: 'preview-frame' })
              );
            }
            openModal({ title: f.file_name, contentNode: body });
          } catch (err) {
            ctx.handleError(err);
          }
        });
        actions.appendChild(previewBtn);
        if (ctx.canEdit) {
          const delBtn = createEl('button', {
            type: 'button',
            className: 'btn btn--danger btn--sm',
            textContent: 'حذف',
          });
          delBtn.addEventListener('click', async () => {
            const ok = await confirmDialog({
              title: 'حذف الشاهد',
              message: 'هل أنت متأكد؟',
              confirmText: 'حذف',
              danger: true,
            });
            if (!ok) return;
            try {
              const res = await removeStorageObjects([f.file_path]);
              if (!res.ok) {
                ctx.showToast('تعذّر حذف الملف من التخزين', 'error');
                return;
              }
              await deleteRow('honor_files', f.id, 'honor_files');
              refreshFiles();
            } catch (err) {
              ctx.handleError(err);
            }
          });
          actions.appendChild(delBtn);
        }
        item.appendChild(actions);
        list.appendChild(item);
      }
    }

    if (ctx.canEdit) {
      const fileInput = createEl('input', {
        className: 'input',
        type: 'file',
        multiple: true,
        accept: '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*',
      });
      const upBtn = createEl('button', {
        type: 'button',
        className: 'btn btn--primary',
        textContent: 'رفع شواهد',
      });
      upBtn.addEventListener('click', async () => {
        const files = [...(fileInput.files || [])];
        if (!files.length) return;
        setButtonLoading(upBtn, true, 'جارٍ الرفع...');
        try {
          for (const file of files) {
            await uploadThenInsert(file, 'honors', 'document', async (u) => {
              const sb = getSupabase();
              const { data, error } = await sb
                .from('honor_files')
                .insert({
                  honor_id: honor.id,
                  file_path: u.path,
                  file_name: u.fileName,
                  file_type: u.fileType,
                  mime_type: u.mimeType,
                  file_size: u.fileSize,
                  uploaded_by: ctx.user.id,
                })
                .select()
                .single();
              if (error) throw error;
              return data;
            });
          }
          await refreshFiles();
          ctx.showToast('تم الرفع', 'success');
        } catch (err) {
          ctx.handleError(err);
        } finally {
          setButtonLoading(upBtn, false);
        }
      });
      wrap.append(field('ملفات', fileInput), upBtn);
    }

    openModal({ title: `شواهد: ${honor.recipient_name}`, contentNode: wrap });
    await refreshFiles();
  }

  async function removeHonor(row) {
    const ok = await confirmDialog({
      title: 'حذف التكريم',
      message: 'سيتم حذف التكريم وشواهده. هل أنت متأكد؟',
      confirmText: 'حذف',
      danger: true,
    });
    if (!ok) return;
    try {
      const files = await fetchChildren('honor_files', 'honor_id', row.id);
      const paths = files.map((f) => f.file_path);
      if (paths.length) {
        const res = await removeStorageObjects(paths);
        if (!res.ok) {
          logDev(res.error);
          ctx.showToast('تعذّر حذف الملفات من التخزين', 'error');
          return;
        }
      }
      await deleteRow('honors', row.id, 'honors');
      ctx.showToast('تم الحذف', 'success');
      load();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  await load();
});
