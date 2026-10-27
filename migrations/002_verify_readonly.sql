-- =====================================================================
-- استعلامات تحقق للقراءة فقط (SELECT فقط — لا تعدّل أي شيء)
-- شغّل كل قسم على حدة في Supabase SQL Editor: (أ) قبل تنفيذ 002 و(ب) بعده.
-- =====================================================================

-- 1) الدوال المطلوبة: التوقيع، نوع الإرجاع، SECURITY DEFINER، search_path
select p.oid::regprocedure as function,
       pg_get_function_result(p.oid) as returns,
       p.prosecdef as security_definer,
       p.proconfig as config
from pg_proc p
where p.oid in (
  to_regprocedure('public.is_editor()'),
  to_regprocedure('public.is_profile_active()'),
  to_regprocedure('public.is_admin()'),
  to_regprocedure('public.set_updated_at()'),
  to_regprocedure('auth.uid()'),
  to_regprocedure('public.is_allowed_storage_path(text)'),
  to_regprocedure('public.protect_profile_columns()'),
  to_regprocedure('public.get_profile_for_username_login(text)')
);
-- المتوقع: is_editor/is_profile_active → boolean, security_definer = true, config = {search_path=public}
--          set_updated_at → trigger | auth.uid → uuid

-- 1b) نص التعريف الكامل للمقارنة مع database.sql
select pg_get_functiondef('public.is_editor()'::regprocedure);
select pg_get_functiondef('public.is_profile_active()'::regprocedure);
select pg_get_functiondef('public.set_updated_at()'::regprocedure);

-- 2) كل سياسات storage.objects (يجب ألا يظهر anon/public ولا qual = 'true')
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
-- بعد 002 يُضاف فقط: sap_sections_storage_insert (PERMISSIVE INSERT)
--                    sap_sections_storage_no_update (RESTRICTIVE UPDATE)

-- 3) إعدادات الـ bucket
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id = 'student-activity-files';
-- المتوقع: public = false؛ file_size_limit لا يتغير؛ الأنواع القديمة باقية + Word/Excel/GIF بعد 002

-- 4) محفزات profiles (تسجيل الدخول باسم المستخدم وحماية الأعمدة)
select tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger
where tgrelid = 'public.profiles'::regclass and not tgisinternal;
-- المتوقع: trg_protect_profile_columns (tgenabled = 'O') + trg_profiles_updated_at

-- 5) حساب Eman دون تغيير
select id, username, role, is_active
from public.profiles
where id = '8fc5d107-2267-4ff1-9988-b5ead65a290d';

-- 6) هل جداول 002 موجودة؟ (قبل التنفيذ: NULL)
select to_regclass('public.activity_sections') as sections,
       to_regclass('public.activity_records') as records,
       to_regclass('public.section_files') as files;

-- 7) بعد 002: RLS مفعّل وسياسات الجداول الجديدة
select c.relname, c.relrowsecurity as rls_enabled
from pg_class c
where c.oid in (
  to_regclass('public.activity_sections'),
  to_regclass('public.activity_records'),
  to_regclass('public.section_files')
);

select tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public'
  and tablename in ('activity_sections', 'activity_records', 'section_files')
order by tablename, policyname;

-- 8) بعد 002: نوع حذف القيد (المتوقع r = RESTRICT)
select conname, confdeltype
from pg_constraint
where conname = 'section_files_record_fk';

-- 9) أعداد البيانات القديمة (قارنها قبل/بعد — يجب أن تبقى كما هي)
select
  (select count(*) from public.honors) as honors,
  (select count(*) from public.honor_files) as honor_files,
  (select count(*) from public.competitions) as competitions,
  (select count(*) from public.gallery) as gallery,
  (select count(*) from public.schedules) as schedules,
  (select count(*) from storage.objects where bucket_id = 'student-activity-files') as storage_objects;
