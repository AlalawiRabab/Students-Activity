/**
 * app.js — تهيئة الصفحات
 * كل الصفحات تعمل للزائر دون دخول وبالقائمة الرئيسية نفسها. ctx.canEdit = true في وضع الإدارة فقط
 * (جلسة فُتحت بالرقم السري ويؤكدها الخادم)، والصلاحية الفعلية تفرضها RLS وسياسات التخزين.
 */
import { isConfigReady } from './config.js';
import { getAdminContext, canEdit, isAdmin, showConfigWarning } from './auth.js';
import { fetchSettings, fetchPublicSettings } from './supabase-service.js';
import { mountShell, handleError, showToast, renderAdminLock } from './ui.js';
import { logDev } from './utils.js';

const DEFAULT_SETTINGS = Object.freeze({
  platform_name: 'منصة النشاط الطلابي',
  leader_name: 'إيمان الرحيلي',
});

/**
 * @param {{ title: string, showPrint?: boolean, adminOnly?: boolean }} options
 *   adminOnly: صفحة إدارية بحتة (المراجعة، الإعدادات) — الزائر يرى طلب وضع الإدارة دون أي بيانات
 * @param {(ctx) => Promise<void>|void} pageInit
 */
export async function bootPage(options, pageInit) {
  if (!isConfigReady()) {
    showConfigWarning();
    return null;
  }
  try {
    const raw = await getAdminContext();
    const auth = raw && !raw.expired ? raw : null;

    let settings;
    try {
      settings = auth ? await fetchSettings() : await fetchPublicSettings();
    } catch (err) {
      logDev(err);
      settings = { ...DEFAULT_SETTINGS };
    }
    document.title = `${options.title} | ${settings.platform_name || DEFAULT_SETTINGS.platform_name}`;

    const shell = mountShell({
      title: options.title,
      profile: auth?.profile || null,
      settings,
      showPrint: options.showPrint !== false,
      adminMode: Boolean(auth),
    });
    if (raw?.expired) showToast('انتهت جلسة الإدارة، أعد إدخال الرقم السري عند الحاجة', 'info');

    const ctx = {
      ...shell,
      canEdit: Boolean(auth && canEdit(auth.profile)),
      isAdmin: Boolean(auth && isAdmin(auth.profile)),
      adminMode: Boolean(auth),
      isPublic: !auth,
      user: auth?.user || null,
      session: auth?.session || null,
      profile: auth?.profile || null,
      settings,
      handleError,
      showToast,
    };

    if (options.adminOnly && !auth) {
      renderAdminLock(ctx.content);
      return ctx;
    }
    if (typeof pageInit === 'function') await pageInit(ctx);
    return ctx;
  } catch (err) {
    handleError(err);
    return null;
  }
}

/** صفحات المحتوى (الأقسام، المعرض...): مشاهدة عامة، وأدوات الإدارة في وضع الإدارة فقط */
export const bootProtectedPage = bootPage;
export const bootPublicPage = bootPage;

/** صفحات إدارية بحتة */
export function bootAdminPage(options, pageInit) {
  return bootPage({ ...options, adminOnly: true }, pageInit);
}
