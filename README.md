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
- الصفحات القديمة (التقويمات، البرامج، الجداول، المسابقات، التكريم السابق، المعرض) باقية ببياناتها تحت «أقسام سابقة» في القائمة الجانبية ولوحة التحكم.

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

الخطوط: **Tajawal** عبر Google Fonts.

CSP يسمح فقط بـ `cdn.jsdelivr.net` و`*.supabase.co` وGoogle Fonts — بدون `*` عام غير موثّق.

---

## اختبار قبل الإنتاج (Checklist)

- [ ] تسجيل الدخول / الخروج
- [ ] حماية الصفحات بدون جلسة
- [ ] Dashboard وإحصائيات حقيقية
- [ ] تقويم أولية / عليا CRUD
- [ ] برامج صفي / لاصفي CRUD
- [ ] رفع جدول + معاينة PDF/صور عبر Signed URL
- [ ] مسابقات + شواهد
- [ ] تكريم + شواهد
- [ ] معرض الصور
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
