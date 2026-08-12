/**
 * settings.js
 */
import { bootProtectedPage } from './app.js';
import { updateSettings } from './supabase-service.js';
import { changePassword, logout } from './auth.js';
import { exportDataBackup, importDataBackup } from './export.js';
import { createEl } from './utils.js';
import {
  field,
  setButtonLoading,
  confirmDialog,
  buildToolbar,
} from './ui.js';
import { validateRequired, validateLength, validatePassword } from './validators.js';

bootProtectedPage({ title: 'الإعدادات', showPrint: false }, async (ctx) => {
  const root = ctx.content;
  buildToolbar(root, []);

  const grid = createEl('div', { className: 'settings-grid' });
  root.appendChild(grid);

  // إعدادات المنصة
  const platformCard = createEl('section', { className: 'card settings-card' });
  platformCard.appendChild(createEl('h3', { textContent: 'إعدادات المنصة' }));
  const platformForm = createEl('form', { className: 'form-grid' });
  const platformName = createEl('input', {
    className: 'input',
    value: ctx.settings.platform_name || '',
    disabled: !ctx.isAdmin,
  });
  const leaderName = createEl('input', {
    className: 'input',
    value: ctx.settings.leader_name || '',
    disabled: !ctx.isAdmin,
  });
  platformForm.append(
    field('اسم المنصة', platformName),
    field('اسم رائدة النشاط', leaderName)
  );
  if (ctx.isAdmin) {
    const saveBtn = createEl('button', {
      type: 'submit',
      className: 'btn btn--primary',
      textContent: 'حفظ الإعدادات',
    });
    platformForm.appendChild(saveBtn);
    platformForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err =
        validateRequired(platformName.value, 'اسم المنصة') ||
        validateLength(platformName.value, 'اسم المنصة', 1, 120) ||
        validateRequired(leaderName.value, 'اسم رائدة النشاط') ||
        validateLength(leaderName.value, 'اسم رائدة النشاط', 1, 120);
      if (err) {
        ctx.showToast(err, 'error');
        return;
      }
      setButtonLoading(saveBtn, true);
      try {
        const updated = await updateSettings(
          platformName.value,
          leaderName.value,
          ctx.user.id
        );
        ctx.settings.platform_name = updated.platform_name;
        ctx.settings.leader_name = updated.leader_name;
        ctx.showToast('تم حفظ إعدادات المنصة', 'success');
      } catch (error) {
        ctx.handleError(error);
      } finally {
        setButtonLoading(saveBtn, false);
      }
    });
  } else {
    platformForm.appendChild(
      createEl('p', {
        className: 'muted',
        textContent: 'تعديل اسم المنصة ورائدة النشاط متاح للمدير فقط.',
      })
    );
  }
  platformCard.appendChild(platformForm);
  grid.appendChild(platformCard);

  // الحساب
  const accountCard = createEl('section', { className: 'card settings-card' });
  accountCard.appendChild(createEl('h3', { textContent: 'الحساب' }));
  const passForm = createEl('form', { className: 'form-grid' });
  const pass1 = createEl('input', {
    className: 'input',
    type: 'password',
    autocomplete: 'new-password',
  });
  const pass2 = createEl('input', {
    className: 'input',
    type: 'password',
    autocomplete: 'new-password',
  });
  passForm.append(
    field('كلمة المرور الجديدة', pass1, '8 أحرف على الأقل وتشمل حروفاً وأرقاماً'),
    field('تأكيد كلمة المرور', pass2)
  );
  const passBtn = createEl('button', {
    type: 'submit',
    className: 'btn btn--primary',
    textContent: 'تغيير كلمة المرور',
  });
  passForm.appendChild(passBtn);
  passForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = validatePassword(pass1.value);
    if (err) {
      ctx.showToast(err, 'error');
      return;
    }
    if (pass1.value !== pass2.value) {
      ctx.showToast('كلمتا المرور غير متطابقتين', 'error');
      return;
    }
    setButtonLoading(passBtn, true);
    try {
      await changePassword(pass1.value);
      pass1.value = '';
      pass2.value = '';
      ctx.showToast('تم تغيير كلمة المرور بنجاح', 'success');
    } catch (error) {
      ctx.handleError(error);
    } finally {
      setButtonLoading(passBtn, false);
    }
  });

  const logoutBtn = createEl('button', {
    type: 'button',
    className: 'btn btn--ghost',
    textContent: 'تسجيل الخروج',
  });
  logoutBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'تسجيل الخروج',
      message: 'هل تريد تسجيل الخروج؟',
      confirmText: 'خروج',
      danger: true,
    });
    if (ok) await logout();
  });

  accountCard.append(passForm, createEl('div', { style: 'margin-top:1rem' }, [logoutBtn]));
  grid.appendChild(accountCard);

  // النسخ الاحتياطي
  const backupCard = createEl('section', { className: 'card settings-card' });
  backupCard.append(
    createEl('h3', { textContent: 'النسخ الاحتياطي للبيانات' }),
    createEl('p', {
      className: 'muted',
      textContent:
        'هذا تصدير JSON لبيانات المنصة التي تملك صلاحية قراءتها. النسخ الاحتياطي الحقيقي لقاعدة PostgreSQL يتم من لوحة Supabase أو أدوات PostgreSQL.',
    })
  );

  const exportBtn = createEl('button', {
    type: 'button',
    className: 'btn btn--primary',
    textContent: 'Export Data Backup',
  });
  exportBtn.addEventListener('click', async () => {
    setButtonLoading(exportBtn, true, 'جارٍ التصدير...');
    try {
      await exportDataBackup();
      ctx.showToast('تم تنزيل النسخة الاحتياطية', 'success');
    } catch (err) {
      ctx.handleError(err);
    } finally {
      setButtonLoading(exportBtn, false);
    }
  });
  backupCard.appendChild(exportBtn);

  if (ctx.isAdmin) {
    const importInput = createEl('input', {
      className: 'input',
      type: 'file',
      accept: 'application/json,.json',
    });
    const importBtn = createEl('button', {
      type: 'button',
      className: 'btn btn--accent',
      textContent: 'Import Data Backup',
    });
    importBtn.addEventListener('click', async () => {
      const file = importInput.files?.[0];
      if (!file) {
        ctx.showToast('اختر ملف JSON أولاً', 'error');
        return;
      }
      const ok = await confirmDialog({
        title: 'تأكيد الاستعادة',
        message:
          'سيتم إدراج سجلات جديدة من الملف (بدون الكتابة فوق المعرفات الحالية، وبدون profiles أو audit_logs أو ملفات Storage). هل تريد المتابعة؟',
        confirmText: 'تنفيذ الاستيراد',
        danger: true,
      });
      if (!ok) return;
      setButtonLoading(importBtn, true, 'جارٍ الاستيراد...');
      try {
        const report = await importDataBackup(file, ctx.user.id);
        ctx.showToast(
          `تم الاستيراد: ${report.inserted} سجل عبر (${report.tables.join('، ') || 'لا جداول'})`,
          'success'
        );
      } catch (err) {
        ctx.handleError(err);
      } finally {
        setButtonLoading(importBtn, false);
      }
    });
    backupCard.append(
      createEl('div', { style: 'margin-top:1rem' }, [
        field('ملف النسخة الاحتياطية', importInput),
        importBtn,
      ])
    );
  }

  grid.appendChild(backupCard);
});
