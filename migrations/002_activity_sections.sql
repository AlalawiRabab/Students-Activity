-- =====================================================================
-- Migration: أقسام السجل الإلكتروني لرائدة النشاط + نظام الملفات الموحّد
-- File: migrations/002_activity_sections.sql
--
-- راجع ثم نفّذ يدوياً في Supabase SQL Editor بعد الموافقة.
-- لا يُنفَّذ تلقائياً من الواجهة أو CI.
--
-- مبادئ هذا الملف:
-- - إضافي فقط (idempotent): create if not exists / add column if not exists.
-- - لا drop table ولا delete ولا truncate لأي بيانات.
-- - لا يغيّر سياسات الجداول القديمة ولا سياسات Storage الحالية.
-- - يعيد استخدام دوال الصلاحيات الموجودة: is_profile_active() / is_editor().
-- - يعيد استخدام الـ bucket الخاص student-activity-files بمسار جديد sections/...
-- - المتطلب المسبق: database.sql (ثم 001) منفّذان على المشروع.
-- =====================================================================

-- =====================================================================
-- 0) فحص مسبق: يتوقف الترحيل برسالة واضحة إن نقص أي اعتماد — قبل إنشاء أي شيء
-- =====================================================================
do $$
declare
  missing text[] := array[]::text[];
  fn record;
begin
  for fn in
    select * from (values
      ('public.is_editor()',         'boolean', true),
      ('public.is_profile_active()', 'boolean', true),
      ('public.set_updated_at()',    'trigger', false),
      ('auth.uid()',                 'uuid',    null::boolean)
    ) as t(sig, ret, must_definer)
  loop
    if to_regprocedure(fn.sig) is null then
      missing := missing || format('function %s', fn.sig);
    elsif pg_get_function_result(to_regprocedure(fn.sig)) <> fn.ret then
      missing := missing || format('function %s must return %s (found %s)',
        fn.sig, fn.ret, pg_get_function_result(to_regprocedure(fn.sig)));
    elsif fn.must_definer is true and not (
      select p.prosecdef from pg_proc p where p.oid = to_regprocedure(fn.sig)
    ) then
      missing := missing || format('function %s must be SECURITY DEFINER', fn.sig);
    end if;
  end loop;

  if to_regclass('public.profiles') is null then missing := missing || 'table public.profiles'::text; end if;
  if to_regclass('auth.users') is null then missing := missing || 'table auth.users'::text; end if;
  if to_regclass('storage.objects') is null then missing := missing || 'table storage.objects'::text; end if;
  if to_regclass('storage.buckets') is null then
    missing := missing || 'table storage.buckets'::text;
  elsif not exists (select 1 from storage.buckets where id = 'student-activity-files') then
    missing := missing || 'storage bucket student-activity-files'::text;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    missing := missing || 'role authenticated'::text;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    missing := missing || 'role anon'::text;
  end if;

  if array_length(missing, 1) > 0 then
    raise exception
      'migration 002 متوقف: متطلبات ناقصة — نفّذ database.sql أولاً. Missing: %',
      array_to_string(missing, '; ');
  end if;
end $$;

create extension if not exists "pgcrypto";

