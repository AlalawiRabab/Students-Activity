-- =====================================================================
-- Migration: مشاهدة عامة لكل المحتوى + وضع إدارة محمي برقم سري
-- File: migrations/005_public_view_admin_pin.sql
--
-- راجع ثم نفّذ يدوياً في Supabase SQL Editor بعد الموافقة (بعد 004).
-- لا يُنفَّذ تلقائياً من الواجهة أو CI.
--
-- مبادئ هذا الملف:
-- - إضافي وآمن لإعادة التشغيل: لا drop table ولا delete ولا truncate لبيانات قائمة.
-- - المشاهدة العامة (anon) لـ: الأقسام الـ 12 وملفاتها، معرض النشاط وصوره.
--   تبقى خاصة: المسابقات غير المنشورة، مشاركات الأهالي المعلقة والمرفوضة وصورها، الجداول القديمة
--   (التقويمات/البرامج/الجداول/التكريم السابق)، profiles، app_settings، audit_logs، وجداول هذا الملف.
-- - كل صلاحيات الكتابة (is_editor / is_admin / is_feature_manager) تشترط جلسة إدارة فُتحت
--   بالرقم السري عبر Edge Function admin-pin، ولم تنتهِ ولم يُخرج منها. جلسة كلمة المرور وحدها
--   لم تعد تكفي للإضافة أو التعديل أو الحذف أو النشر أو الاعتماد.
-- - الرقم السري لا يُخزَّن ولا يمر بقاعدة البيانات: تُخزَّن بصمة PBKDF2 فقط، ويتحقق منها الخادم.
-- - الكتابة على هذه الجداول لـ service_role فقط (Edge Function)؛ لا وصول لـ anon/authenticated.
--
-- تنبيه: إعادة تشغيل database.sql أو 004 لاحقاً تعيد تعريف دوال الصلاحيات دون شرط جلسة الإدارة
-- وتعيد إغلاق المشاهدة العامة؛ أعد تشغيل هذا الملف بعدها.
-- =====================================================================

-- =====================================================================
-- 0) فحص مسبق
-- =====================================================================
do $$
declare
  missing text[] := array[]::text[];
begin
  if to_regprocedure('public.is_feature_manager()') is null then missing := missing || 'function public.is_feature_manager() (migration 004)'::text; end if;
  if to_regprocedure('public.is_editor()') is null then missing := missing || 'function public.is_editor()'::text; end if;
  if to_regprocedure('public.is_admin()') is null then missing := missing || 'function public.is_admin()'::text; end if;
  if to_regprocedure('auth.uid()') is null then missing := missing || 'function auth.uid()'::text; end if;
  if to_regprocedure('auth.jwt()') is null then missing := missing || 'function auth.jwt()'::text; end if;
  if to_regclass('public.feature_managers') is null then missing := missing || 'table public.feature_managers (migration 004)'::text; end if;
  if to_regclass('public.section_files') is null then missing := missing || 'table public.section_files (migration 002)'::text; end if;
  if to_regclass('public.activity_sections') is null then missing := missing || 'table public.activity_sections (migration 002)'::text; end if;
  if to_regclass('public.activity_records') is null then missing := missing || 'table public.activity_records (migration 002)'::text; end if;
  if to_regclass('public.gallery') is null then missing := missing || 'table public.gallery'::text; end if;
  if to_regclass('auth.sessions') is null then missing := missing || 'table auth.sessions'::text; end if;
  if to_regclass('storage.objects') is null then missing := missing || 'table storage.objects'::text; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then missing := missing || 'role service_role'::text; end if;
  if not exists (select 1 from public.feature_managers) then missing := missing || 'لا يوجد حساب رائدة نشاط معتمد في feature_managers'::text; end if;

  if array_length(missing, 1) > 0 then
    raise exception 'migration 005 متوقف: متطلبات ناقصة. Missing: %', array_to_string(missing, '; ');
  end if;
end $$;

