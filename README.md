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
- [ ] Dark Mode
- [ ] RLS مفعّل وbucket خاص
- [ ] لا توجد بيانات تجريبية
- [ ] لا يوجد `service_role` في المستودع

---

## هيكل المشروع

راجع المجلدات: `css/`, `js/`, `assets/`, وملفات HTML للجذور.

## الرخصة

MIT — انظر [`LICENSE`](./LICENSE).
