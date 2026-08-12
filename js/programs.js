/**
 * programs.js
 */
import { bootProtectedPage } from './app.js';
import { listRows, insertRow, updateRow, deleteRow } from './supabase-service.js';
import { PAGE_SIZE } from './config.js';
import {
  createEl,
  clearElement,
  formatDate,
  debounce,
  arabicIncludes,
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

bootProtectedPage({ title: 'البرامج والأنشطة' }, async (ctx) => {
  const root = ctx.content;
  let tab = 'classroom_programs';
  let page = 1;
  let cache = [];

  const tabs = createEl('div', { className: 'tabs no-print' });
  const tabClassroom = createEl('button', {
    type: 'button',
    className: 'tab is-active',
    textContent: 'النشاط الصفي',
  });
  const tabExtra = createEl('button', {
    type: 'button',
    className: 'tab',
    textContent: 'النشاط اللاصفي',
  });
  tabs.append(tabClassroom, tabExtra);
  root.appendChild(tabs);

  const toolbar = buildToolbar(root, []);
  const searchInput = createEl('input', {
    className: 'input',
    type: 'search',
    placeholder: 'بحث...',
    'aria-label': 'بحث',
  });
  const fromInput = createEl('input', { className: 'input', type: 'date', 'aria-label': 'من' });
  const toInput = createEl('input', { className: 'input', type: 'date', 'aria-label': 'إلى' });
  const sortSelect = createEl('select', { className: 'select', 'aria-label': 'ترتيب' }, [
    createEl('option', { value: 'date-desc', textContent: 'الأحدث تاريخاً' }),
    createEl('option', { value: 'date-asc', textContent: 'الأقدم تاريخاً' }),
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
      textContent: 'إضافة برنامج',
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
      const rows = applyClientFilters(cache).map((r) => ({
        اسم_البرنامج: r.program_name,
        المعلمة: r.teacher_name || '',
        تاريخ_التنفيذ: r.execution_date || '',
        ملاحظات: r.notes || '',
      }));
      await exportExcel(`${tab}-export.xlsx`, rows, 'البرامج');
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
  const pager = createEl('div', { className: 'pagination no-print' });
  root.appendChild(pager);

  tabClassroom.addEventListener('click', () => switchTab('classroom_programs', tabClassroom, tabExtra));
  tabExtra.addEventListener('click', () =>
    switchTab('extracurricular_programs', tabExtra, tabClassroom)
  );

  const reloadDebounced = debounce(() => {
    page = 1;
    load();
  }, 250);
  searchInput.addEventListener('input', () => {
    renderTable();
  });
  fromInput.addEventListener('change', reloadDebounced);
  toInput.addEventListener('change', reloadDebounced);
  sortSelect.addEventListener('change', () => {
    page = 1;
    load();
  });

  function switchTab(next, activeBtn, otherBtn) {
    tab = next;
    page = 1;
    activeBtn.classList.add('is-active');
    otherBtn.classList.remove('is-active');
    load();
  }

  function sortOptions() {
    if (sortSelect.value === 'name') return { orderBy: 'program_name', ascending: true };
    if (sortSelect.value === 'date-asc') return { orderBy: 'execution_date', ascending: true };
    return { orderBy: 'execution_date', ascending: false };
  }

  async function load() {
    try {
      const sort = sortOptions();
      const from = (page - 1) * PAGE_SIZE;
      const { data, count } = await listRows(tab, {
        from,
        to: from + PAGE_SIZE - 1,
        orderBy: sort.orderBy,
        ascending: sort.ascending,
        filters: [
          { column: 'execution_date', op: 'gte', value: fromInput.value || null },
          { column: 'execution_date', op: 'lte', value: toInput.value || null },
        ],
      });
      cache = data;
      renderTable();
      renderPagination(pager, {
        page,
        pageSize: PAGE_SIZE,
        total: count,
        onChange: (p) => {
          page = p;
          load();
        },
      });
    } catch (err) {
      ctx.handleError(err);
    }
  }

  function applyClientFilters(rows) {
    const q = searchInput.value.trim();
    if (!q) return rows;
    return rows.filter(
      (r) =>
        arabicIncludes(r.program_name, q) ||
        arabicIncludes(r.teacher_name, q) ||
        arabicIncludes(r.notes, q)
    );
  }

  function renderTable() {
    const rows = applyClientFilters(cache);
    clearElement(tableEl);
    if (!rows.length) {
      renderEmpty(tableEl, 'لا توجد برامج مطابقة');
      return;
    }
    const thead = createEl('thead');
    const hr = createEl('tr');
    ['البرنامج', 'المعلمة', 'تاريخ التنفيذ', 'إجراءات'].forEach((h) =>
      hr.appendChild(createEl('th', { textContent: h }))
    );
    thead.appendChild(hr);
    const tbody = createEl('tbody');
    rows.forEach((r) => {
      const tr = createEl('tr');
      tr.append(
        createEl('td', { textContent: r.program_name }),
        createEl('td', { textContent: r.teacher_name || '—' }),
        createEl('td', { textContent: formatDate(r.execution_date) })
      );
      const actions = createEl('td', { className: 'row-actions' });
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
        delBtn.addEventListener('click', async () => {
          const ok = await confirmDialog({
            title: 'حذف البرنامج',
            message: 'هل أنت متأكد من حذف هذا السجل؟ لا يمكن التراجع عن هذا الإجراء.',
            confirmText: 'حذف',
            danger: true,
          });
          if (!ok) return;
          try {
            await deleteRow(tab, r.id, tab);
            ctx.showToast('تم الحذف', 'success');
            load();
          } catch (err) {
            ctx.handleError(err);
          }
        });
        actions.append(editBtn, delBtn);
      } else {
        actions.appendChild(createEl('span', { className: 'muted', textContent: 'عرض فقط' }));
      }
      tr.appendChild(actions);
      tbody.appendChild(tr);
    });
    tableEl.append(thead, tbody);
  }

  function openForm(row = null) {
    const form = createEl('form', { className: 'form-grid' });
    const nameInput = createEl('input', {
      className: 'input',
      required: true,
      maxlength: '200',
      value: row?.program_name || '',
    });
    const teacherInput = createEl('input', {
      className: 'input',
      value: row?.teacher_name || '',
    });
    const dateInput = createEl('input', {
      className: 'input',
      type: 'date',
      value: row?.execution_date || '',
    });
    const notesInput = createEl('textarea', { className: 'textarea' });
    notesInput.value = row?.notes || '';
    form.append(
      field('اسم البرنامج', nameInput),
      field('اسم المعلمة', teacherInput),
      field('تاريخ التنفيذ', dateInput),
      field('ملاحظات', notesInput)
    );
    const saveBtn = createEl('button', {
      type: 'submit',
      className: 'btn btn--primary',
      textContent: 'حفظ',
    });
    form.appendChild(createEl('div', { className: 'modal__actions' }, [saveBtn]));
    const { close } = openModal({
      title: row ? 'تعديل برنامج' : 'إضافة برنامج',
      contentNode: form,
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err =
        validateRequired(nameInput.value, 'اسم البرنامج') ||
        validateLength(nameInput.value, 'اسم البرنامج', 1, 200);
      if (err) {
        ctx.showToast(err, 'error');
        return;
      }
      const payload = {
        program_name: nameInput.value.trim(),
        teacher_name: teacherInput.value.trim() || null,
        execution_date: dateInput.value || null,
        notes: notesInput.value.trim() || null,
      };
      setButtonLoading(saveBtn, true);
      try {
        if (row?.id) {
          await updateRow(tab, row.id, payload, tab);
          ctx.showToast('تم التحديث', 'success');
        } else {
          payload.created_by = ctx.user.id;
          await insertRow(tab, payload, tab);
          ctx.showToast('تمت الإضافة', 'success');
        }
        close();
        load();
      } catch (error) {
        ctx.handleError(error);
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  }

  await load();
});