-- =====================================================================
-- 1) سجل الأقسام (مفاتيح ثابتة وترتيب القائمة)
-- kind:
--   files   → ملفات مباشرة على القسم (sub_key = null, record_id = null)
--   tabs    → تبويبان مستقلان primary / upper (sub_key إلزامي)
--   records → ملفات مباشرة على القسم أيضاً؛ ويقبل كذلك مرفقات سجلات activity_records
--             القديمة (record_id) إن وُجدت — الواجهة مكتبة ملفات فقط ولا تنشئ سجلات
-- =====================================================================
create table if not exists public.activity_sections (
  key text primary key
    check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  title text not null
    check (char_length(trim(title)) between 1 and 200),
  description text,
  kind text not null
    check (kind in ('files', 'tabs', 'records')),
  sort_order smallint not null default 0,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.activity_sections is
  'سجل أقسام رائدة النشاط بمفاتيح ثابتة — يُدار عبر SQL فقط (لا كتابة من الواجهة)';

insert into public.activity_sections (key, title, description, kind, sort_order) values
  ('noor_assignment',   'تكليف رائدة النشاط في نظام نور',
     'حفظ خطاب أو قرار تكليف رائدة النشاط في نظام نور مع إمكانية الإرفاق والاستعراض والتحديث.', 'files', 1),
  ('leader_record',     'سجل رائدة النشاط',
     'سجل منظّم لوثائق رائدة النشاط؛ لكل ملف عنوان ووصف.', 'files', 2),
  ('class_plan',        'خطة النشاط الفصلية للبرامج الصفية – الصفوف الأولية والعليا',
     'خطط البرامج الصفية في تبويبين مستقلين: الصفوف الأولية والصفوف العليا.', 'tabs', 3),
  ('extra_plan',        'خطة المدرسة للأنشطة اللاصفية – الصفوف الأولية والعليا',
     'خطط الأنشطة اللاصفية في تبويبين مستقلين: الصفوف الأولية والصفوف العليا.', 'tabs', 4),
  ('announcements',     'إعلانات البرامج',
     'إعلانات البرامج بعنوان ووصف وتاريخ ومرفقات.', 'records', 5),
  ('class_reports',     'تقارير البرامج الصفية',
     'تقارير البرامج الصفية مع التقارير والشواهد.', 'records', 6),
  ('extra_reports',     'تقارير البرامج اللاصفية',
     'تقارير البرامج اللاصفية مع التقارير والشواهد.', 'records', 7),
  ('parent_reports',    'تقارير تعزيز أولياء الأمور',
     'توثيق مشاركة أولياء الأمور مع التقارير والشواهد.', 'records', 8),
  ('student_workshops', 'الورش التدريبية للطالبات',
     'الورش التدريبية مع الملفات والصور والتقارير.', 'records', 9),
  ('student_surveys',   'استطلاع الطالبات والطلاب على برامج ومجالات النشاط',
     'الاستبانات وتحليل النتائج والمرفقات.', 'records', 10),
  ('parent_surveys',    'استطلاع ولي الأمر على مجالات النشاط',
     'استطلاعات أولياء الأمور ونتائجها وتحليلها.', 'records', 11),
  ('honors',            'التكريمات',
     'التكريمات مع الصور والشهادات والملفات.', 'records', 12)
-- إعادة التشغيل لا تكتب فوق أي تعديل يدوي على صفوف موجودة؛ تضيف المفاتيح الناقصة فقط
on conflict (key) do nothing;

-- =====================================================================
-- 2) سجلات الأقسام (عام مع حقول حسب نوع القسم)
-- =====================================================================
create table if not exists public.activity_records (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references public.activity_sections (key) on update cascade,
  title text not null
    check (char_length(trim(title)) between 1 and 200),
  description text
    check (description is null or char_length(description) <= 4000),
  event_date date,
  target_group text
    check (target_group is null or char_length(target_group) <= 200),
  objective text
    check (objective is null or char_length(objective) <= 2000),
  reason text
    check (reason is null or char_length(reason) <= 2000),
  honored_group text
    check (honored_group is null or char_length(honored_group) <= 200),
  extra jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extra) = 'object'),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- مفتاح مركّب يمنع ربط ملف بسجل من قسم آخر
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'activity_records_id_section_uk'
      and conrelid = 'public.activity_records'::regclass
  ) then
    alter table public.activity_records
      add constraint activity_records_id_section_uk unique (id, section_key);
  end if;
end $$;

comment on table public.activity_records is
  'سجلات أقسام رائدة النشاط (إعلانات، تقارير، ورش، استطلاعات، تكريمات)';

-- =====================================================================
-- 3) ملفات الأقسام (بيانات وصفية؛ الملف نفسه في Storage الخاص)
-- =====================================================================
create table if not exists public.section_files (
  id uuid primary key default gen_random_uuid(),
  section_key text not null references public.activity_sections (key) on update cascade,
  sub_key text
    check (sub_key is null or sub_key in ('primary', 'upper')),
  record_id uuid,
  category text
    check (category is null or category ~ '^[a-z_]{1,40}$'),
  storage_path text not null unique
    check (char_length(storage_path) <= 400),
  original_name text not null
    check (char_length(trim(original_name)) between 1 and 255),
  mime_type text not null
    check (mime_type in (
      'application/pdf',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    )),
  file_kind text not null
    check (file_kind in ('pdf', 'image', 'word', 'excel')),
  file_size bigint not null
    check (file_size > 0 and file_size <= 10485760),
  title text not null
    check (char_length(trim(title)) between 1 and 200),
  description text
    check (description is null or char_length(description) <= 2000),
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  -- مطابقة حرفية للمقطعين الأولين (LIKE يعامل _ كحرف بدل، لذا لا يُستخدم هنا)
  constraint section_files_path_prefix
    check (
      split_part(storage_path, '/', 1) = 'sections'
      and split_part(storage_path, '/', 2) = section_key
    )
);

-- ON DELETE RESTRICT: لا يُحذف سجل ما دامت له ملفات؛ الواجهة تحذف كائنات Storage
-- ثم صفوف الملفات ثم السجل. CASCADE كان سيحذف الصفوف بصمت ويترك الكائنات يتيمة في Storage.
do $$
declare
  v_deltype "char";
