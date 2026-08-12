/**
 * app.js — تهيئة الصفحات المحمية
 */
import { requireAuth } from './auth.js';
import { fetchSettings } from './supabase-service.js';
import { mountShell, handleError, showToast } from './ui.js';
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
