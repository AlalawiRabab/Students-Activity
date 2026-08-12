/**
 * calendar.js — مشترك للأولية والعليا
 */
import { bootProtectedPage } from './app.js';
import { listRows, insertRow, updateRow, deleteRow } from './supabase-service.js';
import {
  createEl,
  clearElement,
  localDateKey,
  normalizeDbDate,
  formatHijri,
  formatDate,
  parseYMD,
  arabicIncludes,
} from './utils.js';
import {
  field,
  setButtonLoading,
  confirmDialog,
  openModal,
  renderEmpty,
  buildToolbar,
} from './ui.js';
import { exportExcel } from './export.js';
import { validateRequired, validateLength } from './validators.js';

export function initCalendarPage({ table, title }) {
  bootProtectedPage({ title }, async (ctx) => {
    const root = ctx.content;
    let viewDate = new Date();
    viewDate.setDate(1);
    let allMonthRows = [];
    /** @type {Map<string, object[]>} */
    let activitiesByDate = new Map();
    let selectedDate = localDateKey(new Date());

    const toolbar = buildToolbar(root, []);
    const searchInput = createEl('input', {
      className: 'input',
      type: 'search',
      placeholder: 'بحث باسم النشاط...',
      'aria-label': 'بحث',
    });
    const fromInput = createEl('input', { className: 'input', type: 'date', 'aria-label': 'من تاريخ' });
    const toInput = createEl('input', { className: 'input', type: 'date', 'aria-label': 'إلى تاريخ' });
    const sortSelect = createEl('select', { className: 'select', 'aria-label': 'ترتيب' }, [
      createEl('option', { value: 'desc', textContent: 'الأحدث' }),
      createEl('option', { value: 'asc', textContent: 'الأقدم' }),
    ]);

    toolbar.append(
      field('بحث', searchInput),
      field('من', fromInput),
      field('إلى', toInput),
      field('ترتيب القائمة', sortSelect)
    );

    if (ctx.canEdit) {
      const addBtn = createEl('button', {
        type: 'button',
        className: 'btn btn--primary',
        textContent: 'إضافة نشاط',
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
        const rows = filteredList().map((r) => ({
          التاريخ_الميلادي: r.gregorian_date,
          التاريخ_الهجري: r.hijri_date || '',
          اسم_النشاط: r.activity_name,
          الوصف: r.description || '',
          ملاحظات: r.notes || '',
        }));
        await exportExcel(`${table}-export.xlsx`, rows, 'التقويم');
        ctx.showToast('تم التصدير بنجاح', 'success');
      } catch (err) {
        ctx.handleError(err);
      }
    });
    toolbar.appendChild(exportBtn);

    const nav = createEl('div', { className: 'calendar-nav' });
    const prev = createEl('button', { type: 'button', className: 'btn btn--ghost', textContent: 'الشهر السابق' });
    const next = createEl('button', { type: 'button', className: 'btn btn--ghost', textContent: 'الشهر التالي' });
    const todayBtn = createEl('button', { type: 'button', className: 'btn btn--ghost', textContent: 'اليوم' });
    const monthLabel = createEl('strong', { id: 'month-label' });
    nav.append(prev, next, todayBtn, monthLabel);
    root.appendChild(nav);

    const grid = createEl('div', { className: 'calendar-grid', id: 'cal-grid', 'aria-label': 'التقويم' });
    root.appendChild(grid);

    const listSection = createEl('section', { className: 'section' });
    listSection.appendChild(createEl('h3', { className: 'section__title', textContent: 'قائمة الأنشطة' }));
    const tableWrap = createEl('div', { className: 'table-wrap' });
    const tableEl = createEl('table', { className: 'data-table' });
    tableWrap.appendChild(tableEl);
    listSection.appendChild(tableWrap);
    root.appendChild(listSection);

    prev.addEventListener('click', () => {
      viewDate.setMonth(viewDate.getMonth() - 1);
      loadMonth();
    });
    next.addEventListener('click', () => {
      viewDate.setMonth(viewDate.getMonth() + 1);
      loadMonth();
    });
    todayBtn.addEventListener('click', () => {
      viewDate = new Date();
      viewDate.setDate(1);
      selectedDate = localDateKey(new Date());
      loadMonth();
    });

    const refreshList = () => renderList();
    searchInput.addEventListener('input', refreshList);
    fromInput.addEventListener('change', refreshList);
    toInput.addEventListener('change', refreshList);
    sortSelect.addEventListener('change', refreshList);

    function rebuildActivitiesMap(rows) {
      const map = new Map();
      (rows || []).forEach((r) => {
        const key = normalizeDbDate(r.gregorian_date);
        if (!key) return;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(r);
      });
      return map;
    }

    function rowsByDate(ymd) {
      const key = normalizeDbDate(ymd) || String(ymd || '').slice(0, 10);
      return activitiesByDate.get(key) || [];
    }

    async function loadMonth() {
      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      const start = localDateKey(new Date(y, m, 1));
      const end = localDateKey(new Date(y, m + 1, 0));
      monthLabel.textContent = new Intl.DateTimeFormat('ar-SA', {
        month: 'long',
        year: 'numeric',
      }).format(viewDate);

      try {
        const { data } = await listRows(table, {
          from: 0,
          to: 999,
          orderBy: 'gregorian_date',
          ascending: true,
          filters: [
            { column: 'gregorian_date', op: 'gte', value: start },
            { column: 'gregorian_date', op: 'lte', value: end },
          ],
        });
        allMonthRows = data || [];
        activitiesByDate = rebuildActivitiesMap(allMonthRows);

        renderCalendar();
        renderList();
      } catch (err) {
        ctx.handleError(err);
      }
    }

    function renderCalendar() {
      clearElement(grid);
      ['أحد', 'إثنين', 'ثلاثاء', 'أربعاء', 'خميس', 'جمعة', 'سبت'].forEach((d) => {
        grid.appendChild(createEl('div', { className: 'cal-head', textContent: d }));
      });

      const y = viewDate.getFullYear();
      const m = viewDate.getMonth();
      const firstDow = new Date(y, m, 1).getDay();
      const daysInMonth = new Date(y, m + 1, 0).getDate();
      const today = localDateKey(new Date());

      for (let i = 0; i < firstDow; i += 1) {
        grid.appendChild(createEl('div', { className: 'cal-day is-muted', 'aria-hidden': 'true' }));
      }

      for (let day = 1; day <= daysInMonth; day += 1) {
        const cellDateObj = new Date(y, m, day);
        const cellDate = localDateKey(cellDateObj);
        const dayActivities = activitiesByDate.get(cellDate) || [];

        // مهم: لا نستخدم <button> كحاوية لـ <div> — HTML غير صالح وقد يُخرج المتصفح المحتوى من الخلية
        const cell = createEl('div', {
          className: `cal-day${cellDate === today ? ' is-today' : ''}`,
          role: 'button',
          tabindex: '0',
          'aria-label': `يوم ${day}${dayActivities.length ? `، ${dayActivities.length} نشاط` : ''}`,
          dataset: { date: cellDate },
        });

        const inner = createEl('div', { className: 'cal-day__inner' });
        inner.append(
          createEl('div', { className: 'cal-day__num', textContent: String(day) }),
          createEl('div', { className: 'cal-day__meta', textContent: formatHijri(cellDateObj) })
        );

        const list = createEl('div', { className: 'cal-day__activities' });
        dayActivities.forEach((ev) => {
          const name = String(ev.activity_name || '').trim();
          if (!name) return;
          list.appendChild(
            createEl('div', {
              className: 'cal-activity',
              title: name,
              textContent: name,
            })
          );
        });
        inner.appendChild(list);
        cell.appendChild(inner);

        const open = () => openDay(cellDate);
        cell.addEventListener('click', open);
        cell.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            open();
          }
        });
        grid.appendChild(cell);
      }
    }

    function filteredList() {
      let rows = [...allMonthRows];
      const q = searchInput.value.trim();
      if (q) {
        rows = rows.filter(
          (r) => arabicIncludes(r.activity_name, q) || arabicIncludes(r.description, q)
        );
      }
      if (fromInput.value) {
        rows = rows.filter((r) => normalizeDbDate(r.gregorian_date) >= fromInput.value);
      }
      if (toInput.value) {
        rows = rows.filter((r) => normalizeDbDate(r.gregorian_date) <= toInput.value);
      }
      rows.sort((a, b) => {
        const cmp = normalizeDbDate(a.gregorian_date).localeCompare(
          normalizeDbDate(b.gregorian_date)
        );
        return sortSelect.value === 'asc' ? cmp : -cmp;
      });
      return rows;
    }

    function renderList() {
      const rows = filteredList();
      clearElement(tableEl);
      if (!rows.length) {
        renderEmpty(tableEl, 'لا توجد أنشطة مطابقة');
        return;
      }
      const thead = createEl('thead');
      const hr = createEl('tr');
      ['التاريخ', 'هجري', 'النشاط', 'إجراءات'].forEach((h) =>
        hr.appendChild(createEl('th', { textContent: h }))
      );
      thead.appendChild(hr);
      const tbody = createEl('tbody');
      rows.forEach((r) => {
        const tr = createEl('tr');
        tr.append(
          createEl('td', { textContent: formatDate(r.gregorian_date) }),
          createEl('td', { textContent: r.hijri_date || '—' }),
          createEl('td', { textContent: r.activity_name })
        );
        const actions = createEl('td', { className: 'row-actions' });
        const viewBtn = createEl('button', {
          type: 'button',
          className: 'btn btn--ghost btn--sm',
          textContent: 'عرض',
        });
        viewBtn.addEventListener('click', () =>
          openDay(normalizeDbDate(r.gregorian_date), r)
        );
        actions.appendChild(viewBtn);
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
          delBtn.addEventListener('click', () => removeRow(r));
          actions.append(editBtn, delBtn);
        }
        tr.appendChild(actions);
        tbody.appendChild(tr);
      });
      tableEl.append(thead, tbody);
    }

    function openDay(ymd, focusRow = null) {
      const dayKey = normalizeDbDate(ymd) || ymd;
      selectedDate = dayKey;
      const events = rowsByDate(dayKey);
      const wrap = createEl('div', { className: 'form-grid' });
      wrap.appendChild(
        createEl('p', {
          className: 'muted',
          textContent: `${formatDate(dayKey)} — ${formatHijri(parseYMD(dayKey) || dayKey)}`,
        })
      );

      if (!events.length) {
        wrap.appendChild(createEl('p', { textContent: 'لا توجد أنشطة في هذا اليوم بعد' }));
      } else {
        events.forEach((e) => {
          const item = createEl('div', { className: 'list-item' });
          item.append(
            createEl('strong', { textContent: e.activity_name }),
            createEl('span', { textContent: e.description || 'بدون وصف' })
          );
          if (ctx.canEdit) {
            const row = createEl('div', { className: 'row-actions' });
            const editBtn = createEl('button', {
              type: 'button',
              className: 'btn btn--ghost btn--sm',
              textContent: 'تعديل',
            });
            editBtn.addEventListener('click', () => {
              modalClose();
              openForm(e);
            });
            row.appendChild(editBtn);
            item.appendChild(row);
          }
          wrap.appendChild(item);
        });
      }

      if (ctx.canEdit) {
        const add = createEl('button', {
          type: 'button',
          className: 'btn btn--primary',
          textContent: 'إضافة نشاط لهذا اليوم',
        });
        add.addEventListener('click', () => {
          modalClose();
          openForm({ gregorian_date: dayKey });
        });
        wrap.appendChild(add);
      }

      if (focusRow) {
        wrap.appendChild(
          createEl('p', {
            textContent: `ملاحظات: ${focusRow.notes || '—'}`,
          })
        );
      }

      const { close: modalClose } = openModal({ title: 'أنشطة اليوم', contentNode: wrap });
    }

    function openForm(row = null) {
      const wrap = createEl('form', { className: 'form-grid' });
      const initialDate =
        normalizeDbDate(row?.gregorian_date) || selectedDate || localDateKey(new Date());
      const dateInput = createEl('input', {
        className: 'input',
        type: 'date',
        required: true,
        value: initialDate,
      });
      const nameInput = createEl('input', {
        className: 'input',
        required: true,
        maxlength: '200',
        value: row?.activity_name || '',
      });
      const descInput = createEl('textarea', { className: 'textarea' });
      descInput.value = row?.description || '';
      const notesInput = createEl('textarea', { className: 'textarea' });
      notesInput.value = row?.notes || '';

      wrap.append(
        field('التاريخ الميلادي', dateInput),
        field('اسم النشاط', nameInput),
        field('الوصف', descInput),
        field('ملاحظات', notesInput)
      );

      const actions = createEl('div', { className: 'modal__actions' });
      const saveBtn = createEl('button', {
        type: 'submit',
        className: 'btn btn--primary',
        textContent: 'حفظ',
      });
      actions.appendChild(saveBtn);
      wrap.appendChild(actions);

      const { close } = openModal({
        title: row?.id ? 'تعديل نشاط' : 'إضافة نشاط',
        contentNode: wrap,
      });

      wrap.addEventListener('submit', async (e) => {
        e.preventDefault();
        const nameErr =
          validateRequired(nameInput.value, 'اسم النشاط') ||
          validateLength(nameInput.value, 'اسم النشاط', 1, 200);
        if (nameErr) {
          ctx.showToast(nameErr, 'error');
          return;
        }
        if (!dateInput.value) {
          ctx.showToast('التاريخ مطلوب', 'error');
          return;
        }

        const payload = {
          gregorian_date: dateInput.value,
          hijri_date: formatHijri(parseYMD(dateInput.value)),
          activity_name: nameInput.value.trim(),
          description: descInput.value.trim() || null,
          notes: notesInput.value.trim() || null,
        };

        setButtonLoading(saveBtn, true);
        try {
          if (row?.id) {
            await updateRow(table, row.id, payload, table);
            ctx.showToast('تم التحديث بنجاح', 'success');
          } else {
            payload.created_by = ctx.user.id;
            await insertRow(table, payload, table);
            ctx.showToast('تمت الإضافة بنجاح', 'success');
          }
          close();
          await loadMonth();
        } catch (err) {
          ctx.handleError(err);
        } finally {
          setButtonLoading(saveBtn, false);
        }
      });
    }

    async function removeRow(row) {
      const ok = await confirmDialog({
        title: 'حذف النشاط',
        message: 'هل أنت متأكد من حذف هذا السجل؟ لا يمكن التراجع عن هذا الإجراء.',
        confirmText: 'حذف',
        danger: true,
      });
      if (!ok) return;
      try {
        await deleteRow(table, row.id, table);
        ctx.showToast('تم الحذف', 'success');
        await loadMonth();
      } catch (err) {
        ctx.handleError(err);
      }
    }

    await loadMonth();
  });
}
