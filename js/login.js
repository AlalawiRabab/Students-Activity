/**
 * login.js — تسجيل الدخول باسم المستخدم + كلمة المرور
 */
import { isConfigReady } from './config.js';
import {
  redirectIfLoggedIn,
  loginWithUsername,
  authErrorMessage,
  showConfigWarning,
} from './auth.js';
import { initTheme, toggleTheme, setButtonLoading } from './ui.js';
import { validateUsername, validateRequired } from './validators.js';
import { fetchSettings } from './supabase-service.js';
import { logDev } from './utils.js';

initTheme();

const form = document.getElementById('login-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const togglePass = document.getElementById('toggle-pass');
const submitBtn = document.getElementById('login-btn');
const alertBox = document.getElementById('login-alert');
const themeBtn = document.getElementById('theme-btn');
const platformTitle = document.getElementById('platform-title');
const leaderLine = document.getElementById('leader-line');

themeBtn?.addEventListener('click', toggleTheme);

togglePass?.addEventListener('click', () => {
  const isPass = passwordInput.type === 'password';
  passwordInput.type = isPass ? 'text' : 'password';
  togglePass.textContent = isPass ? 'إخفاء' : 'إظهار';
  togglePass.setAttribute(
    'aria-label',
    isPass ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'
  );
});

function showAlert(msg) {
  alertBox.textContent = msg;
  alertBox.classList.add('is-visible');
}

function hideAlert() {
  alertBox.textContent = '';
  alertBox.classList.remove('is-visible');
}

async function boot() {
  if (!isConfigReady()) {
    showConfigWarning();
    return;
  }
  await redirectIfLoggedIn();
  try {
    const settings = await fetchSettings();
    if (platformTitle) platformTitle.textContent = settings.platform_name;
    if (leaderLine) {
      leaderLine.textContent = `رائدة النشاط / ${settings.leader_name}`;
    }
    document.title = `تسجيل الدخول | ${settings.platform_name}`;
  } catch (err) {
    logDev(err);
  }
}

form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const userErr = validateUsername(usernameInput.value);
  const passErr = validateRequired(passwordInput.value, 'كلمة المرور');
  if (userErr || passErr) {
    showAlert(userErr || passErr);
    return;
  }
  setButtonLoading(submitBtn, true, 'جارٍ تسجيل الدخول...');
  try {
    await loginWithUsername(usernameInput.value, passwordInput.value);
    window.location.replace('./dashboard.html');
  } catch (err) {
    logDev(err);
    showAlert(authErrorMessage(err));
  } finally {
    setButtonLoading(submitBtn, false);
  }
});

boot();
