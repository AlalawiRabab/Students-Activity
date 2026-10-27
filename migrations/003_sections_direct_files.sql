-- =====================================================================
-- Migration: رفع الملفات مباشرة في كل الأقسام الـ 12 (مكتبة ملفات بلا نماذج)
-- File: migrations/003_sections_direct_files.sql
--
-- راجع ثم نفّذ يدوياً في Supabase SQL Editor بعد الموافقة.
--
-- متى يُشغَّل؟
-- - إن كان 002 قد نُفّذ سابقاً (النسخة التي تشترط سجلاً للأقسام 5–12): شغّل هذا الملف.
-- - إن لم يُنفَّذ 002 بعد: شغّل 002 (النسخة الحالية تتضمن هذا التعديل) ثم هذا الملف
--   اختيارياً — لن يغيّر شيئاً.
--
-- ما يغيّره (يخص كائنات 002 فقط):
-- 1) يعيد تعريف public.guard_section_file(): الأقسام 5–12 (kind = records) تقبل ملفات
--    مباشرة (record_id = null) إضافة إلى مرفقات السجلات القديمة.
-- 2) يضيف قيد section_files_scope_matches (NOT VALID) لمطابقة مقطع النطاق في المسار.
--
-- ما لا يغيّره: لا drop table، لا حذف صفوف، لا تعديل على activity_records أو بياناتها،
-- لا تعديل على سياسات RLS أو Storage أو الـ bucket أو أي كائن خارج 002.
-- آمن لإعادة التشغيل.
-- =====================================================================

-- 0) فحص مسبق: يتطلب تنفيذ 002 أولاً
do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regclass('public.activity_sections') is null then missing := missing || 'table public.activity_sections'::text; end if;
  if to_regclass('public.section_files') is null then missing := missing || 'table public.section_files'::text; end if;
  if to_regclass('public.activity_records') is null then missing := missing || 'table public.activity_records'::text; end if;
  if to_regprocedure('public.is_editor()') is null then missing := missing || 'function public.is_editor()'::text; end if;
  if to_regprocedure('public.is_allowed_section_path(text)') is null then
    missing := missing || 'function public.is_allowed_section_path(text)'::text;
  end if;
  if to_regprocedure('auth.uid()') is null then missing := missing || 'function auth.uid()'::text; end if;

  if array_length(missing, 1) > 0 then
    raise exception
      'migration 003 متوقف: نفّذ migrations/002_activity_sections.sql أولاً. Missing: %',
      array_to_string(missing, '; ');
  end if;
end $$;

-- 1) قاعدة النطاق الجديدة (مطابقة حرفياً للنسخة الحالية من 002)
create or replace function public.guard_section_file()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text;
begin
  if tg_op = 'INSERT' then
    select s.kind into v_kind from public.activity_sections s where s.key = new.section_key;
    if v_kind is null then
      raise exception 'قسم غير معروف';
    end if;

    if v_kind = 'tabs' then
      if new.sub_key is null or new.record_id is not null then
        raise exception 'ملفات هذا القسم تتطلب تبويباً (الصفوف الأولية / العليا)';
      end if;
    else
      if new.sub_key is not null then
        raise exception 'هذا القسم لا يحتوي تبويبات';
      end if;
      if new.record_id is not null and v_kind <> 'records' then
        raise exception 'ملفات هذا القسم تُرفع على القسم مباشرة';
      end if;
    end if;

    new.created_by := auth.uid();
    new.updated_by := null;
  else
    -- النطاق ومسار التخزين ثابتان بعد الرفع؛ التعديل للعنوان/الوصف/التصنيف فقط
    new.id := old.id;
    new.section_key := old.section_key;
    new.sub_key := old.sub_key;
    new.record_id := old.record_id;
    new.storage_path := old.storage_path;
    new.original_name := old.original_name;
    new.mime_type := old.mime_type;
    new.file_kind := old.file_kind;
    new.file_size := old.file_size;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

-- المحفز نفسه من 002 (يُعاد ربطه للتأكد فقط)
drop trigger if exists trg_guard_section_file on public.section_files;
create trigger trg_guard_section_file
  before insert or update on public.section_files
  for each row execute function public.guard_section_file();

revoke all on function public.guard_section_file() from public;
revoke all on function public.guard_section_file() from anon;
revoke all on function public.guard_section_file() from authenticated;

-- 2) مطابقة مقطع النطاق (NOT VALID: لا يفحص الصفوف القائمة ولا يرفضها)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'section_files_scope_matches'
      and conrelid = 'public.section_files'::regclass
  ) then
    alter table public.section_files
      add constraint section_files_scope_matches
      check (
        split_part(storage_path, '/', 3) = coalesce(sub_key, record_id::text, 'general')
        and split_part(storage_path, '/', 5) = ''
      ) not valid;
  end if;
end $$;

comment on function public.guard_section_file() is
  'الأقسام 1–2 و5–12: ملفات مباشرة (scope = general)؛ 3–4: تبويب primary/upper؛ 5–12 تقبل أيضاً مرفقات سجلات قديمة';

-- 3) تحقق (قراءة فقط)
select conname, convalidated
from pg_constraint
where conrelid = 'public.section_files'::regclass
  and conname in ('section_files_scope_matches', 'section_files_record_fk', 'section_files_path_prefix');
