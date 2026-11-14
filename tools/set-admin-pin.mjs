#!/usr/bin/env node
/**
 * set-admin-pin.mjs — ضبط الرقم السري لإدارة المنصة (أول مرة أو عند نسيانه)
 *
 * التشغيل (من مجلد المشروع، في نافذة طرفية على جهازك):
 *   node tools/set-admin-pin.mjs
 *
 * - يطلب الرقم مرتين بإدخال مخفي؛ لا يُمرَّر في سطر الأوامر ولا يُحفظ في أي ملف.
 * - يحسب بصمة PBKDF2 على جهازك ويرسل البصمة فقط إلى قاعدة البيانات عبر Supabase CLI
 *   (npx supabase db query --remote)، ثم يُنهي كل جلسات الإدارة القائمة.
 * - يتطلب: تنفيذ migrations/005 أولاً، وتسجيل الدخول في Supabase CLI (npx supabase login).
 * - التغيير اللاحق متاح أيضاً من «الإعدادات» داخل وضع الإدارة.
 *
 * فك قفل الدخول من الأجهزة الجديدة (إن استنفد أحدٌ المحاولات) دون تغيير الرقم:
 *   node tools/set-admin-pin.mjs --unlock
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const PBKDF2_ITERATIONS = 210_000;

/** مطابق لـ validateNewPin في supabase/functions/admin-pin/pin.ts */
export function validateNewPin(pin) {
  if (typeof pin !== 'string' || !/^[0-9]{6,12}$/.test(pin)) return 'الرقم السري يجب أن يكون من 6 إلى 12 رقماً';
  if (/^(\d)\1+$/.test(pin)) return 'اختر رقماً سرياً غير مكوّن من رقم واحد مكرر';
  const d = [...pin].map(Number);
  const step = d[1] - d[0];
  if (Math.abs(step) === 1 && d.every((x, i) => i === 0 || x - d[i - 1] === step)) return 'اختر رقماً سرياً غير متسلسل';
  return null;
}

/** الصيغة: pbkdf2-sha256$<iterations>$<salt base64>$<hash base64> (تتحقق منها admin-pin) */
export function hashPin(pin, iterations = PBKDF2_ITERATIONS) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.pbkdf2Sync(pin, salt, iterations, 32, 'sha256');
  return `pbkdf2-sha256$${iterations}$${salt.toString('base64')}$${dk.toString('base64')}`;
}

function askHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    let muted = false;
    rl._writeToOutput = (s) => {
      if (!muted) rl.output.write(s);
    };
    rl.question(question, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer.trim());
    });
    muted = true;
  });
}

function projectRefFromConfig() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const src = fs.readFileSync(path.join(here, '..', 'js', 'config.js'), 'utf8');
  const m = /SUPABASE_URL = 'https:\/\/([a-z0-9]+)\.supabase\.co'/.exec(src);
  return m ? m[1] : null;
}

function runSql(ref, sql) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sap-pin-'));
  const file = path.join(dir, 'admin-pin.sql');
  try {
    fs.writeFileSync(file, sql, { mode: 0o600 });
    const res = spawnSync('npx', ['supabase', 'db', 'query', `--remote=${ref}`, '-f', file], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    return res.status === 0;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const REQUIRE_005 = [
  'do $$ begin',
  "  if to_regclass('public.admin_pin') is null or not exists (select 1 from public.admin_pin where id = 1) then",
  "    raise exception 'نفّذ migrations/005_public_view_admin_pin.sql أولاً';",
  '  end if;',
  'end $$;',
];

async function main() {
  const refArg = process.argv.find((a) => a.startsWith('--project-ref='));
  const ref = refArg ? refArg.split('=')[1] : projectRefFromConfig();
  if (!ref || !/^[a-z0-9]{20}$/.test(ref)) {
    console.error('تعذّر تحديد معرّف مشروع Supabase. مرّره هكذا: --project-ref=<ref>');
    process.exit(1);
  }

  if (process.argv.includes('--unlock')) {
    console.log(`فك قفل الدخول من الأجهزة الجديدة — مشروع Supabase: ${ref}`);
    const ok = runSql(ref, [
      ...REQUIRE_005,
      'delete from public.admin_pin_attempts where not ok;',
      'select count(*) as failed_attempts_left from public.admin_pin_attempts where not ok;',
    ].join('\n'));
    if (!ok) process.exitCode = 1;
    else console.log('تم. يمكن الدخول الآن من زر «إدارة المنصة».');
    return;
  }

  if (!process.stdin.isTTY) {
    console.error('شغّل هذا الأمر في نافذة طرفية تفاعلية (لا تمرّر الرقم السري عبر أنبوب أو ملف).');
    process.exit(1);
  }

  console.log(`ضبط الرقم السري لإدارة المنصة — مشروع Supabase: ${ref}`);
  console.log('الرقم من 6 إلى 12 رقماً، ولن يظهر أثناء الكتابة.');
  const pin = await askHidden('الرقم السري الجديد: ');
  const err = validateNewPin(pin);
  if (err) {
    console.error(err);
    process.exit(1);
  }
  const again = await askHidden('أعد كتابة الرقم السري: ');
  if (again !== pin) {
    console.error('الرقمان غير متطابقين، لم يُغيَّر شيء.');
    process.exit(1);
  }

  const encoded = hashPin(pin);
  const ok = runSql(ref, [
    ...REQUIRE_005,
    `update public.admin_pin set pin_hash = '${encoded}', updated_at = now() where id = 1;`,
    'update public.admin_sessions set revoked_at = now() where revoked_at is null;',
    'update public.admin_trusted_devices set revoked_at = now() where revoked_at is null;',
    'delete from public.admin_pin_attempts where not ok;',
    'select (pin_hash is not null) as pin_configured, updated_at from public.admin_pin where id = 1;',
  ].join('\n'));
  if (!ok) {
    console.error('لم يكتمل الضبط. تحقق من تسجيل الدخول في Supabase CLI (npx supabase login) ومن تنفيذ 005.');
    process.exitCode = 1;
    return;
  }
  console.log('تم ضبط الرقم السري. استخدمه من زر «إدارة المنصة». لا ترسله في رسالة أو تحفظه في ملف.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
