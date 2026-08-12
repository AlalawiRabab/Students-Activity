/**
 * competitions.js
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

bootProtectedPage({ title: 'المسابقات' }, async (ctx) => {
  const root = ctx.content;
  let page = 1;
  let rows = [];
  let total = 0;

  const toolbar = buildToolbar(root, []);
  const searchInput = createEl('input', { className: 'input', type: 'search', 'aria-label': 'بحث' });
  const fromInput = createEl('input', { className: 'input', type: 'date', 'aria-label': 'من' });
  const toInput = createEl('input', { className: 'input', type: 'date', 'aria-label': 'إلى' });
  const sortSelect = createEl('select', { className: 'select' }, [
    createEl('option', { value: 'desc', textContent: 'الأحدث' }),
    createEl('option', { value: 'asc', textContent: 'الأقدم' }),
    createEl('option', { value: 'name', textContent: 'الاسم' }),
  ]);
  toolbar.append(
    field('بحث', searchInput),
    field('من', fromInput),
    field('إلى', toInput),
    field('ترتيب', sortSelect)
  );

  if (ctx.canEdit) {
    const addBtn = createEl('button', {
      type: 'button',
      className: 'btn btn--primary',
      textContent: 'إضافة مسابقة',
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
        'competitions.xlsx',
        rows.map((r) => ({
          المسابقة: r.competition_name,
          المعلمة: r.teacher_name || '',
          المشاركات: r.participant_students || '',
          التاريخ: r.competition_date || '',
          النتيجة: r.result || '',
          ملاحظات: r.notes || '',
        })),
        'المسابقات'
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
  sortSelect.addEventListener('change', reload);

  async function load() {
    try {
      const ascending = sortSelect.value === 'asc';
      const orderBy = sortSelect.value === 'name' ? 'competition_name' : 'competition_date';
      const from = (page - 1) * PAGE_SIZE;
      const res = await listRows('competitions', {
        from,
        to: from + PAGE_SIZE - 1,
        orderBy,
        ascending: sortSelect.value === 'name' ? true : ascending,
        filters: [
          { column: 'competition_date', op: 'gte', value: fromInput.value || null },
          { column: 'competition_date', op: 'lte', value: toInput.value || null },
        ],
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
      (r) =>
        arabicIncludes(r.competition_name, q) ||
        arabicIncludes(r.teacher_name, q) ||
        arabicIncludes(r.participant_students, q)
    );
  }

  function render() {
    const data = filtered();
    clearElement(tableEl);
    if (!data.length) {
      renderEmpty(tableEl, 'لا توجد مسابقات مطابقة');
      return;
    }
    const thead = createEl('thead');
    const hr = createEl('tr');
    ['المسابقة', 'المعلمة', 'التاريخ', 'النتيجة', 'إجراءات'].forEach((h) =>
      hr.appendChild(createEl('th', { textContent: h }))
    );
    thead.appendChild(hr);
    const tbody = createEl('tbody');
    data.forEach((r) => {
      const tr = createEl('tr');
      tr.append(
        createEl('td', { textContent: r.competition_name }),
        createEl('td', { textContent: r.teacher_name || '—' }),
        createEl('td', { textContent: formatDate(r.competition_date) }),
        createEl('td', { textContent: r.result || '—' })
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
        delBtn.addEventListener('click', () => removeCompetition(r));
        actions.append(editBtn, delBtn);
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    tableEl.append(thead, tbody);
  }

  function openForm(row = null) {
    const form = createEl('form', { className: 'form-grid' });
    const nameInput = createEl('input', { className: 'input', value: row?.competition_name || '' });
    const teacherInput = createEl('input', { className: 'input', value: row?.teacher_name || '' });
    const studentsInput = createEl('textarea', { className: 'textarea' });
    studentsInput.value = row?.participant_students || '';
    const dateInput = createEl('input', {
      className: 'input',
      type: 'date',
      value: row?.competition_date || '',
    });
    const resultInput = createEl('input', { className: 'input', value: row?.result || '' });
    const notesInput = createEl('textarea', { className: 'textarea' });
    notesInput.value = row?.notes || '';
    const filesInput = createEl('input', {
      className: 'input',
      type: 'file',
      multiple: true,
      accept: '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/*',
    });

    form.append(
      field('اسم المسابقة', nameInput),
      field('اسم المعلمة', teacherInput),
      field('الطالبات المشاركات', studentsInput),
      field('تاريخ المسابقة', dateInput),
      field('النتيجة', resultInput),
      field('ملاحظات', notesInput)
    );
    if (!row && ctx.canEdit) {
      form.appendChild(field('شواهد (اختياري)', filesInput));
    }
    const saveBtn = createEl('button', { type: 'submit', className: 'btn btn--primary', textContent: 'حفظ' });
    form.appendChild(createEl('div', { className: 'modal__actions' }, [saveBtn]));
    const { close } = openModal({
      title: row ? 'تعديل مسابقة' : 'إضافة مسابقة',
      contentNode: form,
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err =
        validateRequired(nameInput.value, 'اسم المسابقة') ||
        validateLength(nameInput.value, 'اسم المسابقة', 1, 200);
      if (err) {
        ctx.showToast(err, 'error');
        return;
      }
      const payload = {
        competition_name: nameInput.value.trim(),
        teacher_name: teacherInput.value.trim() || null,
        participant_students: studentsInput.value.trim() || null,
        competition_date: dateInput.value || null,
        result: resultInput.value.trim() || null,
        notes: notesInput.value.trim() || null,
      };
      setButtonLoading(saveBtn, true);
      try {
        let competitionId = row?.id;
        if (row?.id) {
          await updateRow('competitions', row.id, payload, 'competitions');
        } else {
          payload.created_by = ctx.user.id;
          const created = await insertRow('competitions', payload, 'competitions');
          competitionId = created.id;
          const files = [...(filesInput.files || [])];
          for (const file of files) {
            await uploadThenInsert(file, 'competitions', 'document', async (u) => {
              const sb = getSupabase();
              const { data, error } = await sb
                .from('competition_files')
                .insert({
                  competition_id: competitionId,
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
              await writeAudit('upload_file', 'competition_files', data.id, {
                competition_id: competitionId,
              });
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

  async function manageFiles(competition) {
    const wrap = createEl('div', { className: 'form-grid' });
    const list = createEl('div', { className: 'list-block' });
    wrap.appendChild(list);

    async function refreshFiles() {
      clearElement(list);
      const files = await fetchChildren('competition_files', 'competition_id', competition.id);
      if (!files.length) {
        renderEmpty(list, 'لا توجد شواهد بعد');
      } else {
        for (const f of files) {
          const item = createEl('div', { className: 'list-item' });
          item.append(
            createEl('strong', { textContent: f.file_name }),
            createEl('span', { textContent: `${f.file_type} · ${formatBytes(f.file_size)}` })
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
                  createEl('iframe', { src: url, className: 'preview-frame', title: f.file_name })
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
              textContent: 'حذف الشاهد',
            });
            delBtn.addEventListener('click', async () => {
              const ok = await confirmDialog({
                title: 'حذف الشاهد',
                message: 'هل أنت متأكد من حذف هذا الملف؟',
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
                await deleteRow('competition_files', f.id, 'competition_files');
                await writeAudit('delete_file', 'competition_files', f.id, {});
                ctx.showToast('تم حذف الشاهد', 'success');
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
        if (!files.length) {
          ctx.showToast('اختر ملفات', 'error');
          return;
        }
        setButtonLoading(upBtn, true, 'جارٍ الرفع...');
        try {
          for (const file of files) {
            await uploadThenInsert(file, 'competitions', 'document', async (u) => {
              const sb = getSupabase();
              const { data, error } = await sb
                .from('competition_files')
                .insert({
                  competition_id: competition.id,
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
              await writeAudit('upload_file', 'competition_files', data.id, {});
              return data;
            });
          }
          fileInput.value = '';
          ctx.showToast('تم رفع الشواهد', 'success');
          await refreshFiles();
        } catch (err) {
          ctx.handleError(err);
        } finally {
          setButtonLoading(upBtn, false);
        }
      });
      wrap.append(field('رفع ملفات', fileInput), upBtn);
    }

    openModal({ title: `شواهد: ${competition.competition_name}`, contentNode: wrap });
    try {
      await refreshFiles();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  async function removeCompetition(row) {
    const ok = await confirmDialog({
      title: 'حذف المسابقة',
      message: 'سيتم حذف المسابقة وشواهدها. هل أنت متأكد؟',
      confirmText: 'حذف',
      danger: true,
    });
    if (!ok) return;
    try {
      const files = await fetchChildren('competition_files', 'competition_id', row.id);
      const paths = files.map((f) => f.file_path);
      if (paths.length) {
        const res = await removeStorageObjects(paths);
        if (!res.ok) {
          logDev(res.error);
          ctx.showToast('تعذّر حذف بعض الملفات من التخزين، أوقفنا الحذف لحماية الاتساق', 'error');
          return;
        }
      }
      await deleteRow('competitions', row.id, 'competitions');
      ctx.showToast('تم الحذف', 'success');
      load();
    } catch (err) {
      ctx.handleError(err);
    }
  }

  await load();
});