-- =====================================================================
-- 1) جداول وضع الإدارة (service_role فقط)
-- =====================================================================
-- صف واحد: بصمة الرقم السري والحساب الذي يفتحه (حساب رائدة النشاط المعتمد).
-- pin_hash فارغ حتى يُضبط الرقم أول مرة (tools/set-admin-pin.mjs).
create table if not exists public.admin_pin (
  id smallint primary key default 1 check (id = 1),
  user_id uuid not null references auth.users (id) on delete cascade,
  pin_hash text
    check (pin_hash is null or pin_hash ~ '^pbkdf2-sha256\$[0-9]{5,7}\$[A-Za-z0-9+/=]{16,64}\$[A-Za-z0-9+/=]{40,64}$'),
  updated_at timestamptz not null default now()
);

insert into public.admin_pin (id, user_id)
select 1, m.user_id
from public.feature_managers m
order by m.created_at
limit 1
on conflict (id) do nothing;

-- جلسات الإدارة المفتوحة بالرقم السري (معرّف جلسة Supabase Auth من الـ JWT)
create table if not exists public.admin_sessions (
  session_id uuid primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index if not exists idx_admin_sessions_expires on public.admin_sessions (expires_at);

-- أجهزة موثوقة: جهاز فُتح منه وضع الإدارة بالرقم الصحيح يحصل على رمز جهاز عشوائي (تُخزَّن بصمته فقط).
-- الرمز وحده لا يمنح شيئاً (الرقم السري مطلوب دائماً)، لكنه يُخرج الجهاز من الحد العام للأجهزة الجديدة،
-- فلا يستطيع زائر تعطيل دخول رائدة النشاط من أجهزتها باستنفاد المحاولات.
create table if not exists public.admin_trusted_devices (
  id bigint generated always as identity primary key,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- محاولات إدخال الرقم السري (بصمة IP مُجزّأة بملح، لا العنوان نفسه)
create table if not exists public.admin_pin_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  ok boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.admin_pin_attempts
  add column if not exists device_id bigint references public.admin_trusted_devices (id) on delete cascade;
create index if not exists idx_admin_pin_attempts_ip on public.admin_pin_attempts (ip_hash, created_at);
create index if not exists idx_admin_pin_attempts_created on public.admin_pin_attempts (created_at);
create index if not exists idx_admin_pin_attempts_device on public.admin_pin_attempts (device_id, created_at);

alter table public.admin_pin enable row level security;
alter table public.admin_sessions enable row level security;
alter table public.admin_pin_attempts enable row level security;
alter table public.admin_trusted_devices enable row level security;

revoke all on table public.admin_pin from public, anon, authenticated;
revoke all on table public.admin_sessions from public, anon, authenticated;
revoke all on table public.admin_pin_attempts from public, anon, authenticated;
revoke all on table public.admin_trusted_devices from public, anon, authenticated;
grant select, update on table public.admin_pin to service_role;
grant select, insert, update, delete on table public.admin_sessions to service_role;
grant select, insert, update, delete on table public.admin_pin_attempts to service_role;
grant select, insert, update, delete on table public.admin_trusted_devices to service_role;
-- لا سياسات RLS: لا يصل إليها أي عميل؛ service_role يتجاوز RLS

-- =====================================================================
-- 2) جلسة الإدارة صالحة؟ (هوية الجلسة من JWT موقّع يتحقق منه الخادم)
--   - session_id موجود في admin_sessions لنفس المستخدم، غير ملغاة ولم تنتهِ.
--   - والجلسة ما زالت قائمة في auth.sessions (الخروج من وضع الإدارة يحذفها فوراً).
-- =====================================================================
create or replace function public.admin_session_valid()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_sessions s
    join auth.sessions a on a.id = s.session_id
    where s.session_id = case
        when (auth.jwt() ->> 'session_id') ~ '^[0-9a-fA-F-]{36}$' then (auth.jwt() ->> 'session_id')::uuid
      end
      and s.user_id = auth.uid()
      and a.user_id = auth.uid()
      and s.revoked_at is null
      and s.expires_at > now()
      and (a.not_after is null or a.not_after > now())
  );
$$;

revoke all on function public.admin_session_valid() from public, anon;
grant execute on function public.admin_session_valid() to authenticated;

