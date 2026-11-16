-- تحقق قراءة فقط قبل/بعد 007 — لا يغيّر بيانات
-- 1) أعداد أساسية (يجب أن تبقى كما هي بعد الترحيل)
select
  (select count(*) from public.parent_events) as events,
  (select count(*) from public.parent_posts) as posts,
  (select count(*) from public.parent_posts where status = 'pending') as pending,
  (select count(*) from public.parent_posts where status = 'approved') as approved,
  (select count(*) from public.parent_posts where status = 'rejected') as rejected,
  (select count(*) from public.parent_post_images) as attachments,
  (select count(*) from storage.objects where bucket_id = 'parents-eyes') as parents_eyes_objects,
  (select count(*) from storage.objects where bucket_id = 'student-activity-files') as gallery_bucket_objects;

-- 2) حدود bucket parents-eyes
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('parents-eyes', 'student-activity-files');

-- 3) عمود kind ونوايا الرفع (بعد 007)
select
  exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'parent_post_images' and column_name = 'kind'
  ) as has_kind_column,
  to_regclass('public.parent_upload_intents') is not null as has_intents_table;

-- 4) دوال الخدمة
select p.proname,
  has_function_privilege('anon', p.oid, 'execute') as anon_exec,
  has_function_privilege('service_role', p.oid, 'execute') as service_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'create_parent_post',
    'parents_eyes_object_is_public',
    'parent_register_upload_intents',
    'parent_list_orphan_upload_paths',
    'parent_delete_upload_intents'
  )
order by p.proname;
