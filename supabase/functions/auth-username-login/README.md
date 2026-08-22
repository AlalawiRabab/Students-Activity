# Edge Function: auth-username-login

## الغرض
تسجيل الدخول بـ **اسم المستخدم + كلمة المرور** دون كشف البريد الإلكتروني للمتصفح، مع بقاء كلمات المرور في **Supabase Auth** فقط.

## الأمان
- `SUPABASE_SERVICE_ROLE_KEY` يُضبط كـ **Secret** للدالة فقط — ممنوع وضعه في `js/config.js` أو GitHub Pages.
- الواجهة تستدعي الدالة بمفتاح Publishable/anon فقط.
- لا تُرجع الدالة البريد ولا قائمة المستخدمين.
- رسالة الخطأ موحّدة عند فشل الاسم أو كلمة المرور.

## النشر (بعد موافقتك فقط)
```bash
supabase functions deploy auth-username-login
```
وتأكد من تفعيل Secrets في المشروع.

## الاستدعاء من الواجهة
`POST {SUPABASE_URL}/functions/v1/auth-username-login`
Body: `{ "username": "Eman", "password": "********" }`
Response: `{ access_token, refresh_token, expires_in, token_type }`
ثم `supabase.auth.setSession(...)`.