-- دوال الصلاحيات: نفس شروطها السابقة + جلسة إدارة صالحة
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
  ) and public.admin_session_valid();
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
  ) and public.admin_session_valid();
$$;

create or replace function public.is_feature_manager()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.feature_managers m
    join public.profiles p on p.id = m.user_id
    where m.user_id = auth.uid()
      and p.is_active
      and p.role in ('admin', 'activity_leader')
  ) and public.admin_session_valid();
$$;

revoke all on function public.is_editor() from public, anon;
revoke all on function public.is_admin() from public, anon;
revoke all on function public.is_feature_manager() from public, anon;
grant execute on function public.is_editor() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_feature_manager() to authenticated;

-- =====================================================================
-- 3) دوال Edge Function admin-pin (service_role فقط)
-- =====================================================================
-- حدود المحاولات (المحاولة تُسجَّل فاشلة مسبقاً ثم تُعلَّم ناجحة، فلا تتجاوزها الطلبات المتزامنة).
-- لا يوجد قفل عام يمنع رائدة النشاط من الدخول:
--   (أ) جهاز موثوق (سبق الدخول منه بالرقم الصحيح): حده الخاص فقط — 5 أخطاء / 15 دقيقة؛
--       ولا يتأثر بأخطاء غيره ولا بعنوان الشبكة المشترك (مثل شبكة المدرسة). 10 أخطاء خلال يوم تُلغي ثقته.
--   (ب) جهاز جديد: 5 أخطاء / 15 دقيقة لكل بصمة IP، وسقف إجمالي للأجهزة الجديدة فقط
--       (30 خطأ / ساعة و100 / يوم) يجعل التخمين الموزّع بطيئاً جداً، ولا يمس الأجهزة الموثوقة.
--   فك القفل للأجهزة الجديدة عند الحاجة: node tools/set-admin-pin.mjs --unlock (يتطلب دخول Supabase CLI).
drop function if exists public.admin_pin_begin(text);
create or replace function public.admin_pin_begin(p_ip_hash text, p_device_hash text default null)
returns table (status text, attempt_id bigint, trusted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_device bigint;
  v_count integer;
  v_hour integer;
  v_day integer;
  v_id bigint;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'بصمة غير صالحة';
  end if;
  if p_device_hash is not null and p_device_hash !~ '^[0-9a-f]{64}$' then
    p_device_hash := null;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('admin_pin_begin', 0));

  delete from public.admin_pin_attempts where created_at < now() - interval '2 days';
  delete from public.admin_sessions where expires_at < now() - interval '7 days';
  delete from public.admin_trusted_devices
  where (revoked_at is not null and revoked_at < now() - interval '30 days')
     or last_used_at < now() - interval '180 days';

  if p_device_hash is not null then
    select d.id into v_device
    from public.admin_trusted_devices d
    where d.token_hash = p_device_hash
      and d.revoked_at is null
      and d.last_used_at > now() - interval '90 days';
  end if;

  if v_device is not null then
    select count(*) into v_day
    from public.admin_pin_attempts a
    where a.device_id = v_device and not a.ok and a.created_at > now() - interval '1 day';
    if v_day >= 10 then
      update public.admin_trusted_devices set revoked_at = now() where id = v_device;
      v_device := null;
    end if;
  end if;

  if v_device is not null then
    select count(*) into v_count
    from public.admin_pin_attempts a
    where a.device_id = v_device and not a.ok and a.created_at > now() - interval '15 minutes';
    if v_count >= 5 then
      return query select 'locked_device'::text, null::bigint, true;
      return;
    end if;
    insert into public.admin_pin_attempts (ip_hash, device_id, ok) values (p_ip_hash, v_device, false) returning id into v_id;
    return query select 'ok'::text, v_id, true;
    return;
  end if;

  select count(*) into v_count
  from public.admin_pin_attempts a
  where a.ip_hash = p_ip_hash and a.device_id is null and not a.ok
    and a.created_at > now() - interval '15 minutes';
  if v_count >= 5 then
    return query select 'locked_ip'::text, null::bigint, false;
    return;
  end if;

  select
    count(*) filter (where a.created_at > now() - interval '1 hour'),
    count(*)
  into v_hour, v_day
  from public.admin_pin_attempts a
  where a.device_id is null and not a.ok and a.created_at > now() - interval '1 day';
  if v_hour >= 30 or v_day >= 100 then
    return query select 'locked_new_devices'::text, null::bigint, false;
    return;
  end if;

  insert into public.admin_pin_attempts (ip_hash, ok) values (p_ip_hash, false) returning id into v_id;
  return query select 'ok'::text, v_id, false;
