/**
 * auth.js — المصادقة وحماية الصفحات
 */
import { isConfigReady } from './config.js';
import { getSupabase } from './supabase-client.js';
import { logDev } from './utils.js';
import { validatePassword } from './validators.js';

let cachedProfile = null;
let authListenerBound = false;

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
    .select('id, full_name, role, is_active')
    .eq('id', user.id)
    .maybeSingle();
  if (error) throw error;
  cachedProfile = data;
  return data;
}

export function clearAuthCache() {
  cachedProfile = null;
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

export function bindAuthStateChange() {
  if (authListenerBound) return;
  authListenerBound = true;
  const sb = getSupabase();
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED') {
      if (event === 'SIGNED_OUT') {
        clearAuthCache();
        const path = location.pathname.split('/').pop() || '';
        if (path !== 'login.html' && path !== 'index.html') {
          window.location.replace('./login.html');
        }
      }
    }
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

export async function logout() {
  const sb = getSupabase();
  clearAuthCache();
  await sb.auth.signOut();
  window.location.replace('./login.html');
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
  if (m.includes('invalid login') || m.includes('invalid credentials')) {
    return 'البريد الإلكتروني أو كلمة المرور غير صحيحة';
  }
  if (m.includes('email not confirmed')) return 'لم يتم تأكيد البريد الإلكتروني بعد';
  if (m.includes('rate limit')) return 'محاولات كثيرة، حاول لاحقاً';
  if (m.includes('network')) return 'تعذّر الاتصال بالخادم';
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
