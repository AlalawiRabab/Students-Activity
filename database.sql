-- =====================================================================
-- منصة النشاط الطلابي | Student Activity Platform
-- database.sql — راجع هذا الملف قبل تشغيله في Supabase SQL Editor
-- =====================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- updated_at helper
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.updated_at = timezone('utc', now());
  return new;
end;
$$;

-- =====================================================================
-- Tables
-- =====================================================================

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  full_name text not null default '',
  role text not null default 'viewer'
    check (role in ('admin', 'activity_leader', 'viewer')),
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

comment on table public.profiles is 'ملفات المستخدمين المرتبطة بـ Supabase Auth — بدون كلمات مرور';

create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  platform_name text not null default 'منصة النشاط الطلابي'
    check (char_length(trim(platform_name)) between 1 and 120),
  leader_name text not null default 'إيمان الرحيلي'
    check (char_length(trim(leader_name)) between 1 and 120),
  updated_at timestamptz not null default timezone('utc', now()),
  updated_by uuid references auth.users (id) on delete set null
);

insert into public.app_settings (id, platform_name, leader_name)
values (1, 'منصة النشاط الطلابي', 'إيمان الرحيلي')
on conflict (id) do nothing;

create table if not exists public.elementary_calendar (
  id uuid primary key default gen_random_uuid(),
  gregorian_date date not null,
  hijri_date text,
  activity_name text not null
    check (char_length(trim(activity_name)) between 1 and 200),
  description text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.upper_calendar (
  id uuid primary key default gen_random_uuid(),
  gregorian_date date not null,
  hijri_date text,
  activity_name text not null
    check (char_length(trim(activity_name)) between 1 and 200),
  description text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.classroom_programs (
  id uuid primary key default gen_random_uuid(),
  program_name text not null
    check (char_length(trim(program_name)) between 1 and 200),
  teacher_name text,
  execution_date date,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.extracurricular_programs (
  id uuid primary key default gen_random_uuid(),
  program_name text not null
    check (char_length(trim(program_name)) between 1 and 200),
  teacher_name text,
  execution_date date,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  title text not null
    check (char_length(trim(title)) between 1 and 200),
  file_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('image', 'pdf')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.competitions (
  id uuid primary key default gen_random_uuid(),
  competition_name text not null
    check (char_length(trim(competition_name)) between 1 and 200),
  teacher_name text,
  participant_students text,
  competition_date date,
  result text,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

-- CASCADE يحذف صفوف DB فقط؛ حذف Storage يتم من الواجهة أولاً
create table if not exists public.competition_files (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('image', 'pdf')),
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.honors (
  id uuid primary key default gen_random_uuid(),
  recipient_name text not null
    check (char_length(trim(recipient_name)) between 1 and 200),
  recipient_type text not null
    check (recipient_type in ('student', 'teacher', 'other')),
  reason text,
  honor_date date,
  notes text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.honor_files (
  id uuid primary key default gen_random_uuid(),
  honor_id uuid not null references public.honors (id) on delete cascade,
  file_path text not null,
  file_name text not null,
  file_type text not null check (file_type in ('image', 'pdf')),
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  file_size bigint not null check (file_size > 0 and file_size <= 10485760),
  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.gallery (
  id uuid primary key default gen_random_uuid(),
  title text not null
    check (char_length(trim(title)) between 1 and 200),
  description text,
  event_date date,
  image_path text not null,
  image_name text not null,
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size bigint not null check (file_size > 0 and file_size <= 5242880),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  action text not null check (char_length(trim(action)) between 1 and 80),
  entity_type text not null check (char_length(trim(entity_type)) between 1 and 80),
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default timezone('utc', now())
);

-- =====================================================================
-- Indexes
-- =====================================================================
create index if not exists idx_profiles_role on public.profiles (role);
create index if not exists idx_profiles_active on public.profiles (is_active);

create index if not exists idx_elementary_date on public.elementary_calendar (gregorian_date);
create index if not exists idx_elementary_created on public.elementary_calendar (created_at desc);
create index if not exists idx_elementary_created_by on public.elementary_calendar (created_by);

create index if not exists idx_upper_date on public.upper_calendar (gregorian_date);
create index if not exists idx_upper_created on public.upper_calendar (created_at desc);
create index if not exists idx_upper_created_by on public.upper_calendar (created_by);

create index if not exists idx_classroom_date on public.classroom_programs (execution_date);
create index if not exists idx_classroom_created on public.classroom_programs (created_at desc);
create index if not exists idx_classroom_created_by on public.classroom_programs (created_by);

create index if not exists idx_extra_date on public.extracurricular_programs (execution_date);
create index if not exists idx_extra_created on public.extracurricular_programs (created_at desc);
create index if not exists idx_extra_created_by on public.extracurricular_programs (created_by);

create index if not exists idx_schedules_created on public.schedules (created_at desc);
create index if not exists idx_schedules_created_by on public.schedules (created_by);

create index if not exists idx_competitions_date on public.competitions (competition_date);
create index if not exists idx_competitions_created on public.competitions (created_at desc);
create index if not exists idx_competitions_created_by on public.competitions (created_by);
create index if not exists idx_competition_files_fk on public.competition_files (competition_id);

create index if not exists idx_honors_date on public.honors (honor_date);
create index if not exists idx_honors_created on public.honors (created_at desc);
create index if not exists idx_honors_created_by on public.honors (created_by);
create index if not exists idx_honor_files_fk on public.honor_files (honor_id);

create index if not exists idx_gallery_date on public.gallery (event_date);
create index if not exists idx_gallery_created on public.gallery (created_at desc);
create index if not exists idx_gallery_created_by on public.gallery (created_by);

create index if not exists idx_audit_created on public.audit_logs (created_at desc);
create index if not exists idx_audit_user on public.audit_logs (user_id);
create index if not exists idx_audit_entity on public.audit_logs (entity_type, entity_id);

-- =====================================================================
-- updated_at triggers
-- =====================================================================
do $$
declare
  t text;
  tables text[] := array[
    'profiles', 'app_settings', 'elementary_calendar', 'upper_calendar',
    'classroom_programs', 'extracurricular_programs', 'schedules',
    'competitions', 'honors', 'gallery'
  ];
begin
  foreach t in array tables loop
    execute format('drop trigger if exists trg_%s_updated_at on public.%I;', t, t);
    execute format(
      'create trigger trg_%s_updated_at before update on public.%I
       for each row execute function public.set_updated_at();', t, t);
  end loop;
end $$;

-- =====================================================================
-- Auth: إنشاء profile عند مستخدم جديد (viewer افتراضياً)
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name, role, is_active)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'مستخدم جديد'),
    'viewer',
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- Role helpers (SECURITY DEFINER لتجنب recursion مع RLS)
-- =====================================================================
create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.role
  from public.profiles p
  where p.id = auth.uid()
    and p.is_active = true
  limit 1;
$$;

create or replace function public.is_profile_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.is_active = true
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role = 'admin'
  );
$$;

create or replace function public.is_editor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role in ('admin', 'activity_leader')
  );
$$;

-- EXECUTE محدد: authenticated فقط — لا anon ولا public
revoke all on function public.current_user_role() from public;
revoke all on function public.current_user_role() from anon;
revoke all on function public.is_profile_active() from public;
revoke all on function public.is_profile_active() from anon;
revoke all on function public.is_admin() from public;
revoke all on function public.is_admin() from anon;
revoke all on function public.is_editor() from public;
revoke all on function public.is_editor() from anon;

grant execute on function public.current_user_role() to authenticated;
grant execute on function public.is_profile_active() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_editor() to authenticated;

-- دوال المحفزات لا تُستدعى من العميل
revoke all on function public.handle_new_user() from public;
revoke all on function public.handle_new_user() from anon;
revoke all on function public.handle_new_user() from authenticated;

-- حماية أعمدة profiles: role / is_active / id
create or replace function public.protect_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_is_admin boolean;
begin
  caller_is_admin := exists (
    select 1 from public.profiles p
    where p.id = auth.uid()
      and p.is_active = true
      and p.role = 'admin'
  );

  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id then
      raise exception 'لا يمكن تغيير معرّف الملف الشخصي';
    end if;
    if not caller_is_admin then
      new.role := old.role;
      new.is_active := old.is_active;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_protect_profile_columns on public.profiles;
create trigger trg_protect_profile_columns
  before update on public.profiles
  for each row execute function public.protect_profile_columns();

revoke all on function public.protect_profile_columns() from public;
revoke all on function public.protect_profile_columns() from anon;
revoke all on function public.protect_profile_columns() from authenticated;
-- =====================================================================
-- Audit: تنظيف details بقائمة مفاتيح مسموحة وقيم قياسية فقط
-- (يمنع تمرير أسرار متداخلة داخل JSON)
-- =====================================================================
create or replace function public.sanitize_audit_details(p_details jsonb)
returns jsonb
language plpgsql
immutable
security invoker
set search_path = public
as $$
declare
  allowed text[] := array[
    'id', 'platform_name', 'leader_name', 'file_name',
    'competition_id', 'honor_id', 'inserted', 'tables'
  ];
  result jsonb := '{}'::jsonb;
  k text;
  v jsonb;
  elem jsonb;
  arr jsonb;
  t text;
begin
  if p_details is null or jsonb_typeof(p_details) <> 'object' then
    return '{}'::jsonb;
  end if;

  foreach k in array allowed loop
    if not (p_details ? k) then
      continue;
    end if;
    v := p_details -> k;
    t := jsonb_typeof(v);

    if t in ('string', 'number', 'boolean', 'null') then
      if t = 'string' and length(v #>> '{}') > 500 then
        continue;
      end if;
      result := result || jsonb_build_object(k, v);
    elsif t = 'array' then
      arr := '[]'::jsonb;
      for elem in select value from jsonb_array_elements(v)
      loop
        if jsonb_typeof(elem) in ('string', 'number', 'boolean', 'null') then
          if jsonb_typeof(elem) = 'string' and length(elem #>> '{}') > 200 then
            continue;
          end if;
          arr := arr || jsonb_build_array(elem);
        end if;
        if jsonb_array_length(arr) >= 50 then
          exit;
        end if;
      end loop;
      result := result || jsonb_build_object(k, arr);
    end if;
    -- أي object متداخل أو نوع غير قياسي يُتجاهل عمداً
  end loop;

  return result;
end;
$$;

revoke all on function public.sanitize_audit_details(jsonb) from public;
revoke all on function public.sanitize_audit_details(jsonb) from anon;
grant execute on function public.sanitize_audit_details(jsonb) to authenticated;

-- =====================================================================
-- Audit RPC الآمن
-- =====================================================================
create or replace function public.write_audit_log(
  p_action text,
  p_entity_type text,
  p_entity_id uuid default null,
  p_details jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_details jsonb;
begin
  -- لا يمكن للعميل تمرير user_id أو created_at — يُفرضان هنا فقط
  if v_uid is null then
    raise exception 'غير مصرح';
  end if;

  if not public.is_profile_active() then
    raise exception 'الحساب غير نشط';
  end if;

  if p_action is null or length(trim(p_action)) = 0 or length(p_action) > 80 then
    raise exception 'إجراء غير صالح';
  end if;

  if p_entity_type is null or length(trim(p_entity_type)) = 0 or length(p_entity_type) > 80 then
    raise exception 'نوع كيان غير صالح';
  end if;

  v_details := public.sanitize_audit_details(p_details);

  insert into public.audit_logs (user_id, action, entity_type, entity_id, details, created_at)
  values (
    v_uid,
    trim(p_action),
    trim(p_entity_type),
    p_entity_id,
    v_details,
    timezone('utc', now())
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.write_audit_log(text, text, uuid, jsonb) from public;
revoke all on function public.write_audit_log(text, text, uuid, jsonb) from anon;
grant execute on function public.write_audit_log(text, text, uuid, jsonb) to authenticated;

-- =====================================================================
-- Enable RLS
-- =====================================================================
alter table public.profiles enable row level security;
alter table public.app_settings enable row level security;
alter table public.elementary_calendar enable row level security;
alter table public.upper_calendar enable row level security;
alter table public.classroom_programs enable row level security;
alter table public.extracurricular_programs enable row level security;
alter table public.schedules enable row level security;
alter table public.competitions enable row level security;
alter table public.competition_files enable row level security;
alter table public.honors enable row level security;
alter table public.honor_files enable row level security;
alter table public.gallery enable row level security;
alter table public.audit_logs enable row level security;

-- =====================================================================
-- RLS: profiles
-- SELECT: المستخدم يرى صفّه فقط؛ الإدمن يرى الجميع
-- UPDATE role/is_active/id محمي بـ protect_profile_columns + السياسات أدناه
-- =====================================================================
drop policy if exists profiles_select on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
drop policy if exists profiles_select_admin on public.profiles;
drop policy if exists profiles_update_self_name on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;
drop policy if exists profiles_insert_admin on public.profiles;
drop policy if exists profiles_delete_admin on public.profiles;

create policy profiles_select_own on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    and public.is_profile_active()
  );

create policy profiles_select_admin on public.profiles
  for select to authenticated
  using (public.is_admin());

-- المستخدم يعدّل صفّه فقط (الاسم عادةً)؛ role/is_active يُثبتان بالـ trigger لغير الإدمن
create policy profiles_update_self_name on public.profiles
  for update to authenticated
  using (id = auth.uid() and public.is_profile_active())
  with check (id = auth.uid() and public.is_profile_active());

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy profiles_insert_admin on public.profiles
  for insert to authenticated
  with check (public.is_admin());

create policy profiles_delete_admin on public.profiles
  for delete to authenticated
  using (public.is_admin());

-- =====================================================================
-- RLS: app_settings
-- لا SELECT لـ anon (تجنب كشف updated_by / updated_at للزائر)
-- القراءة: مستخدم نشط فقط | التعديل: admin فقط
-- لا INSERT/DELETE من العملاء (السجل يُنشأ عند bootstrap)
-- =====================================================================
drop policy if exists app_settings_select on public.app_settings;
drop policy if exists app_settings_select_anon on public.app_settings;
drop policy if exists app_settings_update_admin on public.app_settings;
drop policy if exists app_settings_insert_admin on public.app_settings;
drop policy if exists app_settings_delete_admin on public.app_settings;

create policy app_settings_select on public.app_settings
  for select to authenticated
  using (public.is_profile_active());

create policy app_settings_update_admin on public.app_settings
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- =====================================================================
-- RLS: جداول النشاط
-- =====================================================================
do $$
declare
  t text;
  data_tables text[] := array[
    'elementary_calendar', 'upper_calendar',
    'classroom_programs', 'extracurricular_programs',
    'schedules', 'competitions', 'competition_files',
    'honors', 'honor_files', 'gallery'
  ];
begin
  foreach t in array data_tables loop
    execute format('drop policy if exists %I on public.%I;', t || '_select', t);
    execute format('drop policy if exists %I on public.%I;', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I;', t || '_update', t);
    execute format('drop policy if exists %I on public.%I;', t || '_delete', t);

    execute format(
      'create policy %I on public.%I for select to authenticated
       using (public.is_profile_active());',
      t || '_select', t);

    execute format(
      'create policy %I on public.%I for insert to authenticated
       with check (public.is_editor());',
      t || '_insert', t);

    execute format(
      'create policy %I on public.%I for update to authenticated
       using (public.is_editor()) with check (public.is_editor());',
      t || '_update', t);

    execute format(
      'create policy %I on public.%I for delete to authenticated
       using (public.is_editor());',
      t || '_delete', t);
  end loop;
end $$;

-- =====================================================================
-- RLS: audit_logs — قراءة إدمن فقط؛ الكتابة عبر RPC فقط
-- =====================================================================
drop policy if exists audit_logs_select_admin on public.audit_logs;

create policy audit_logs_select_admin on public.audit_logs
  for select to authenticated
  using (public.is_admin());

-- لا سياسات INSERT/UPDATE/DELETE للمستخدمين

-- =====================================================================
-- Storage bucket (private)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'student-activity-files',
  'student-activity-files',
  false,
  10485760,
  -- Word / Excel / GIF مطلوبة لأقسام migrations/002_activity_sections.sql
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.is_allowed_storage_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    auth.uid() is not null
    and object_name is not null
    and object_name like (auth.uid()::text || '/%')
    and (
      object_name like (auth.uid()::text || '/gallery/%')
      or object_name like (auth.uid()::text || '/schedules/%')
      or object_name like (auth.uid()::text || '/competitions/%')
      or object_name like (auth.uid()::text || '/honors/%')
    );
$$;

revoke all on function public.is_allowed_storage_path(text) from public;
revoke all on function public.is_allowed_storage_path(text) from anon;
grant execute on function public.is_allowed_storage_path(text) to authenticated;

-- =====================================================================
-- Storage policies (bucket يبقى private — لا سياسات لـ anon/public)
-- SELECT: أي مستخدم نشط (viewer يمكنه Signed URL للعرض)
-- INSERT/UPDATE/DELETE: admin و activity_leader فقط — بدون USING/WITH CHECK (true)
-- =====================================================================
drop policy if exists sap_storage_select on storage.objects;
drop policy if exists sap_storage_insert on storage.objects;
drop policy if exists sap_storage_update on storage.objects;
drop policy if exists sap_storage_delete on storage.objects;

create policy sap_storage_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'student-activity-files'
    and public.is_profile_active()
  );

create policy sap_storage_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-activity-files'
    and public.is_editor()
    and public.is_allowed_storage_path(name)
  );

create policy sap_storage_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'student-activity-files'
    and public.is_editor()
  )
  with check (
    bucket_id = 'student-activity-files'
    and public.is_editor()
    and public.is_allowed_storage_path(name)
  );

create policy sap_storage_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'student-activity-files'
    and public.is_editor()
  );

-- =====================================================================
-- تعيين أول Admin (نفّذ يدوياً بعد إنشاء المستخدم في Auth)
-- =====================================================================
-- update public.profiles
-- set role = 'admin', is_active = true, full_name = 'مدير المنصة'
-- where id = 'YOUR-USER-UUID';
--
-- أو:
-- update public.profiles p
-- set role = 'admin', is_active = true
-- from auth.users u
-- where p.id = u.id and u.email = 'admin@example.com';

comment on function public.write_audit_log is
  'تسجيل تدقيق آمن: user_id من auth.uid() و created_at من الخادم فقط؛ details عبر sanitize_audit_details';
comment on function public.sanitize_audit_details is
  'يسمح فقط بمفاتيح allowlist وقيم قياسية/مصفوفات قياسية — يرفض الكائنات المتداخلة';
comment on function public.protect_profile_columns is
  'يمنع غير الإدمن من تغيير role أو is_active أو id';
comment on table public.audit_logs is
  'لا تسمح بـ INSERT/UPDATE/DELETE مباشر من الواجهة؛ استخدم write_audit_log فقط';
comment on table public.app_settings is
  'لا قراءة لـ anon؛ authenticated النشط يقرأ؛ admin يحدّث فقط';