end;
$$;

-- نجاح المحاولة: تُعلَّم ناجحة وتُصفَّر أخطاء الجهاز (أو بصمة IP للجهاز الجديد) الأخيرة
create or replace function public.admin_pin_succeed(p_attempt_id bigint)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text;
  v_device bigint;
begin
  update public.admin_pin_attempts set ok = true where id = p_attempt_id
  returning ip_hash, device_id into v_hash, v_device;
  if v_device is not null then
    update public.admin_trusted_devices set last_used_at = now() where id = v_device;
    delete from public.admin_pin_attempts
    where device_id = v_device and not ok and created_at > now() - interval '1 day';
  elsif v_hash is not null then
    delete from public.admin_pin_attempts
    where ip_hash = v_hash and device_id is null and not ok and created_at > now() - interval '15 minutes';
  end if;
end;
$$;

-- تسجيل جهاز موثوق بعد دخول ناجح (يُبقي أحدث 10 أجهزة فعّالة)
create or replace function public.admin_device_register(p_token_hash text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'بصمة جهاز غير صالحة';
  end if;
  insert into public.admin_trusted_devices (token_hash) values (p_token_hash)
  on conflict (token_hash) do update set last_used_at = now(), revoked_at = null;
  update public.admin_trusted_devices set revoked_at = now()
  where revoked_at is null
    and id not in (
      select id from public.admin_trusted_devices
      where revoked_at is null order by last_used_at desc limit 10
    );
end;
$$;

-- عند تغيير الرقم السري: إلغاء ثقة كل الأجهزة عدا الجهاز الحالي
create or replace function public.admin_revoke_devices_except(p_keep_hash text)
returns void
language sql
security definer
set search_path = public
as $$
  update public.admin_trusted_devices set revoked_at = now()
  where revoked_at is null and token_hash is distinct from p_keep_hash;
$$;

-- محاولة لم تُفحص (مثلاً الرقم السري غير مضبوط بعد): لا تُحتسب
create or replace function public.admin_pin_cancel(p_attempt_id bigint)
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.admin_pin_attempts where id = p_attempt_id and not ok;
$$;

create or replace function public.admin_pin_register_session(p_session_id uuid, p_user_id uuid, p_hours integer)
returns timestamptz
language plpgsql
security definer
set search_path = public
as $$
declare
  v_until timestamptz;
begin
  if p_session_id is null or p_user_id is null then
    raise exception 'جلسة غير صالحة';
  end if;
  if not exists (select 1 from public.feature_managers m where m.user_id = p_user_id) then
    raise exception 'الحساب غير معتمد لإدارة المنصة';
  end if;
  v_until := now() + make_interval(hours => greatest(1, least(coalesce(p_hours, 8), 24)));
  insert into public.admin_sessions (session_id, user_id, expires_at)
  values (p_session_id, p_user_id, v_until)
  on conflict (session_id) do update
    set user_id = excluded.user_id, expires_at = excluded.expires_at, revoked_at = null;
  return v_until;
end;
$$;

-- عند تغيير الرقم السري: إنهاء كل جلسات الإدارة القائمة
create or replace function public.admin_revoke_all_sessions()
returns integer
language sql
security definer
set search_path = public
as $$
  with r as (
    update public.admin_sessions set revoked_at = now()
    where revoked_at is null
    returning 1
  )
  select count(*)::integer from r;
$$;

revoke all on function public.admin_pin_begin(text, text) from public, anon, authenticated;
revoke all on function public.admin_pin_succeed(bigint) from public, anon, authenticated;
revoke all on function public.admin_pin_cancel(bigint) from public, anon, authenticated;
revoke all on function public.admin_pin_register_session(uuid, uuid, integer) from public, anon, authenticated;
revoke all on function public.admin_revoke_all_sessions() from public, anon, authenticated;
revoke all on function public.admin_device_register(text) from public, anon, authenticated;
revoke all on function public.admin_revoke_devices_except(text) from public, anon, authenticated;
grant execute on function public.admin_pin_begin(text, text) to service_role;
grant execute on function public.admin_pin_succeed(bigint) to service_role;
grant execute on function public.admin_pin_cancel(bigint) to service_role;
grant execute on function public.admin_pin_register_session(uuid, uuid, integer) to service_role;
grant execute on function public.admin_revoke_all_sessions() to service_role;
grant execute on function public.admin_device_register(text) to service_role;
grant execute on function public.admin_revoke_devices_except(text) to service_role;

-- =====================================================================
-- 4) المشاهدة العامة: الأقسام الـ 12 وملفاتها
-- =====================================================================
revoke all on table public.activity_sections from anon;
grant select on table public.activity_sections to anon;
drop policy if exists activity_sections_select_public on public.activity_sections;
create policy activity_sections_select_public on public.activity_sections
  for select to anon, authenticated
  using (true);

