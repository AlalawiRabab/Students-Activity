# Edge Function: admin-pin

## الغرض
فتح «وضع الإدارة» بالرقم السري الخاص برائدة النشاط. المحتوى متاح للجميع، أما الإضافة والتعديل والحذف وإدارة الملفات والنشر والاعتماد فتشترط في RLS وسياسات Storage جلسة فُتحت عبر هذه الدالة (`admin_session_valid()` في `migrations/005`).

## ما تفرضه الدالة
- Origin مسموح فقط: `https://activity.albian127.net`، GitHub Pages، و`localhost:5500` / `127.0.0.1:5500` (ونطاقات إضافية عبر `EXTRA_ALLOWED_ORIGINS`).
- `POST` بجسم JSON صغير (≤ 1 ك.ب). الرقم في جسم الطلب فقط، لا في الرابط.
- التحقق مقابل بصمة PBKDF2-SHA256 في `public.admin_pin` بمقارنة ثابتة الزمن؛ الرقم لا يُخزَّن ولا يُسجَّل.
- حد المحاولات (`admin_pin_begin`) دون قفل عام: الجهاز الموثوق (`device_token` أصدرته الدالة بعد دخول ناجح؛ تُخزَّن بصمته فقط) له حده الخاص 5 / 15 دقيقة ولا يتأثر بغيره. الجهاز الجديد: 5 / 15 دقيقة لكل بصمة IP، وسقف للأجهزة الجديدة فقط 30 / ساعة و100 / يوم. تُسجَّل المحاولة قبل الفحص فلا تتجاوزها الطلبات المتزامنة، مع تأخير بسيط بعد الخطأ. فك القفل: `node tools/set-admin-pin.mjs --unlock`.
- عند النجاح: جلسة Supabase Auth لحساب رائدة النشاط المعتمد (`feature_managers`) تُسجَّل في `admin_sessions` لمدة `ADMIN_SESSION_HOURS` (افتراضي 8، بين 1 و24).
- `change`: يتطلب الرقم الحالي، ويرفض الرقم الضعيف (أقل من 6 أرقام، مكرر، متسلسل)، ويُنهي كل جلسات الإدارة القائمة ثم يصدر جلسة جديدة للجهاز الحالي.

## الطلب والاستجابة
```
POST {SUPABASE_URL}/functions/v1/admin-pin
{ "action": "login", "pin": "<الرقم>" }
{ "action": "change", "pin": "<الحالي>", "new_pin": "<الجديد>" }
```
النجاح: `{ ok: true, access_token, refresh_token, expires_in, expires_at, admin_until }`.
الأخطاء: `invalid_pin` (401)، `locked` (429، هذا الجهاز/العنوان)، `locked_new_devices` (429، الأجهزة الجديدة فقط)، `not_configured` (503)، `weak_pin` (400).

## الأسرار (اختيارية)
- `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY`: تلقائية.
- `ADMIN_PIN_SALT`: ملح بصمات IP (وإلا يُستخدم `PARENT_SUBMIT_SALT`).
- `ADMIN_SESSION_HOURS`: مدة جلسة الإدارة.

## النشر (بعد موافقتك وبعد تشغيل migrations/005)
```bash
npx supabase functions deploy admin-pin --no-verify-jwt --use-api --remote=rcxcmxaplyzxhhgrmhqj
node tools/set-admin-pin.mjs
```
`--no-verify-jwt` لازم لأن الزائر لا يملك جلسة؛ الدالة لا تمنح شيئاً دون الرقم الصحيح.

## الاختبارات
```bash
deno test supabase/functions/admin-pin/
```