begin
  select c.confdeltype into v_deltype
  from pg_constraint c
  where c.conname = 'section_files_record_fk'
    and c.conrelid = 'public.section_files'::regclass;

  if v_deltype is not null and v_deltype <> 'r' then
    -- قيد يخص هذا الترحيل فقط (من نسخة سابقة منه) — يُستبدل دون أي حذف بيانات
    alter table public.section_files drop constraint section_files_record_fk;
    v_deltype := null;
  end if;

  if v_deltype is null then
    alter table public.section_files
      add constraint section_files_record_fk
      foreign key (record_id, section_key)
      references public.activity_records (id, section_key)
      on delete restrict;
  end if;
end $$;

-- المقطع الثالث من المسار يطابق النطاق: التبويب أو معرّف السجل القديم أو general للملفات المباشرة.
-- NOT VALID: يُطبَّق على الصفوف الجديدة فقط ولا يفحص/يرفض أي صف قائم.
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

comment on table public.section_files is
  'ملفات الأقسام: الاسم العربي الأصلي في original_name؛ مفتاح Storage آمن ASCII تحت sections/<section_key>/...';

-- =====================================================================
-- 4) Indexes
-- =====================================================================
create index if not exists idx_activity_records_section
  on public.activity_records (section_key, event_date desc nulls last, created_at desc);
create index if not exists idx_activity_records_created_by
  on public.activity_records (created_by);

create index if not exists idx_section_files_scope
  on public.section_files (section_key, sub_key, created_at desc);
create index if not exists idx_section_files_record
  on public.section_files (record_id);
create index if not exists idx_section_files_created_by
  on public.section_files (created_by);

-- =====================================================================
-- 5) Triggers: updated_at + فرض الهوية والنطاق (منع خلط الأقسام/التبويبات)
-- =====================================================================
drop trigger if exists trg_activity_sections_updated_at on public.activity_sections;
create trigger trg_activity_sections_updated_at
  before update on public.activity_sections
  for each row execute function public.set_updated_at();

drop trigger if exists trg_activity_records_updated_at on public.activity_records;
create trigger trg_activity_records_updated_at
  before update on public.activity_records
  for each row execute function public.set_updated_at();

drop trigger if exists trg_section_files_updated_at on public.section_files;
create trigger trg_section_files_updated_at
  before update on public.section_files
  for each row execute function public.set_updated_at();

create or replace function public.guard_activity_record()
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
    if v_kind is distinct from 'records' then
      raise exception 'هذا القسم لا يقبل سجلات';
    end if;
    new.created_by := auth.uid();
    new.updated_by := null;
  else
    new.id := old.id;
    new.section_key := old.section_key;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_by := auth.uid();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_activity_record on public.activity_records;
create trigger trg_guard_activity_record
  before insert or update on public.activity_records
  for each row execute function public.guard_activity_record();

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

drop trigger if exists trg_guard_section_file on public.section_files;
create trigger trg_guard_section_file
  before insert or update on public.section_files
  for each row execute function public.guard_section_file();

revoke all on function public.guard_activity_record() from public;
revoke all on function public.guard_activity_record() from anon;
revoke all on function public.guard_activity_record() from authenticated;
revoke all on function public.guard_section_file() from public;
revoke all on function public.guard_section_file() from anon;
revoke all on function public.guard_section_file() from authenticated;

comment on function public.guard_section_file() is
  'الأقسام 1–2 و5–12: ملفات مباشرة (scope = general)؛ 3–4: تبويب primary/upper؛ 5–12 تقبل أيضاً مرفقات سجلات قديمة';

-- =====================================================================
-- 6) RLS — نفس نمط الجداول الحالية:
--    SELECT: مستخدم نشط | INSERT/UPDATE/DELETE: admin + activity_leader (is_editor)
--    لا وصول لـ anon؛ لا USING (true)
-- =====================================================================
alter table public.activity_sections enable row level security;
alter table public.activity_records enable row level security;
alter table public.section_files enable row level security;

revoke all on table public.activity_sections from anon;
revoke all on table public.activity_records from anon;
revoke all on table public.section_files from anon;

grant select on table public.activity_sections to authenticated;
grant select, insert, update, delete on table public.activity_records to authenticated;
grant select, insert, update, delete on table public.section_files to authenticated;

-- activity_sections: قراءة فقط من الواجهة
drop policy if exists activity_sections_select on public.activity_sections;
create policy activity_sections_select on public.activity_sections
  for select to authenticated
  using (public.is_profile_active());

-- activity_records
drop policy if exists activity_records_select on public.activity_records;
drop policy if exists activity_records_insert on public.activity_records;
drop policy if exists activity_records_update on public.activity_records;
drop policy if exists activity_records_delete on public.activity_records;

create policy activity_records_select on public.activity_records
  for select to authenticated
  using (public.is_profile_active());

create policy activity_records_insert on public.activity_records
  for insert to authenticated
  with check (public.is_editor());