-- ملفات الأقسام: أعمدة العرض فقط (دون created_by / updated_by)
revoke all on table public.section_files from anon;
grant select (
  id, section_key, sub_key, record_id, category, storage_path, original_name,
  mime_type, file_kind, file_size, title, description, created_at, updated_at
) on public.section_files to anon;
drop policy if exists section_files_select_public on public.section_files;
create policy section_files_select_public on public.section_files
  for select to anon, authenticated
  using (true);

-- السجلات القديمة: العنوان فقط (للإشارة إلى أصل المرفق في القسم)
revoke all on table public.activity_records from anon;
grant select (id, section_key, title) on public.activity_records to anon;
drop policy if exists activity_records_select_public on public.activity_records;
create policy activity_records_select_public on public.activity_records
  for select to anon, authenticated
  using (true);

grant execute on function public.section_file_counts() to anon;

-- =====================================================================
-- 5) المشاهدة العامة: معرض النشاط (الجدول والصفحة والتصميم دون تغيير)
-- =====================================================================
revoke all on table public.gallery from anon;
grant select on table public.gallery to anon;
drop policy if exists gallery_select_public on public.gallery;
create policy gallery_select_public on public.gallery
  for select to anon, authenticated
  using (true);

-- =====================================================================
-- 6) Storage: قراءة عامة لكائنات الأقسام والمعرض المسجلة فقط
--   (كائن بلا صف بيانات وصفية لا يُكشف؛ المسابقات وبقية المسارات بسياساتها الحالية)
-- =====================================================================
create or replace function public.is_public_content_object(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_name like 'sections/%' then
      exists (select 1 from public.section_files f where f.storage_path = p_name)
    when p_name ~ '^[0-9a-fA-F-]{36}/gallery/' then
      exists (select 1 from public.gallery g where g.image_path = p_name)
    else false
  end;
$$;

revoke all on function public.is_public_content_object(text) from public;
grant execute on function public.is_public_content_object(text) to anon, authenticated;

drop policy if exists sap_public_content_read on storage.objects;
create policy sap_public_content_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'student-activity-files'
    and public.is_public_content_object(name)
  );

-- =====================================================================
-- 7) تحقق بعد التنفيذ (قراءة فقط)
-- =====================================================================
select id, user_id, (pin_hash is not null) as pin_configured, updated_at
from public.admin_pin;

select tablename, policyname, cmd, roles
from pg_policies
where (schemaname = 'public' and policyname in (
        'activity_sections_select_public', 'section_files_select_public',
        'activity_records_select_public', 'gallery_select_public'))
   or (schemaname = 'storage' and policyname = 'sap_public_content_read')
order by tablename, policyname;
