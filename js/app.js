/**
 * app.js — تهيئة الصفحات المحمية والعامة
 */
import { isConfigReady } from './config.js';
import { requireAuth, getOptionalAuth, canEdit, showConfigWarning } from './auth.js';
import { fetchSettings, fetchPublicSettings } from './supabase-service.js';
import { mountShell, handleError, showToast } from './ui.js';
import { mountPublicShell } from './public-shell.js';
import { logDev } from './utils.js';

/**
 * @param {{ title: string, showPrint?: boolean }} options
 * @param {(ctx) => Promise<void>|void} pageInit
 */
export async function bootProtectedPage(options, pageInit) {
  try {
    const auth = await requireAuth();
    if (!auth) return null;

    let settings;
    try {
      settings = await fetchSettings();
    } catch (err) {
      logDev(err);
      settings = {
        platform_name: 'منصة النشاط الطلابي',
        leader_name: 'إيمان الرحيلي',
      };
    }

    document.title = `${options.title} | ${settings.platform_name}`;

    const ctx = mountShell({
      title: options.title,
      profile: auth.profile,
      settings,
      showPrint: options.showPrint !== false,
    });

    ctx.user = auth.user;
    ctx.session = auth.session;
    ctx.handleError = handleError;
    ctx.showToast = showToast;

    if (typeof pageInit === 'function') {
      await pageInit(ctx);
    }
    return ctx;
  } catch (err) {
    handleError(err);
    return null;
  }
}

/**
 * صفحة عامة: تعمل للزائر دون جلسة. ctx.canEdit = true فقط لحساب رائدة النشاط النشط،
 * والصلاحية الفعلية تفرضها RLS في الخادم.
 * @param {{ title: string, adminShell?: boolean }} options
 *   adminShell: عند وجود جلسة نشطة تُعرض الصفحة داخل هيكل الإدارة (القائمة الجانبية)
 */
export async function bootPublicPage(options, pageInit) {
  if (!isConfigReady()) {
    showConfigWarning();
    return null;
  }
  try {
    const auth = await getOptionalAuth();
    const settings = await fetchPublicSettings();
    document.title = `${options.title} | ${settings.platform_name}`;

    let ctx;
    if (auth && options.adminShell) {
      ctx = mountShell({ title: options.title, profile: auth.profile, settings });
    } else {
      const shell = mountPublicShell({ settings, auth });
      ctx = {
        content: shell.content,
        canEdit: Boolean(auth && canEdit(auth.profile)),
        isAdmin: false,
        profile: auth?.profile || null,
        settings,
      };
    }
    ctx.isPublic = !(auth && options.adminShell);
    ctx.user = auth?.user || null;
    ctx.session = auth?.session || null;
    ctx.handleError = handleError;
    ctx.showToast = showToast;

    if (typeof pageInit === 'function') await pageInit(ctx);
    return ctx;
  } catch (err) {
    handleError(err);
    return null;
  }
}
