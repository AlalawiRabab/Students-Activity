# منصة النشاط الطلابي
# Student Activity Platform

منصة إدارية عربية (RTL) لإدارة النشاط الطلابي، مبنية بـ **HTML5 + CSS3 + Vanilla JavaScript (ES Modules)** و**Supabase** (Auth + PostgreSQL + Storage).

بدون React / Vue / Angular / Next.js.

---

## متطلبات التشغيل

- متصفح حديث يدعم ES Modules
- مشروع Supabase
- خادم محلي ثابت (لا تعتمد على `file://` بسبب قيود الوحدات)
- حساب مستخدم في Supabase Authentication

---

## إنشاء مشروع Supabase

1. أنشئ مشروعاً جديداً من [Supabase](https://supabase.com).
2. من **Project Settings → API** انسخ:
   - **Project URL**
   - **anon / publishable key**
3. **لا تستخدم** `service_role` في الواجهة أبداً.

---

## تشغيل database.sql

1. افتح **SQL Editor** في Supabase.
2. الصق محتوى ملف [`database.sql`](./database.sql) بالكامل.
3. راجع الملف ثم نفّذ **Run**.
4. الملف ينشئ الجداول، الفهارس، المحفزات، دوال الصلاحيات، RLS، الـ bucket الخاص، وسياسات Storage.

> لم يُنفَّذ هذا الملف تلقائياً على مشروعك. راجعّه أولاً ثم شغّله يدوياً.

---

## إعداد Authentication

1. Authentication → Providers → فعّل Email.
2. أنشئ مستخدماً من Authentication → Users → Add user.
3. Authentication → URL Configuration:
   - **Site URL**: رابط موقعك (مثلاً `http://127.0.0.1:5500` محلياً أو رابط GitHub Pages).
   - **Redirect URLs**: أضف:
     - `http://127.0.0.1:5500/**`
     - `http://localhost:5500/**`
     - `https://YOUR_USERNAME.github.io/YOUR_REPO/**`

---

## إنشاء المستخدم الأول (Admin)

1. أنشئ المستخدم من Authentication (بدون تخزين كلمة مرور في جداول عامة).
2. انسخ **UUID** للمستخدم.
3. نفّذ في SQL Editor:

```sql
update public.profiles
set role = 'admin', is_active = true, full_name = 'مدير المنصة'
where id = 'YOUR-USER-UUID';
```

أو عبر البريد بعد التأكد من الهوية:

```sql
update public.profiles p
set role = 'admin', is_active = true
from auth.users u
where p.id = u.id and u.email = 'admin@example.com';
```

الأدوار المدعومة: `admin` | `activity_leader` | `viewer`

---

## إعداد Storage

الملف `database.sql` ينشئ bucket خاصاً باسم:

`student-activity-files`

- **Private** (ليس عاماً)
- العرض والتنزيل عبر **Signed URLs** قصيرة العمر
- مفتاح الكائن: `{uid}/{category}/{timestamp}-{uuid}.{ext}`
- الاسم العربي الأصلي يُحفظ في قاعدة البيانات فقط

---

## السجل الإلكتروني لرائدة النشاط (الأقسام الـ 12)

القائمة الرئيسية تعرض الأقسام بالترتيب التالي؛ لكل قسم صفحة مستقلة تستخدم الملف المشترك `js/section-page.js`، ونظام الملفات الموحّد `js/file-manager.js`:

| # | القسم | الصفحة | المفتاح | النوع |
|---|-------|--------|---------|-------|
| 1 | تكليف رائدة النشاط في نظام نور | `noor-assignment.html` | `noor_assignment` | مكتبة ملفات |
| 2 | سجل رائدة النشاط | `leader-record.html` | `leader_record` | مكتبة ملفات |
| 3 | خطة النشاط الفصلية للبرامج الصفية – الصفوف الأولية والعليا | `class-activity-plan.html` | `class_plan` (+ `primary`/`upper`) | مكتبة ملفات بتبويبين |
| 4 | خطة المدرسة للأنشطة اللاصفية – الصفوف الأولية والعليا | `extracurricular-plan.html` | `extra_plan` (+ `primary`/`upper`) | مكتبة ملفات بتبويبين |
| 5 | إعلانات البرامج | `announcements.html` | `announcements` | مكتبة ملفات |
| 6 | تقارير البرامج الصفية | `class-reports.html` | `class_reports` | مكتبة ملفات |
| 7 | تقارير البرامج اللاصفية | `extracurricular-reports.html` | `extra_reports` | مكتبة ملفات |
| 8 | تقارير تعزيز أولياء الأمور | `parent-reports.html` | `parent_reports` | مكتبة ملفات |
| 9 | الورش التدريبية للطالبات | `student-workshops.html` | `student_workshops` | مكتبة ملفات |
| 10 | استطلاع الطالبات والطلاب على برامج ومجالات النشاط | `student-surveys.html` | `student_surveys` | مكتبة ملفات |
| 11 | استطلاع ولي الأمر على مجالات النشاط | `parent-surveys.html` | `parent_surveys` | مكتبة ملفات |
| 12 | التكريمات | `honors-record.html` | `honors` | مكتبة ملفات + عرض التكريمات السابقة |

- الملفات المدعومة: PDF، Word (doc/docx)، Excel (xls/xlsx)، صور (jpg/png/webp/gif) — حتى 10 م.ب للملف.
- كل قسم مكتبة ملفات بلا نماذج إدخال: زر «رفع ملف جديد» يفتح منتقي الملفات مباشرة (عدة ملفات أو سحب وإفلات)، ثم: استعراض – تحميل – إعادة تسمية – حذف، مع بحث وترتيب (الأحدث أولاً).
- مفتاح التخزين: `sections/<section_key>/<primary|upper|general>/<uuid>.<ext>` في الـ bucket الخاص نفسه؛ الاسم العربي الأصلي في `section_files.original_name`، والعنوان المعروض (قابل لإعادة التسمية) في `title`.
- مرفقات السجلات السابقة (`sections/<key>/<record_id>/...` من نسخة سابقة) تبقى وتظهر ضمن مكتبة القسم بعلامة «مرفق سابق».
- الاستعراض داخل المنصة لـ PDF والصور عبر Signed URL؛ Word/Excel: تحميل أو فتح في تبويب جديد.
- بطاقات PDF تعرض صورة حقيقية للصفحة الأولى (انظر «معاينة PDF» أدناه).
- مجموعة «أقسام سابقة» أُزيلت من القائمة ولوحة التحكم، وحُذفت صفحاتها (تقويما الصفوف الأولية والعليا، البرامج والأنشطة، جدول حصص النشاط، التكريم السابق). **بياناتها وملفاتها باقية** في قاعدة البيانات والتخزين دون حذف، وتظهر في النسخة الاحتياطية JSON.
- «معرض النشاط» بقي كما هو (الصفحة والتصميم والصلاحيات دون تغيير) وأصبح رابطاً مستقلاً تحت «أقسام المنصة».

## الواجهة العامة و«بعيون أهالينا» والمسابقات (migrations/004)

| الصفحة | لمن | الوصف |
|--------|-----|-------|
| `index.html` | الجميع | واجهة ترحيبية بهوية المدرسة، وزر «دخول رائدة النشاط» يفتح `login.html` |
| `parents-eyes.html` | الجميع | المناسبات، و`?event=<id>` للمشاركات **المعتمدة فقط** |
| `parents-share.html` | الجميع | نموذج مشاركة ولي الأمر دون حساب (عبر Edge Function `parent-submit`) |
| `competitions.html` | الجميع / رائدة النشاط | عرض المسابقات المنشورة وملفاتها؛ ولرائدة النشاط داخل لوحة الإدارة: رفع/تعديل/إخفاء/حذف |
| `parents-eyes-admin.html` | رائدة النشاط | المراجعة (بانتظار المراجعة / منشورة / مرفوضة) وإدارة المناسبات |

- صفحات الإدارة والأقسام الـ 12 ومعرض النشاط تبقى محمية بتسجيل الدخول كما كانت.
- **الصلاحيات في الخادم:** RLS على الجداول، وسياسات Storage، وصلاحيات أعمدة للزائر. الزائر لا يملك أي INSERT/UPDATE/DELETE؛ المشاركة تمر عبر Edge Function بمفتاح `service_role` وتُنشأ دائماً `pending` (يفرضها محفز `guard_parent_post` أيضاً).
- **صور المشاركات** في bucket خاص `parents-eyes`: الزائر يقرأ صور المشاركات المعتمدة فقط، وتُنزَّل بصلاحيته في كل طلب (لا روابط دائمة)، فإلغاء النشر يوقف الوصول إليها فوراً.
- **المسابقات:** كل مسابقة عنوان + وصف مختصر اختياري + ملف أو أكثر (PDF، صور، Word، PowerPoint حتى 10 م.ب). **المسابقات الموجودة قبل التحديث والمسابقات الجديدة غير منشورة افتراضياً** (`is_published = false`) ولا يراها الزائر حتى تنشرها رائدة النشاط من لوحة الإدارة — لأن الملفات نفسها قد تحتوي أسماء أو صوراً أو بيانات خاصة؛ إخفاء الحقول النصية وحدها لا يكفي. الحقول القديمة (أسماء الطالبات، النتيجة، الملاحظات، المعلمة) **لا تُكشف للزائر** وتظهر لرائدة النشاط فقط.
- **إدارة الميزات الجديدة** (مناسبات/مشاركات «بعيون أهالينا» والمسابقات: إنشاء/تعديل/حذف/نشر) محصورة بحساب رائدة النشاط المعتمد عبر `public.feature_managers` و`is_feature_manager()` على الخادم — **وليس** كل حساب بدور «مدير»، ولا تعتمد على الاسم الظاهر أو إخفاء الأزرار في الواجهة. بقية المنصة (الأقسام الـ 12 وغيرها) تبقى على `is_editor()` كما كانت.
- **النطاق المعتمد للمنصة:** `https://activity.albian127.net` (ملف `CNAME`) ومضمّن في قوائم Origin المسموح لدالتي `parent-submit` و`auth-username-login`، مع GitHub Pages و`localhost:5500` للتطوير. يمكن إضافة نطاقات إضافية عبر السر `EXTRA_ALLOWED_ORIGINS`.
- لا يوجد نموذج رفع للأهالي داخل المسابقات؛ مشاركاتهم في «بعيون أهالينا» فقط.
- **معرض النشاط** بقي كما هو تماماً (الصفحة، التصميم، شرط الدخول، السياسات) دون أي تغيير في هذا التحديث.

### تفعيل 004 (مرة واحدة)

1. شغّل [`migrations/004_verify_readonly.sql`](./migrations/004_verify_readonly.sql) واحفظ النتائج (قبل).
2. شغّل [`migrations/004_public_parents_competitions.sql`](./migrations/004_public_parents_competitions.sql) في SQL Editor (إضافي وآمن لإعادة التشغيل؛ لا يحذف بيانات ولا يغيّر سياسات المعرض أو الأقسام).
3. أعد استعلامات التحقق وقارن (بعد): الأعداد في الاستعلام 1 يجب أن تبقى كما هي. راجع أيضاً [`migrations/004_verify_after.sql`](./migrations/004_verify_after.sql).
4. انشر الدالة واضبط الملح — راجع [`supabase/functions/parent-submit/README.md`](./supabase/functions/parent-submit/README.md):
   ```bash
   supabase functions deploy parent-submit --no-verify-jwt
   supabase secrets set PARENT_SUBMIT_SALT=<قيمة-عشوائية-طويلة>
   ```
5. إن تغيّر نطاق المنصة عن `activity.albian127.net` أو `alalawirabab.github.io`، حدّث قوائم Origin في الدالتين أو أضِف النطاق عبر `EXTRA_ALLOWED_ORIGINS`، ثم أعد نشر الدالة المتأثرة.

قبل تنفيذ 004 تعمل الواجهة العامة بأسماء افتراضية، وتعرض صفحات «بعيون أهالينا» والمسابقات رسالة بأن القسم غير مفعّل.

### معاينة PDF (الصفحة الأولى)

- تُولَّد في المتصفح بـ **PDF.js** (`pdfjs-dist@4.10.38` نسخة legacy من jsDelivr) من الملف الأصلي نفسه بصلاحية المستخدم الحالي؛ الملف الأصلي لا يُعدَّل ولا يُرفع أي شيء.
- تحميل كسول (عند اقتراب البطاقة من الشاشة، طلبان متزامنان كحد أقصى) مع مؤشر تحميل، وتخزين مؤقت في الذاكرة و**IndexedDB** على الجهاز (حتى 300 معاينة)، ويُمسح عند تسجيل الخروج.
- تُعرض الصفحة كاملة داخل البطاقة (`object-fit: contain`)، وتدعم العربية (خطوط مضمّنة + cMaps) والملفات الممسوحة (صور داخل PDF). عند التعذّر تبقى أيقونة PDF.
- تُطبَّق على بطاقات الأقسام الـ 12 والمسابقات. بطاقات الصور والأنواع الأخرى كما هي، ومعرض النشاط لا يعرض ملفات PDF فلم يتغير.
- أُضيف `worker-src 'self' blob:` إلى CSP الصفحات (عدا `gallery.html`) لتشغيل عامل PDF.js.

### تفعيل الأقسام (مرة واحدة)

1. افتح **SQL Editor** في مشروع Supabase الحالي.
2. شغّل استعلامات القراءة فقط في [`migrations/002_verify_readonly.sql`](./migrations/002_verify_readonly.sql) واحفظ نتائجها (قبل). الاستعلام الأول يحدد السيناريو:
   - **A — 002 لم يُنفَّذ:** شغّل [`002_activity_sections.sql`](./migrations/002_activity_sections.sql) ثم [`003_sections_direct_files.sql`](./migrations/003_sections_direct_files.sql) (الثاني لن يغيّر شيئاً لكنه آمن).
   - **B — 002 قديم منفّذ:** شغّل `003_sections_direct_files.sql` فقط.
   - **C — محدّث:** لا يلزم شيء.
3. أعد تشغيل استعلامات التحقق وقارن (بعد).
4. الملفات إضافية فقط وآمنة لإعادة التشغيل، وتبدأ بفحص مسبق يتوقف برسالة عربية واضحة إن نقص متطلب. 002 ينشئ `activity_sections` و`activity_records` و`section_files` مع RLS، ويضيف أنواع Word/Excel/GIF إلى الـ bucket، وسياسة رفع للمسار `sections/` وسياسة تقييدية تمنع نقل/الكتابة فوق كائناته. 003 يسمح بالرفع المباشر في الأقسام 5–12 ويضيف قيد مطابقة النطاق — دون حذف أي بيانات أو تعديل السياسات الحالية.

---

## وضع المفاتيح في config.js

عدّل [`js/config.js`](./js/config.js):

```js
export const SUPABASE_URL = 'https://YOUR_PROJECT_REF.supabase.co';
export const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

يوجد أيضاً [`js/config.example.js`](./js/config.example.js) كقالب.

### ممنوع في الواجهة

- `service_role`
- كلمة مرور قاعدة البيانات
- JWT secret
- أي أسرار خاصة

مفتاح `anon` مسموح مع RLS صحيح.

---

## التشغيل محلياً

لا تفتح المشروع عبر `file://` إذا كانت الوحدات تُحظر.

### خيار 1: Python

```bash
python -m http.server 5500
```

ثم افتح: `http://127.0.0.1:5500/`

### خيار 2: VS Code / Cursor Live Server

افتح المجلد وشغّل Live Server على المنفذ المناسب.

---

## النشر على GitHub Pages

1. ارفع المستودع إلى GitHub.
2. Settings → Pages → Source: فرع `main` / المجلد `/` (أو `docs` إن اخترت).
3. الروابط في المشروع نسبية (`./css/...`, `./dashboard.html`) لتعمل تحت:
   `https://USERNAME.github.io/REPO_NAME/`
4. حدّث Site URL و Redirect URLs في Supabase إلى رابط Pages.

---

## الأمان

- الحماية الحقيقية عبر **RLS** وليس بإخفاء الأزرار فقط.
- `audit_logs` تُكتب عبر RPC `write_audit_log` فقط (`user_id` و`created_at` من الخادم).
- المستخدم لا يستطيع ترقية `role` أو تغيير `is_active` ذاتياً (Trigger + RLS).
- Storage خاص + سياسات حسب الدور/المسار.
- لا تضع كلمات مرور في جداول `public`.
- لا تعطّل RLS.
- النسخ الاحتياطي الحقيقي لـ PostgreSQL: من **Supabase Dashboard** أو أدوات `pg_dump` حسب خطتك. ميزة Export/Import في الإعدادات تصدّر JSON لبيانات الأعمال فقط.

---

## المكتبات الخارجية (CDN موثوق)

| المكتبة | المصدر | الاستخدام |
|---------|--------|-----------|
| `@supabase/supabase-js@2` | jsDelivr ESM | العميل |
| `xlsx@0.18.5` (SheetJS) | jsDelivr | تصدير Excel |
| `pdfjs-dist@4.10.38` (legacy) | jsDelivr ESM | صورة الصفحة الأولى لملفات PDF |

الخطوط: **Tajawal** عبر Google Fonts.

CSP يسمح فقط بـ `cdn.jsdelivr.net` و`*.supabase.co` وGoogle Fonts — بدون `*` عام غير موثّق.

---

## اختبار قبل الإنتاج (Checklist)

- [ ] الواجهة العامة تفتح دون تسجيل دخول، وزر «دخول رائدة النشاط» يفتح تسجيل الدخول
- [ ] تسجيل الدخول / الخروج (الخروج يعود للواجهة العامة)
- [ ] حماية صفحات الإدارة بدون جلسة
- [ ] Dashboard وإحصائيات حقيقية، دون «أقسام سابقة»
- [ ] «بعيون أهالينا»: إرسال دون حساب، لا يظهر قبل الاعتماد، يختفي بعد إلغاء النشر
- [ ] المسابقات: رفع ملفات، عرض عام، فتح وتنزيل، إخفاء عن الزوار
- [ ] صورة الصفحة الأولى لبطاقات PDF
- [ ] معرض الصور (دون تغيير)
- [ ] إعدادات المنصة (admin فقط)
- [ ] تغيير كلمة المرور عبر Auth
- [ ] بحث / تصفية / ترتيب / Excel / طباعة
- [ ] الأقسام الـ 12: رفع مباشر / استعراض / تحميل / إعادة تسمية / حذف (بعد تشغيل 002 و/أو 003)
- [ ] تبويبا الصفوف الأولية والعليا مستقلان في القسمين 3 و4
- [ ] عدد الملفات لكل قسم في لوحة التحكم
- [ ] Dark Mode
- [ ] RLS مفعّل وbucket خاص
- [ ] لا توجد بيانات تجريبية
- [ ] لا يوجد `service_role` في المستودع

---

## هيكل المشروع

راجع المجلدات: `css/`, `js/`, `assets/`, وملفات HTML للجذور.

## الرخصة

MIT — انظر [`LICENSE`](./LICENSE).
