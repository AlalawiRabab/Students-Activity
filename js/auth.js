/**
 * auth.js — المصادقة وحماية الصفحات
 */
import { isConfigReady, SUPABASE_URL, SUPABASE_ANON_KEY, USERNAME_LOGIN_FUNCTION } from './config.js';
import { getSupabase } from './supabase-client.js';
import { logDev } from './utils.js';
import { validatePassword } from './validators.js';

let cachedProfile = null;
let authListenerBound = false;
let loggingOut = false;

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

export async function getSession() {
  const sb = getSupabase();
  const { data, error } = await sb.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getUser() {
  const sb = getSupabase();
  const { data, error } = await sb.auth.getUser();
  if (error) throw error;
  return data.user;
}

export async function fetchProfile(force = false) {
  if (cachedProfile && !force) return cachedProfile;
  const sb = getSupabase();
  const user = await getUser();
  if (!user) return null;
  const { data, error } = await sb
    .from('profiles')
    .select('id, full_name, role, is_active, username')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  cachedProfile = data;
  return data;
}

export function clearAuthCache() {
  cachedProfile = null;
  featureManagerPromise = null;
}

export function canEdit(profile) {
  return Boolean(
    profile &&
      profile.is_active &&
      (profile.role === 'admin' || profile.role === 'activity_leader')
  );
}

let featureManagerPromise = null;

/**
 * هل الحساب الحالي هو حساب رائدة النشاط المعتمد لإدارة «بعيون أهالينا» والمسابقات؟
 * يقرّره الخادم من هوية الجلسة (auth.uid) — هذا لعرض أدوات الإدارة فقط؛ الحماية الفعلية في RLS.
 */
export function isFeatureManager() {
  if (!featureManagerPromise) {
    featureManagerPromise = (async () => {
      try {
        const { data, error } = await getSupabase().rpc('is_feature_manager');
        if (error) throw error;
        return data === true;
      } catch (err) {
        logDev('is_feature_manager', err);
        return false;
      }
    })();
  }
  return featureManagerPromise;
}

export function isAdmin(profile) {
  return Boolean(profile && profile.is_active && profile.role === 'admin');
}

export async function requireAuth() {
  if (!isConfigReady()) {
    showConfigWarning();
    return null;
  }

  try {
    const session = await getSession();
    if (!session) {
      window.location.replace('./login.html');
      return null;
    }

    const user = await getUser();
    if (!user) {
      window.location.replace('./login.html');
      return null;
    }

    const profile = await fetchProfile(true);
    if (!profile || !profile.is_active) {
      await getSupabase().auth.signOut();
      clearAuthCache();
      window.location.replace('./login.html');
      return null;
    }

    bindAuthStateChange();
    return { session, user, profile };
  } catch (err) {
    logDev(err);
    window.location.replace('./login.html');
    return null;
  }
}

/**
 * جلسة اختيارية للصفحات العامة: لا تحويل إلى تسجيل الدخول.
 * @returns {Promise<{ session, user, profile }|null>} null للزائر أو لحساب غير نشط
 */
export async function getOptionalAuth() {
  if (!isConfigReady()) return null;
  try {
    const session = await getSession();
    if (!session) return null;
    const user = await getUser();
    if (!user) return null;
    const profile = await fetchProfile(true);
    if (!profile || !profile.is_active) return null;
    bindAuthStateChange({ redirect: false });
    return { session, user, profile };
  } catch (err) {
    logDev(err);
    return null;
  }
}

export function bindAuthStateChange({ redirect = true } = {}) {
  if (authListenerBound) return;
  authListenerBound = true;
  const sb = getSupabase();
  sb.auth.onAuthStateChange((event) => {
    if (event !== 'SIGNED_OUT' || loggingOut) return;
    clearAuthCache();
    if (redirect) window.location.replace('./login.html');
    else window.location.reload();
  });
}

export async function login(email, password) {
  const sb = getSupabase();
  const { data, error } = await sb.auth.signInWithPassword({
    email: String(email).trim(),
    password,
  });
  if (error) throw error;
  clearAuthCache();
  return data;
}

/**
 * تسجيل الدخول باسم المستخدم عبر Edge Function
 * (لا يُرجع البريد للمتصفح ولا يقرأ profiles كـ anon)
 */
export async function loginWithUsername(username, password) {
  const sb = getSupabase();
  const endpoint = `${SUPABASE_URL}/functions/v1/${USERNAME_LOGIN_FUNCTION}`;

  let response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        username: String(username).trim(),
        password,
      }),
    });
  } catch (err) {
    logDev(err);
    throw new Error('تعذّر الاتصال بخدمة تسجيل الدخول');
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch (err) {
    logDev(err);
    throw new Error('استجابة غير صالحة من خدمة تسجيل الدخول');
  }

  if (!response.ok) {
    const msg = payload?.message || payload?.error || 'invalid_credentials';
    const error = new Error(String(msg));
    error.status = response.status;
    error.code = payload?.error || 'invalid_credentials';
    throw error;
  }

  if (!payload?.access_token || !payload?.refresh_token) {
    throw new Error('incomplete_session');
  }

  const { data, error } = await sb.auth.setSession({
    access_token: payload.access_token,
    refresh_token: payload.refresh_token,
  });
  if (error) throw error;

  clearAuthCache();
  return data;
}

export async function logout() {
  const sb = getSupabase();
  loggingOut = true;
  clearAuthCache();
  try {
    const { clearPdfThumbCache } = await import('./pdf-thumbs.js');
    await clearPdfThumbCache();
  } catch (err) {
    logDev('clear thumbs', err);
  }
  await sb.auth.signOut();
  window.location.replace('./index.html');
}

export async function changePassword(newPassword) {
  const errMsg = validatePassword(newPassword);
  if (errMsg) throw new Error(errMsg);
  const sb = getSupabase();
  const { error } = await sb.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

export function authErrorMessage(err) {
  const m = String(err?.message || err || '').toLowerCase();
  const code = String(err?.code || '').toLowerCase();
  if (
    code === 'invalid_credentials' ||
    m.includes('invalid_credentials') ||
    m.includes('invalid login') ||
    m.includes('invalid credentials') ||
    m.includes('اسم المستخدم أو كلمة المرور')
  ) {
    return 'اسم المستخدم أو كلمة المرور غير صحيحة';
  }
  if (m.includes('email not confirmed')) return 'لم يتم تأكيد البريد الإلكتروني بعد';
  if (m.includes('rate limit')) return 'محاولات كثيرة، حاول لاحقاً';
  if (m.includes('network') || m.includes('تعذّر الاتصال')) {
    return 'تعذّر الاتصال بالخادم';
  }
  if (m.includes('incomplete_session') || m.includes('server_misconfigured')) {
    return 'تعذّر إكمال تسجيل الدخول، حاول لاحقاً';
  }
  return 'تعذّر تسجيل الدخول، تحقق من البيانات والاتصال';
}

export async function redirectIfLoggedIn() {
  if (!isConfigReady()) {
    showConfigWarning();
    return;
  }
  try {
    const session = await getSession();
    if (session) window.location.replace('./dashboard.html');
  } catch (err) {
    logDev(err);
  }
}