create policy activity_records_update on public.activity_records
  for update to authenticated
  using (public.is_editor())
  with check (public.is_editor());

create policy activity_records_delete on public.activity_records
  for delete to authenticated
  using (public.is_editor());

-- section_files
drop policy if exists section_files_select on public.section_files;
drop policy if exists section_files_insert on public.section_files;
drop policy if exists section_files_update on public.section_files;
drop policy if exists section_files_delete on public.section_files;

create policy section_files_select on public.section_files
  for select to authenticated
  using (public.is_profile_active());

create policy section_files_insert on public.section_files
  for insert to authenticated
  with check (public.is_editor());

create policy section_files_update on public.section_files
  for update to authenticated
  using (public.is_editor())
  with check (public.is_editor());

create policy section_files_delete on public.section_files
  for delete to authenticated
  using (public.is_editor());

-- =====================================================================
-- 7) عدد الملفات لكل قسم (للوحة الرئيسية) — security invoker فيخضع لـ RLS
-- =====================================================================
create or replace function public.section_file_counts()
returns table (section_key text, file_count bigint)
language sql
stable
security invoker
set search_path = public
as $$
  select f.section_key, count(*)::bigint
  from public.section_files f
  group by f.section_key;
$$;

revoke all on function public.section_file_counts() from public;
revoke all on function public.section_file_counts() from anon;
grant execute on function public.section_file_counts() to authenticated;

-- =====================================================================
-- 8) Storage — نفس الـ bucket الخاص student-activity-files
--
-- السياسات الحالية تبقى كما هي دون تعديل:
--   sap_storage_select : أي مستخدم نشط يقرأ (Signed URL / download) — تغطي sections/ تلقائياً
--   sap_storage_delete : المحرر يحذف — تغطي sections/ تلقائياً
--   sap_storage_insert : مقيدة بمسارات {uid}/gallery|schedules|competitions|honors
--   sap_storage_update : المحرر فقط، وWITH CHECK يشترط المسارات القديمة
-- لذلك نضيف سياسة INSERT جديدة (permissive) خاصة بالمسار الجديد فقط:
--   sections/<section_key>/<sub_key|record_id>/<uuid>.<ext>
-- وسياسة UPDATE تقييدية تمنع النقل/الكتابة فوق كائنات sections/ (انظر أدناه).
-- =====================================================================

-- إضافة أنواع Word / Excel / GIF إلى الأنواع المسموحة في الـ bucket (دمج بدون حذف أي نوع قائم)
update storage.buckets
set allowed_mime_types = (
  select array(
    select distinct m
    from unnest(
      allowed_mime_types || array[
        'application/pdf',
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      ]
    ) as m
  )
)
where id = 'student-activity-files'
  and allowed_mime_types is not null;

create or replace function public.is_allowed_section_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and object_name is not null
    and object_name ~ '^sections/[a-z][a-z0-9_]{1,40}/[a-z0-9-]{1,64}/[0-9a-f-]{36}\.(pdf|jpg|jpeg|png|webp|gif|doc|docx|xls|xlsx)$'
    and exists (
      select 1 from public.activity_sections s
      where s.key = split_part(object_name, '/', 2)
    );
$$;

revoke all on function public.is_allowed_section_path(text) from public;
revoke all on function public.is_allowed_section_path(text) from anon;
grant execute on function public.is_allowed_section_path(text) to authenticated;

drop policy if exists sap_sections_storage_insert on storage.objects;
create policy sap_sections_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-activity-files'
    and public.is_editor()
    and public.is_allowed_section_path(name)
  );

comment on function public.is_allowed_section_path is
  'يسمح بالرفع تحت sections/<section_key>/<scope>/<uuid>.<ext> فقط لمفاتيح أقسام مسجلة';

-- سياسة RESTRICTIVE (تُضاف بـ AND إلى السياسات الحالية) تمنع UPDATE على كائنات sections/
-- لأي مستخدم: لا upsert فوق ملف قائم ولا نقل/إعادة تسمية من أو إلى sections/
-- (ذلك كان سيفصل الملف عن صفه في section_files). لا أثر لها على مسارات الصفحات القديمة.
drop policy if exists sap_sections_storage_no_update on storage.objects;
create policy sap_sections_storage_no_update on storage.objects
  as restrictive
  for update to authenticated
  using (not (bucket_id = 'student-activity-files' and name like 'sections/%'))
  with check (not (bucket_id = 'student-activity-files' and name like 'sections/%'));

-- =====================================================================
-- 9) تحقق بعد التنفيذ (اختياري)
-- =====================================================================
select key, title, kind, sort_order from public.activity_sections order by sort_order;

select id, public, file_size_limit, allowed_mime_types
from storage.buckets where id = 'student-activity-files';
