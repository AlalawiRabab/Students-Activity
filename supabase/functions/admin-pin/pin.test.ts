import { assert, assertEquals, assertFalse } from 'jsr:@std/assert@1';
import { hashPin, sessionIdFromJwt, validateNewPin, verifyPin, clientIp, hashIp } from './pin.ts';

// بصمة ولّدتها tools/set-admin-pin.mjs (Node) للرقم 482916 — تتحقق من توافق الصيغتين
const NODE_VECTOR = 'pbkdf2-sha256$210000$AAECAwQFBgcICQoLDA0ODw==$imbOnkT4b5Ewh9y6SlU8I8bItcJDZ/dXLFi5bVv3n2s=';

Deno.test('hash + verify round trip', async () => {
  const enc = await hashPin('482916', 100_000);
  assert(enc.startsWith('pbkdf2-sha256$100000$'));
  assert(await verifyPin('482916', enc));
  assertFalse(await verifyPin('482917', enc));
});

Deno.test('verifies a hash produced by the Node setup script', async () => {
  assert(await verifyPin('482916', NODE_VECTOR));
  assertFalse(await verifyPin('000000', NODE_VECTOR));
});

Deno.test('rejects malformed or weak stored hashes', async () => {
  assertFalse(await verifyPin('482916', null));
  assertFalse(await verifyPin('482916', 'plain$482916'));
  assertFalse(await verifyPin('482916', 'pbkdf2-sha256$10$AAAA$BBBB'));
  assertFalse(await verifyPin('482916', 'pbkdf2-sha256$210000$***$***'));
});

Deno.test('new PIN rules', () => {
  assertEquals(validateNewPin('48291'), 'الرقم السري يجب أن يكون من 6 إلى 12 رقماً');
  assertEquals(validateNewPin('1234567890123'), 'الرقم السري يجب أن يكون من 6 إلى 12 رقماً');
  assertEquals(validateNewPin('48a916'), 'الرقم السري يجب أن يكون من 6 إلى 12 رقماً');
  assertEquals(validateNewPin(482916), 'الرقم السري يجب أن يكون من 6 إلى 12 رقماً');
  assertEquals(validateNewPin('777777'), 'اختر رقماً سرياً غير مكوّن من رقم واحد مكرر');
  assertEquals(validateNewPin('123456'), 'اختر رقماً سرياً غير متسلسل');
  assertEquals(validateNewPin('987654'), 'اختر رقماً سرياً غير متسلسل');
  assertEquals(validateNewPin('482916'), null);
});

Deno.test('session id from JWT payload', () => {
  const payload = btoa(JSON.stringify({ sub: 'x', session_id: '0b8a0d4e-4f7e-4c5c-9d68-8a8f2b3c4d5e' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assertEquals(sessionIdFromJwt(`h.${payload}.s`), '0b8a0d4e-4f7e-4c5c-9d68-8a8f2b3c4d5e');
  assertEquals(sessionIdFromJwt('h.e30.s'), null);
  assertEquals(sessionIdFromJwt('garbage'), null);
});

Deno.test('client ip + hash', async () => {
  assertEquals(clientIp(new Headers({ 'x-forwarded-for': '1.2.3.4, 10.0.0.1' })), '1.2.3.4');
  assertEquals(clientIp(new Headers({ 'cf-connecting-ip': '5.6.7.8', 'x-forwarded-for': '1.2.3.4' })), '5.6.7.8');
  const h = await hashIp('1.2.3.4', 'salt');
  assert(/^[0-9a-f]{64}$/.test(h));
});
