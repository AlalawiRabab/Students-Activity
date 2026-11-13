# Edge Function: parent-submit

## الغرض
استقبال مشاركة ولي الأمر في «بعيون أهالينا» **دون حساب**. الزائر لا يملك أي صلاحية كتابة في قاعدة البيانات أو التخزين؛ هذه الدالة وحدها تكتب بمفتاح `service_role` (سرّ خادم).

## ما تفرضه الدالة
- Origin مسموح فقط: `https://activity.albian127.net`، GitHub Pages، و`localhost:5500` / `127.0.0.1:5500` (ونطاقات إضافية عبر `EXTRA_ALLOWED_ORIGINS`).
- حد لحجم الطلب (5 صور × 5 م.ب)، ويُقطع الاتصال عند تجاوزه.
- نوع الصورة من **بايتاتها الفعلية** (JPG / PNG / WEBP) لا من الاسم أو ترويسة المتصفح.
- صورة أو تعليق على الأقل، الإقرار إلزامي، الاسم ≤ 80 والتعليق ≤ 2000 حرف، وإزالة محارف التحكم وتجاوز الاتجاه.
- حقل خفي (honeypot) وزمن تعبئة أدنى ضد الإرسال الآلي.
- حد للإرسال المتكرر عبر `parent_submit_throttle`: يعتمد تجزئة عنوان IP (مع ملح) **و** معرّف الجهاز، وحدوداً إجمالية للطابور والتكرار — لا يكفي للزائر تغيير معرّف الجهاز وحده لتجاوز القيد. يُخزَّن **تجزئة** عنوان IP مع ملح، لا العنوان نفسه.
- الدالة عامة (`--no-verify-jwt`) لكنها تسمح فقط بإنشاء مشاركة `pending` عبر `create_parent_post`؛ لا تعتمد ولا تحذف ولا تصل إلى بيانات خاصة للزائر.
- المناسبة يجب أن تكون مفتوحة؛ والمشاركة تُنشأ دائماً بحالة `pending` (يفرضها محفز قاعدة البيانات أيضاً).
- عند فشل الحفظ تُحذف الصور المرفوعة.

## الأسرار (Supabase → Edge Functions → Secrets)
- `SUPABASE_URL` و`SUPABASE_SERVICE_ROLE_KEY`: متوفرة تلقائياً.
- `PARENT_SUBMIT_SALT`: **يُنصح به** — نص عشوائي طويل (مثلاً ناتج `openssl rand -hex 32`).
- `EXTRA_ALLOWED_ORIGINS` (اختياري): نطاقات إضافية مفصولة بفواصل، مثل نطاق مخصص للمنصة.

## النشر (بعد موافقتك فقط، وبعد تشغيل migrations/004)
```bash
supabase functions deploy parent-submit --no-verify-jwt
supabase secrets set PARENT_SUBMIT_SALT=<قيمة-عشوائية-طويلة>
```
`--no-verify-jwt` لازم لأن الزائر يستدعيها بالمفتاح العام (Publishable) دون جلسة؛ الحماية داخل الدالة وفي RLS.

## الاختبارات
```bash
deno test supabase/functions/parent-submit/
```

## الاستدعاء من الواجهة
`POST {SUPABASE_URL}/functions/v1/parent-submit` بجسم `multipart/form-data`:
`event_id`, `author_name`, `comment`, `consent=yes`, `website` (فارغ), `elapsed_ms`, و`images` (حتى 5).
الاستجابة: `{ ok: true }` أو `{ error, message }`.
