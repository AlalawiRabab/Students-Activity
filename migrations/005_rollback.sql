-- =====================================================================
-- Rollback: migrations/005_public_view_admin_pin.sql
-- File: migrations/005_rollback.sql
--
-- متى: إذا فشل تشغيل وضع الإدارة بالرقم السري بعد تطبيق 005 (لا تصدر جلسة إدارة).
-- ماذا يفعل: يعيد حالة ما قبل 005 حرفياً كما قُرئت من الإنتاج قبل التطبيق:
--   - دوال الصلاحيات is_editor / is_admin / is_feature_manager بلا شرط جلسة الإدارة
--     (فتعود صلاحية الإدارة بتسجيل الدخول بكلمة المرور عبر auth-username-login كما كانت).
--   - يغلق المشاهدة العامة التي أضافها 005 (الأقسام والمعرض وكائناتهما في Storage)،
--     ويعيد صلاحيات الزائر على هذه الجداول إلى ما كانت عليه (لا شيء).
-- لا يحذف أي بيانات: جداول admin_* تبقى (فارغة الأثر)، ولا يمس المسابقات أو «بعيون أهالينا».
-- بعده: أبقِ الواجهة السابقة منشورة (أو أعد main إلى commit ما قبل الدمج).
-- =====================================================================

create or replace function public.is_admin()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role = 'admin'
  );
$function$;

create or replace function public.is_editor()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role in ('admin', 'activity_leader')
  );
$function$;

create or replace function public.is_feature_manager()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select exists (
    select 1
    from public.feature_managers m
    join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid()
      and p.is_active
      and p.role in ('admin', 'activity_leader')
  );
$function$;

drop policy if exists activity_sections_select_public on public.activity_sections;
drop policy if exists section_files_select_public on public.section_files;
drop policy if exists activity_records_select_public on public.activity_records;
drop policy if exists gallery_select_public on public.gallery;
drop policy if exists sap_public_content_read on storage.objects;

revoke all on table public.activity_sections from anon;
revoke all on table public.section_files from anon;
revoke all on table public.activity_records from anon;
revoke all on table public.gallery from anon;
revoke execute on function public.section_file_counts() from anon;

-- إبطال أي جلسة إدارة قائمة (لا أثر لها بعد الرجوع، للاحتياط)
update public.admin_sessions set revoked_at = now() where revoked_at is null;

-- تحقق
select
  pg_get_functiondef('public.is_editor()'::regprocedure) like '%admin_session_valid%' as is_editor_still_requires_pin,
  (select count(*) from pg_policies where policyname in (
    'activity_sections_select_public', 'section_files_select_public',
    'activity_records_select_public', 'gallery_select_public', 'sap_public_content_read')) as public_policies_left,
  has_table_privilege('anon', 'public.gallery', 'select') as anon_reads_gallery;
