/**
 * auth.js — وضع الإدارة بالرقم السري
 * المحتوى متاح للجميع دون دخول. أدوات الإضافة والتعديل والحذف والنشر والاعتماد تظهر في وضع الإدارة فقط،
 * والحماية الفعلية في الخادم: RLS وسياسات التخزين تشترط جلسة إدارة فُتحت بالرقم السري (migrations/005).
 * الرقم السري لا يُخزَّن في المتصفح؛ يُرسل مرة واحدة في جسم طلب POST إلى Edge Function admin-pin.
 * يُحفظ في localStorage «رمز جهاز» عشوائي بعد أول دخول ناجح فقط (لا يفتح وضع الإدارة دون الرقم).
 */
import { isConfigReady, SUPABASE_URL, SUPABASE_ANON_KEY, ADMIN_PIN_FUNCTION } from './config.js';
import { getSupabase } from './supabase-client.js';
import { logDev } from './utils.js';

let adminPromise = null;
let authListenerBound = false;
let leaving = false;

export function showConfigWarning() {
  document.body.replaceChildren();
  const wrap = document.createElement('div');
  wrap.className = 'config-warning';
  const box = document.createElement('div');
  box.className = 'config-warning__box';
  const h = document.createElement('h1');
  h.textContent = 'لم تُضبط إعدادات Supabase بعد';
  const p1 = document.createElement('p');
  p1.textContent =
    'افتح الملف js/config.js وضع فيه SUPABASE_URL و SUPABASE_ANON_KEY من لوحة Supabase → Project Settings → API.';
  const p2 = document.createElement('p');
  p2.textContent = 'راجع README.md لخطوات الإعداد الكاملة. لا تضع service_role في الواجهة.';
  box.append(h, p1, p2);
  wrap.appendChild(box);
  document.body.appendChild(wrap);
}

export function clearAuthCache() {
  adminPromise = null;
}

export function canEdit(profile) {
  return Boolean(
    profile &&
      profile.is_active &&
      (profile.role === 'admin' || profile.role === 'activity_leader')
  );
}

export function isAdmin(profile) {
  return Boolean(profile && profile.is_active && profile.role === 'admin');
}

async function readAdminContext() {
  if (!isConfigReady()) return null;
  // جلسات النسخة السابقة (localStorage) لا تمنح وضع الإدارة؛ تُزال
  try {
    localStorage.removeItem('sap-auth');
  } catch {
    /* ignore */
  }
  const sb = getSupabase();
  const { data } = await sb.auth.getSession();
  const session = data?.session;
  if (!session) return null;
  try {
    const { data: ok, error } = await sb.rpc('is_feature_manager');
    if (error) throw error;
    if (ok !== true) {
      // جلسة انتهت أو أُلغيت في الخادم: خروج محلي بصمت
      await sb.auth.signOut({ scope: 'local' }).catch(() => {});
      return { expired: true };
    }
    const { data: userData } = await sb.auth.getUser();
    const user = userData?.user;
    if (!user) return null;
    const { data: profile, error: pErr } = await sb
      .from('profiles')
      .select('id, full_name, role, is_active, username')
      .eq('id', user.id)
      .maybeSingle();
    if (pErr) throw pErr;
    if (!profile?.is_active) return null;
    bindAuthStateChange();
    return { session, user, profile };
  } catch (err) {
    logDev('admin context', err);
    return null;
  }
}

/**
 * سياق وضع الإدارة إن كان مفعّلاً وصالحاً في الخادم، وإلا null (زائر).
 * @returns {Promise<{ session, user, profile }|{ expired: true }|null>}
 */
export function getAdminContext() {
  if (!adminPromise) adminPromise = readAdminContext();
  return adminPromise;
}

/** هل وضع الإدارة صالح الآن؟ (يقرره الخادم من هوية الجلسة) */
export async function isFeatureManager() {
  const ctx = await getAdminContext();
  return Boolean(ctx && !ctx.expired);
}

function bindAuthStateChange() {
  if (authListenerBound) return;
  authListenerBound = true;
  getSupabase().auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT' || leaving) return;
    clearAuthCache();
    window.location.reload();
  });
}

/** رمز الجهاز الموثوق (ليس الرقم السري ولا يمنح شيئاً وحده): يُخرج هذا الجهاز من الحد العام للأجهزة الجديدة */
const DEVICE_KEY = 'sap-admin-device';

function readDeviceToken() {
  try {
    const t = localStorage.getItem(DEVICE_KEY);
    return t && /^[A-Za-z0-9_-]{43}$/.test(t) ? t : null;
  } catch {
    return null;
  }
}

async function callAdminPin(payload) {
  const deviceToken = readDeviceToken();
  if (deviceToken) payload = { ...payload, device_token: deviceToken };
  let response;
  try {
    response = await fetch(`${SUPABASE_URL}/functions/v1/${ADMIN_PIN_FUNCTION}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    logDev(err);
    throw Object.assign(new Error('تعذّر الاتصال بالخادم'), { code: 'network' });
  }
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok || !body?.ok) {
    throw Object.assign(new Error(body?.message || 'تعذّر فتح وضع الإدارة'), {
      code: body?.error || 'server_error',
      status: response.status,
    });
  }
  if (!body.access_token || !body.refresh_token) {
    throw Object.assign(new Error('تعذّر فتح وضع الإدارة'), { code: 'incomplete_session' });
  }
  if (typeof body.device_token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(body.device_token)) {
    try {
      localStorage.setItem(DEVICE_KEY, body.device_token);
    } catch {
      /* ignore */
    }
  }
  const { error } = await getSupabase().auth.setSession({
    access_token: body.access_token,
    refresh_token: body.refresh_token,
  });
  if (error) throw error;
  clearAuthCache();
  return body;
}

/** فتح وضع الإدارة بالرقم السري (يتحقق منه الخادم) */
export function enterAdminMode(pin) {
  return callAdminPin({ action: 'login', pin: String(pin || '').trim() });
}

/** تغيير الرقم السري: يتطلب الرقم الحالي، ويُنهي جلسات الإدارة الأخرى، ويفتح جلسة جديدة لهذا الجهاز */
export function changeAdminPin(currentPin, newPin) {
  return callAdminPin({
    action: 'change',
    pin: String(currentPin || '').trim(),
    new_pin: String(newPin || '').trim(),
  });
}

/** الخروج من وضع الإدارة: تُحذف الجلسة من الخادم فوراً فتفقد أي صلاحية كتابة */
export async function exitAdminMode() {
  leaving = true;
  clearAuthCache();
  try {
    const { clearPdfThumbCache } = await import('./pdf-thumbs.js');
    await clearPdfThumbCache();
  } catch (err) {
    logDev('clear thumbs', err);
  }
  try {
    await getSupabase().auth.signOut({ scope: 'local' });
  } catch (err) {
    logDev('sign out', err);
  }
  window.location.reload();
}

export function adminPinErrorMessage(err) {
  const code = String(err?.code || '');
  if (code === 'invalid_pin') return 'الرقم السري غير صحيح';
  if (code === 'locked' || code === 'locked_new_devices') {
    return err.message || 'محاولات خاطئة كثيرة. انتظري 15 دقيقة ثم حاولي مرة أخرى.';
  }
  if (code === 'not_configured') return 'لم يُضبط الرقم السري لإدارة المنصة بعد';
  if (code === 'weak_pin') return err.message || 'الرقم السري الجديد غير مقبول';
  if (code === 'network') return 'تعذّر الاتصال بالخادم';
  return 'تعذّر فتح وضع الإدارة، حاول لاحقاً';
}
