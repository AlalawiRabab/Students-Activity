# Edge Function: parent-submit

## الغرض
استقبال مشاركة ولي الأمر في «بعيون أهالينا» **دون حساب**.

## مسار الرفع (50 م.ب)
1. **`POST` JSON `{ action: "prepare", video?, audio? }`** — يتحقق من الحجم، يسجّل نوايا في `parent_upload_intents`، ويُرجع Signed Upload URLs. العميل يرفع مباشرة للتخزين.
2. **`POST` multipart** (صور + حقول فقط) مع `post_id` و`video_path`/`audio_path`.  
   الدالة تتحقق من الملف **في التخزين** (حجم/نوع/ارتباط بالنية) قبل `create_parent_post`.  
   إعادة المحاولة لنفس `post_id` بعد النجاح idempotent.  
   مرفقات الفيديو/الصوت داخل multipart مرفوضة.

## تنظيف المؤقتات
عند كل `prepare`/`finalize` تُستدعى تنظيف نوايا غير مستهلكة أقدم من **ساعتين** وغير مربوطة بـ `parent_post_images`، مع تجنّب حذف كائن عُدّل خلال 30 دقيقة (رفع جارٍ).

## الخصوصية في الواجهة
`download()` → blob؛ تُبطَل عند مغادرة الصفحة (`pagehide` / `visibilitychange`) وعند تغيير حالة المشاركة. النسخ المحفوظة على جهاز الزائر لا تُسحب عن بُعد.

## النشر (مشروع النشاط فقط)
```bash
npx supabase db query --yes --remote=rcxcmxaplyzxhhgrmhqj -f migrations/007_parents_video_audio.sql
npx supabase functions deploy parent-submit --no-verify-jwt --use-api --remote=rcxcmxaplyzxhhgrmhqj
```

## الاختبارات
```bash
npx --yes deno test supabase/functions/parent-submit/
npx --yes deno run -A supabase/functions/parent-submit/local-harness.ts
```
