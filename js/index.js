/**
 * index.js — توجيه حسب الجلسة
 */
import { isConfigReady } from './config.js';
import { getSession, showConfigWarning } from './auth.js';
import { logDev } from './utils.js';

async function main() {
  if (!isConfigReady()) {
    showConfigWarning();
    return;
  }
  try {
    const session = await getSession();
    window.location.replace(session ? './dashboard.html' : './login.html');
  } catch (err) {
    logDev(err);
    window.location.replace('./login.html');
  }
}

main();
