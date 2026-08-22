-- =====================================================================
-- Migration: username login support
-- File: migrations/001_add_username_login.sql
--
-- راجع ثم نفّذ يدوياً في Supabase SQL Editor بعد الموافقة.
-- لا يُنفَّذ تلقائياً من الواجهة أو CI.
-- =====================================================================

-- 1) عمود username (nullable أولاً لعدم كسر الحسابات الحالية)
alter table public.profiles
  add column if not exists username text;

comment on column public.profiles.username is
  'اسم مستخدم فريد لتسجيل الدخول (بدون كلمة مرور). الحساسية غير مميزة عبر فهرس lower().';

-- 2) تنسيق الاسم: أحرف/أرقام/_ . - وطول 3–32
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'profiles_username_format'
      and conrelid = 'public.profiles'::regclass
  ) then
    alter table public.profiles
      add constraint profiles_username_format
      check (
        username is null
        or username ~ '^[A-Za-z0-9._-]{3,32}$'
      );
  end if;
end $$;

-- 3) فرادة غير حسّاسة لحالة الأحرف (Eman و eman و EMAN ممنوعون معاً)
create unique index if not exists profiles_username_lower_uidx
  on public.profiles (lower(username))
  where username is not null;

-- 4) حماية عمود username: غير الإدمن لا يغيّره
--    ملاحظة: من SQL Editor غالباً auth.uid() = NULL → caller_is_admin = false
--    لذلك إسناد bootstrap لـ Eman يتم في القسم 7 بتعطيل الـ trigger مؤقتاً فقط.
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
      new.username := old.username;
    end if;
  end if;

  return new;
end;
$$;

-- 5) عند إنشاء مستخدم Auth جديد: يمكن تمرير username في user_metadata
--    وإلا يبقى NULL حتى يعيّنه الإدمن بـ SQL/Dashboard
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_username text;
begin
  v_username := nullif(trim(new.raw_user_meta_data ->> 'username'), '');
  if v_username is not null and v_username !~ '^[A-Za-z0-9._-]{3,32}$' then
    v_username := null;
  end if;

  insert into public.profiles (id, full_name, role, is_active, username)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), 'مستخدم جديد'),
    'viewer',
    true,
    v_username
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- 6) بحث آمن عن المستخدم باسم الدخول — للاستخدام من Edge Function (service_role) فقط
--    لا يُرجع بريداً ولا يُمنح لـ anon/authenticated
create or replace function public.get_profile_for_username_login(p_username text)
returns table (id uuid, is_active boolean)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.is_active
  from public.profiles p
  where p.username is not null
    and lower(p.username) = lower(trim(p_username))
  limit 1;
$$;

revoke all on function public.get_profile_for_username_login(text) from public;
revoke all on function public.get_profile_for_username_login(text) from anon;
revoke all on function public.get_profile_for_username_login(text) from authenticated;
grant execute on function public.get_profile_for_username_login(text) to service_role;

-- =====================================================================
-- 7) Bootstrap آمن: username = 'Eman' للحساب الإداري الحالي
-- لا يغيّر البريد ولا كلمة المرور ولا role/is_active.
-- يعطّل trg_protect_profile_columns داخل هذه الكتلة فقط ثم يعيده فوراً،
-- لأن SQL Editor لا يملك auth.uid() فيُعاد username للقيمة القديمة بدون ذلك.
-- لا يضعف الدالة نفسها ولا يفتح صلاحيات anon/RLS.
-- =====================================================================
do $$
declare
  had_trigger boolean;
  updated_count integer;
begin
  select exists (
    select 1
    from pg_trigger t
    where t.tgname = 'trg_protect_profile_columns'
      and t.tgrelid = 'public.profiles'::regclass
      and not t.tgisinternal
  ) into had_trigger;

  if had_trigger then
    execute 'alter table public.profiles disable trigger trg_protect_profile_columns';
  end if;

  begin
    update public.profiles
    set username = 'Eman'
    where id = '8fc5d107-2267-4ff1-9988-b5ead65a290d'::uuid
      and role = 'admin'
      and is_active = true;

    get diagnostics updated_count = row_count;

    if updated_count <> 1 then
      raise exception
        'bootstrap username failed: expected 1 active admin row for UUID 8fc5d107-2267-4ff1-9988-b5ead65a290d, got %',
        updated_count;
    end if;
  exception
    when others then
      if had_trigger then
        execute 'alter table public.profiles enable trigger trg_protect_profile_columns';
      end if;
      raise;
  end;

  if had_trigger then
    execute 'alter table public.profiles enable trigger trg_protect_profile_columns';
  end if;
end $$;

-- 8) تحقق بعد التعيين (النتيجة المتوقعة: username=Eman, role=admin, is_active=true)
select id, username, role, is_active
from public.profiles
where id = '8fc5d107-2267-4ff1-9988-b5ead65a290d'::uuid;

-- =====================================================================
-- ملاحظات أمنية (لا تغيّر سياسات SELECT لـ anon)
-- =====================================================================
-- - لا تمنح anon SELECT على profiles.
-- - تحويل username→email يتم داخل Edge Function فقط (service role كسرّ خادم).
-- - لا توجد RPC عامة تعيد email أو قائمة مستخدمين للعميل.
-- - الفهرس profiles_username_lower_uidx يمنع Eman/eman/EMAN كحسابات منفصلة.
