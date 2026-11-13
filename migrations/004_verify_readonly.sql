-- =====================================================================
-- استعلامات تحقق للقراءة فقط لترحيل 004 (SELECT فقط — لا تعدّل شيئاً)
-- شغّلها قبل migrations/004_public_parents_competitions.sql وبعده وقارن النتائج.
-- =====================================================================

-- 0) هل نُفّذ 004؟ (قبل: false)
select to_regclass('public.parent_posts') is not null as migration_004_applied;

-- 1) أعداد البيانات الحالية — يجب أن تبقى كما هي بعد التنفيذ
select
  (select count(*) from public.competitions) as competitions,
  (select count(*) from public.competition_files) as competition_files,
  (select count(*) from public.gallery) as gallery,
  (select count(*) from public.honors) as honors,
  (select count(*) from public.honor_files) as honor_files,
  (select count(*) from public.elementary_calendar) as elementary_calendar,
  (select count(*) from public.upper_calendar) as upper_calendar,
  (select count(*) from public.classroom_programs) as classroom_programs,
  (select count(*) from public.extracurricular_programs) as extracurricular_programs,
  (select count(*) from public.schedules) as schedules,
  (select count(*) from storage.objects where bucket_id = 'student-activity-files') as storage_objects;

-- 1b) الحسابات ذات صلاحية التحرير فعلياً (راجعيها قبل التنفيذ)
-- 004 يحصر إدارة «بعيون أهالينا» والمسابقات في الحساب 8fc5d107-2267-4ff1-9988-b5ead65a290d فقط؛
-- بقية الحسابات أدناه تحتفظ بصلاحياتها في الأقسام الـ 12 والمعرض كما هي.
select p.id, p.username, p.full_name, p.role, p.is_active,
       p.id = '8fc5d107-2267-4ff1-9988-b5ead65a290d'::uuid as is_approved_leader_account
from public.profiles p
where p.role in ('admin', 'activity_leader')
order by p.role, p.username;

-- (بعد التنفيذ شغّلي أيضاً migrations/004_verify_after.sql)

-- 2) سياسات معرض النشاط (gallery) — يجب ألا تتغير
select policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and tablename = 'gallery'
order by policyname;

-- 3) بعد التنفيذ: الـ buckets (parents-eyes خاص 5 م.ب، والقديم ما زال خاصاً + PowerPoint)
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('parents-eyes', 'student-activity-files');

-- 4) بعد التنفيذ: صلاحيات الأعمدة للزائر (لا participant_students ولا result ولا notes ولا reviewed_by)
select table_name, string_agg(column_name, ', ' order by column_name) as anon_columns
from information_schema.column_privileges
where grantee = 'anon'
  and table_schema = 'public'
  and privilege_type = 'SELECT'
  and table_name in ('competitions', 'competition_files', 'parent_events', 'parent_posts', 'parent_post_images')
group by table_name
order by table_name;

-- 5) بعد التنفيذ: لا صلاحية INSERT/UPDATE/DELETE للزائر على الجداول الجديدة والمسابقات
select table_name, privilege_type
from information_schema.table_privileges
where grantee = 'anon'
  and table_schema = 'public'
  and table_name in ('competitions', 'competition_files', 'parent_events', 'parent_posts', 'parent_post_images', 'parent_submit_attempts')
order by table_name, privilege_type;
-- المتوقع: لا صفوف (الصلاحيات على مستوى الأعمدة تظهر في الاستعلام 4 فقط)

-- 6) بعد التنفيذ: دوال الخادم غير قابلة للتنفيذ من الزائر
select p.proname,
       has_function_privilege('anon', p.oid, 'execute') as anon_can_execute,
       has_function_privilege('service_role', p.oid, 'execute') as service_can_execute
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('create_parent_post', 'parent_submit_throttle', 'get_public_settings');
-- المتوقع: create_parent_post و parent_submit_throttle → anon=false؛ get_public_settings → anon=true

-- 7) بعد التنفيذ: سياسات التخزين الجديدة
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
order by policyname;
