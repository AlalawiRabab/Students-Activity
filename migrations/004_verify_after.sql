-- =====================================================================
-- تحقق بعد تنفيذ 004 فقط (SELECT فقط). شغّلي 004_verify_readonly.sql أيضاً وقارني الأعداد.
-- =====================================================================

-- 1) الحساب المعتمد لإدارة «بعيون أهالينا» والمسابقات (المتوقع صف واحد: Eman)
select m.user_id, p.username, p.role, p.is_active
from public.feature_managers m
join public.profiles p on p.id = m.user_id;

-- 2) المسابقات القائمة كلها مخفية عن الزوار حتى تنشرها رائدة النشاط (published = 0)
select count(*) filter (where is_published) as published,
       count(*) filter (where not is_published) as hidden
from public.competitions;

-- 3) سياسات الكتابة في الميزات الجديدة تعتمد is_feature_manager() (لا is_editor())
select tablename, policyname, cmd, coalesce(qual, '') || ' ' || coalesce(with_check, '') as rule
from pg_policies
where schemaname = 'public'
  and tablename in ('competitions', 'competition_files', 'parent_events', 'parent_posts', 'parent_post_images')
  and cmd in ('INSERT', 'UPDATE', 'DELETE')
order by tablename, policyname;

-- 4) سياسات التخزين التقييدية لملفات المسابقات
select policyname, permissive, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname like 'sap_competitions_storage_%';
