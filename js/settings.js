/**
 * settings.js
 */
import { bootAdminPage } from './app.js';
import { updateSettings } from './supabase-service.js';
import { changeAdminPin, exitAdminMode, adminPinErrorMessage } from './auth.js';
import { exportDataBackup, importDataBackup } from './export.js';
import { createEl } from './utils.js';
import {
  field,
  setButtonLoading,
  confirmDialog,
  buildToolbar,
} from './ui.js';
import { validateRequired, validateLength } from './validators.js';

bootAdminPage({ title: 'الإعدادات', showPrint: false }, async (ctx) => {
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

  // الرقم السري لوضع الإدارة (يتحقق منه الخادم ويخزّن بصمته فقط)
  const accountCard = createEl('section', { className: 'card settings-card' });
  accountCard.appendChild(createEl('h3', { textContent: 'الرقم السري لإدارة المنصة' }));
  const pinForm = createEl('form', { className: 'form-grid', novalidate: true });
  const pinInput = (label) =>
    createEl('input', {
      className: 'input',
      type: 'password',
      inputmode: 'numeric',
      autocomplete: 'off',
      maxlength: '12',
      dir: 'ltr',
      'aria-label': label,
    });
  const currentPin = pinInput('الرقم السري الحالي');
  const newPin = pinInput('الرقم السري الجديد');
  const newPin2 = pinInput('تأكيد الرقم السري الجديد');
  pinForm.append(
    field('الرقم السري الحالي', currentPin),
    field('الرقم السري الجديد', newPin, 'من 6 إلى 12 رقماً، ليس رقماً مكرراً ولا تسلسلاً مثل 123456'),
    field('تأكيد الرقم السري الجديد', newPin2)
  );
  const pinBtn = createEl('button', {
    type: 'submit',
    className: 'btn btn--primary',
    textContent: 'تغيير الرقم السري',
  });
  pinForm.appendChild(pinBtn);
  pinForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!/^[0-9]{6,12}$/.test(newPin.value.trim())) {
      ctx.showToast('الرقم السري الجديد من 6 إلى 12 رقماً', 'error');
      return;
    }
    if (newPin.value.trim() !== newPin2.value.trim()) {
      ctx.showToast('الرقمان الجديدان غير متطابقين', 'error');
      return;
    }
    setButtonLoading(pinBtn, true);
    try {
      await changeAdminPin(currentPin.value, newPin.value);
      ctx.showToast('تم تغيير الرقم السري، وأُنهيت جلسات الإدارة على الأجهزة الأخرى', 'success');
    } catch (error) {
      ctx.showToast(adminPinErrorMessage(error), 'error');
    } finally {
      currentPin.value = '';
      newPin.value = '';
      newPin2.value = '';
      setButtonLoading(pinBtn, false);
    }
  });

  const exitBtn = createEl('button', {
    type: 'button',
    className: 'btn btn--ghost',
    textContent: 'الخروج من وضع الإدارة',
  });
  exitBtn.addEventListener('click', async () => {
    const ok = await confirmDialog({
      title: 'الخروج من وضع الإدارة',
      message: 'ستُخفى أدوات الإدارة وتنتهي صلاحيتها على هذا الجهاز فوراً.',
      confirmText: 'خروج',
      danger: true,
    });
    if (ok) await exitAdminMode();
  });

  accountCard.append(pinForm, createEl('div', { style: 'margin-top:1rem' }, [exitBtn]));
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
