-- =====================================================================
-- Migration: الواجهة العامة + «بعيون أهالينا» + المسابقات العامة بالملفات
-- File: migrations/004_public_parents_competitions.sql
--
-- راجع ثم نفّذ يدوياً في Supabase SQL Editor بعد الموافقة.
-- لا يُنفَّذ تلقائياً من الواجهة أو CI.
--
-- مبادئ هذا الملف:
-- - إضافي وآمن لإعادة التشغيل: لا drop table ولا delete ولا truncate لبيانات قائمة.
-- - لا يغيّر جدول gallery ولا سياساته ولا ملفاته (معرض النشاط يبقى كما هو).
-- - لا يغيّر سياسات الأقسام الـ 12 ولا سياسات Storage الحالية؛ يضيف سياسات جديدة فقط.
-- - إدارة «بعيون أهالينا» والمسابقات عبر public.is_feature_manager(): حساب رائدة النشاط المعتمد
--   بمعرّفه في feature_managers فقط، لا أي حساب بدور admin. بقية المنصة تبقى على is_editor().
-- - المسابقات القائمة والجديدة غير منشورة افتراضياً حتى تختار رائدة النشاط نشرها.
-- - الزائر (anon) لا يملك أي صلاحية كتابة: مشاركات الأهالي تُنشأ عبر Edge Function
--   parent-submit بمفتاح service_role (سرّ خادم) وتمر بدالة create_parent_post فقط.
-- - المتطلب المسبق: database.sql منفّذ (001 و002 و003 غير مطلوبة لهذا الملف).
--
-- ما يضيفه:
--   1) get_public_settings(): اسم المنصة واسم رائدة النشاط للواجهة العامة فقط.
--   2) parent_events / parent_posts / parent_post_images / parent_submit_attempts + RLS.
--   3) bucket خاص parents-eyes: قراءة عامة للمشاركات المعتمدة وصورها فقط.
--   4) competitions.description + competitions.is_published، وتوسيع أنواع competition_files
--      (Word / PowerPoint / GIF)، وقراءة عامة للمسابقات المنشورة وملفاتها بأعمدة محددة.
-- =====================================================================

-- =====================================================================
-- 0) فحص مسبق
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
      missing := missing || format('function %s must return %s', fn.sig, fn.ret);
    elsif fn.must_definer is true and not (
      select p.prosecdef from pg_proc p where p.oid = to_regprocedure(fn.sig)
    ) then
      missing := missing || format('function %s must be SECURITY DEFINER', fn.sig);
    end if;
  end loop;

  if to_regclass('public.app_settings') is null then missing := missing || 'table public.app_settings'::text; end if;
  if to_regclass('public.competitions') is null then missing := missing || 'table public.competitions'::text; end if;
  if to_regclass('public.competition_files') is null then missing := missing || 'table public.competition_files'::text; end if;
  if to_regclass('storage.objects') is null then missing := missing || 'table storage.objects'::text; end if;
  if to_regclass('storage.buckets') is null then
    missing := missing || 'table storage.buckets'::text;
  elsif not exists (select 1 from storage.buckets where id = 'student-activity-files') then
    missing := missing || 'storage bucket student-activity-files'::text;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then missing := missing || 'role anon'::text; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then missing := missing || 'role authenticated'::text; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then missing := missing || 'role service_role'::text; end if;

  if array_length(missing, 1) > 0 then
    raise exception
      'migration 004 متوقف: متطلبات ناقصة — نفّذ database.sql أولاً. Missing: %',
      array_to_string(missing, '; ');
  end if;
end $$;

create extension if not exists "pgcrypto";

-- =====================================================================
-- 1) إعدادات الواجهة العامة (بدون فتح app_settings للزائر)
-- =====================================================================
create or replace function public.get_public_settings()
returns table (platform_name text, leader_name text)
language sql
stable
security definer
set search_path = public
as $$
  select s.platform_name, s.leader_name
  from public.app_settings s
  where s.id = 1;
$$;

revoke all on function public.get_public_settings() from public;
grant execute on function public.get_public_settings() to anon, authenticated;

comment on function public.get_public_settings() is
  'اسم المنصة واسم رائدة النشاط فقط للواجهة العامة؛ لا يكشف updated_by/updated_at';

-- =====================================================================
-- 1b) إدارة الميزات الجديدة محصورة بحساب رائدة النشاط المعتمد (بالمعرّف، لا بالاسم أو الدور)
--   الحساب المعتمد: 8fc5d107-2267-4ff1-9988-b5ead65a290d (حساب Eman من migrations/001).
--   أي حساب آخر بدور admin أو activity_leader لا يدير «بعيون أهالينا» ولا المسابقات.
--   لإضافة حساب لاحقاً (من SQL Editor فقط): insert into public.feature_managers (user_id) values ('<uuid>');
-- =====================================================================
create table if not exists public.feature_managers (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text,
  created_at timestamptz not null default timezone('utc', now())
);

alter table public.feature_managers enable row level security;
revoke all on table public.feature_managers from anon, authenticated;

do $$
begin
  if not exists (
    select 1 from public.profiles p
    where p.id = '8fc5d107-2267-4ff1-9988-b5ead65a290d'::uuid
      and p.is_active
      and p.role in ('admin', 'activity_leader')
  ) then
    raise exception
      'migration 004 متوقف: حساب رائدة النشاط 8fc5d107-2267-4ff1-9988-b5ead65a290d غير موجود أو غير نشط أو بلا صلاحية تحرير';
  end if;
  insert into public.feature_managers (user_id, note)
  values ('8fc5d107-2267-4ff1-9988-b5ead65a290d'::uuid, 'رائدة النشاط — الحساب المعتمد (Eman)')
  on conflict (user_id) do nothing;
end $$;

-- الهوية من auth.uid() (JWT موقّع يتحقق منه الخادم) + الحساب نشط وبدور تحرير
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
  );
$$;

revoke all on function public.is_feature_manager() from public, anon;
grant execute on function public.is_feature_manager() to authenticated;

-- =====================================================================
-- 2) «بعيون أهالينا» — الجداول
-- =====================================================================
create table if not exists public.parent_events (
  id uuid primary key default gen_random_uuid(),
  title text not null
    check (char_length(trim(title)) between 1 and 200),
  description text
    check (description is null or char_length(description) <= 4000),
  cover_path text unique,
  is_open boolean not null default false,
  created_by uuid default auth.uid() references auth.users (id) on delete set null,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now()),
  constraint parent_events_cover_path_format check (
    cover_path is null
    or (
      cover_path ~ '^events/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
      and split_part(cover_path, '/', 2) = id::text
    )
  )
);

comment on table public.parent_events is
  'مناسبات «بعيون أهالينا»: عامة للقراءة؛ الإضافة والتعديل وفتح/إغلاق الاستقبال لرائدة النشاط فقط';

create table if not exists public.parent_posts (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.parent_events (id) on delete restrict,
  author_name text
    check (author_name is null or char_length(trim(author_name)) between 1 and 80),
  comment text
    check (comment is null or char_length(comment) <= 2000),
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected')),
  consent boolean not null
    check (consent),
  submitted_at timestamptz not null default timezone('utc', now()),
  reviewed_at timestamptz,
  reviewed_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  content_hash text
    check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$'),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.parent_posts add column if not exists content_hash text
  check (content_hash is null or content_hash ~ '^[0-9a-f]{64}$');

comment on table public.parent_posts is
  'مشاركات أولياء الأمور: تُنشأ دائماً بحالة pending عبر create_parent_post؛ العامة ترى approved فقط';

-- CASCADE يحذف صفوف الصور فقط؛ الواجهة تحذف كائنات Storage أولاً
create table if not exists public.parent_post_images (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.parent_posts (id) on delete cascade,
  storage_path text not null unique,
  mime_type text not null
    check (mime_type in ('image/jpeg', 'image/png', 'image/webp')),
  file_size integer not null
    check (file_size > 0 and file_size <= 5242880),
  sort_order smallint not null default 0
    check (sort_order between 0 and 4),
  created_at timestamptz not null default timezone('utc', now()),
  constraint parent_post_images_path_format check (
    storage_path ~ '^posts/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
    and split_part(storage_path, '/', 2) = post_id::text
  )
);

-- سجل محاولات الإرسال (بصمة IP مُجزّأة فقط — بلا عنوان IP خام) — لا وصول للعميل
create table if not exists public.parent_submit_attempts (
  id bigint generated always as identity primary key,
  ip_hash text not null check (ip_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default timezone('utc', now())
);

create index if not exists idx_parent_events_created on public.parent_events (created_at desc);
create index if not exists idx_parent_posts_event_status on public.parent_posts (event_id, status, submitted_at desc);
create index if not exists idx_parent_posts_status on public.parent_posts (status, submitted_at desc);
create index if not exists idx_parent_post_images_post on public.parent_post_images (post_id, sort_order);
create index if not exists idx_parent_posts_content_hash on public.parent_posts (content_hash, submitted_at desc);
create index if not exists idx_parent_submit_attempts_ip on public.parent_submit_attempts (ip_hash, created_at desc);
create index if not exists idx_parent_submit_attempts_created on public.parent_submit_attempts (created_at);

-- =====================================================================
-- 3) المحفزات: updated_at + حماية الحالة والحقول
-- =====================================================================
drop trigger if exists trg_parent_events_updated_at on public.parent_events;
create trigger trg_parent_events_updated_at
  before update on public.parent_events
  for each row execute function public.set_updated_at();

drop trigger if exists trg_parent_posts_updated_at on public.parent_posts;
create trigger trg_parent_posts_updated_at
  before update on public.parent_posts
  for each row execute function public.set_updated_at();

create or replace function public.guard_parent_event()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.created_at := timezone('utc', now());
  else
    new.id := old.id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.title := trim(new.title);
  new.description := nullif(trim(coalesce(new.description, '')), '');
  return new;
end;
$$;

drop trigger if exists trg_guard_parent_event on public.parent_events;
create trigger trg_guard_parent_event
  before insert or update on public.parent_events
  for each row execute function public.guard_parent_event();

-- الإنشاء: الحالة دائماً pending بغض النظر عن المُرسَل، والمناسبة يجب أن تكون مفتوحة.
-- التعديل: المناسبة وتاريخ الإرسال والإقرار ثابتة؛ المراجِع ووقت المراجعة/النشر من الخادم.
create or replace function public.guard_parent_post()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_name := nullif(trim(coalesce(new.author_name, '')), '');
  new.comment := nullif(trim(coalesce(new.comment, '')), '');

  if tg_op = 'INSERT' then
    if not exists (
      select 1 from public.parent_events e where e.id = new.event_id and e.is_open
    ) then
      raise exception 'المناسبة غير مفتوحة لاستقبال المشاركات';
    end if;
    new.status := 'pending';
    new.submitted_at := timezone('utc', now());
    new.reviewed_at := null;
    new.reviewed_by := null;
    new.published_at := null;
    return new;
  end if;

  new.id := old.id;
  new.event_id := old.event_id;
  new.consent := old.consent;
  new.submitted_at := old.submitted_at;
  new.content_hash := old.content_hash;

  if new.status is distinct from old.status then
    new.reviewed_at := timezone('utc', now());
    new.reviewed_by := auth.uid();
    new.published_at := case when new.status = 'approved' then timezone('utc', now()) else null end;
  else
    new.reviewed_at := old.reviewed_at;
    new.reviewed_by := old.reviewed_by;
    new.published_at := old.published_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_parent_post on public.parent_posts;
create trigger trg_guard_parent_post
  before insert or update on public.parent_posts
  for each row execute function public.guard_parent_post();

create or replace function public.guard_parent_post_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'لا يمكن تعديل صورة مشاركة؛ احذفيها فقط';
  end if;
  if (select count(*) from public.parent_post_images i where i.post_id = new.post_id) >= 5 then
    raise exception 'الحد الأقصى 5 صور لكل مشاركة';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_parent_post_image on public.parent_post_images;
create trigger trg_guard_parent_post_image
  before insert or update on public.parent_post_images
  for each row execute function public.guard_parent_post_image();

revoke all on function public.guard_parent_event() from public, anon, authenticated;
revoke all on function public.guard_parent_post() from public, anon, authenticated;
revoke all on function public.guard_parent_post_image() from public, anon, authenticated;

-- =====================================================================
-- 4) دوال الخادم (service_role فقط — تستدعيها Edge Function parent-submit)
-- =====================================================================
-- حدود الإرسال طبقتان:
-- (أ) لكل بصمة IP مُجزّأة: 3 خلال 10 دقائق و12 خلال يوم.
-- (ب) حدود لا تعتمد على هوية المرسل إطلاقاً (تمنع الالتفاف بتغيير العنوان أو الترويسات):
--     150 محاولة في الساعة و600 في اليوم على مستوى المنصة، و300 مشاركة معلقة كحد أقصى
--     لكل مناسبة، ورفض المحتوى المكرر نفسه خلال 24 ساعة (في create_parent_post).
create or replace function public.parent_submit_throttle(p_ip_hash text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recent integer;
  v_day integer;
  v_global_hour integer;
  v_global_day integer;
begin
  if p_ip_hash is null or p_ip_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'بصمة غير صالحة';
  end if;

  -- قفل واحد للمنصة: يمنع تجاوز الحد الإجمالي بطلبات متزامنة
  perform pg_advisory_xact_lock(hashtextextended('parent_submit_throttle', 0));

  delete from public.parent_submit_attempts
  where created_at < timezone('utc', now()) - interval '2 days';

  select
    count(*) filter (where a.created_at > timezone('utc', now()) - interval '10 minutes'),
    count(*)
  into v_recent, v_day
  from public.parent_submit_attempts a
  where a.ip_hash = p_ip_hash
    and a.created_at > timezone('utc', now()) - interval '1 day';

  select
    count(*) filter (where a.created_at > timezone('utc', now()) - interval '1 hour'),
    count(*)
  into v_global_hour, v_global_day
  from public.parent_submit_attempts a
  where a.created_at > timezone('utc', now()) - interval '1 day';

  if v_recent >= 3 or v_day >= 12 or v_global_hour >= 150 or v_global_day >= 600 then
    return false;
  end if;

  insert into public.parent_submit_attempts (ip_hash) values (p_ip_hash);
  return true;
end;
$$;

-- إنشاء المشاركة وصورها في معاملة واحدة بعد رفع الصور إلى posts/<post_id>/...
-- أخطاء معرّفة يفهمها parent-submit: event_queue_full / duplicate_submission
drop function if exists public.create_parent_post(uuid, uuid, text, text, boolean, jsonb);
create or replace function public.create_parent_post(
  p_post_id uuid,
  p_event_id uuid,
  p_author_name text,
  p_comment text,
  p_consent boolean,
  p_images jsonb,
  p_content_hash text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_img jsonb;
  v_idx integer := 0;
  v_comment text := nullif(trim(coalesce(p_comment, '')), '');
  v_name text := nullif(trim(coalesce(p_author_name, '')), '');
begin
  if p_consent is not true then
    raise exception 'يلزم الإقرار بالموافقة على نشر الصور';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    raise exception 'قائمة صور غير صالحة';
  end if;
  if jsonb_array_length(p_images) > 5 then
    raise exception 'الحد الأقصى 5 صور لكل مشاركة';
  end if;
  if v_comment is null and jsonb_array_length(p_images) = 0 then
    raise exception 'أضف صورة أو تعليقاً على الأقل';
  end if;
  if v_name is not null and char_length(v_name) > 80 then
    raise exception 'الاسم أطول من المسموح';
  end if;
  if v_comment is not null and char_length(v_comment) > 2000 then
    raise exception 'التعليق أطول من المسموح';
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'بصمة محتوى غير صالحة';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_event_id::text, 1));

  if (
    select count(*) from public.parent_posts p
    where p.event_id = p_event_id and p.status = 'pending'
  ) >= 300 then
    raise exception 'event_queue_full';
  end if;

  if exists (
    select 1 from public.parent_posts p
    where p.content_hash = p_content_hash
      and p.submitted_at > timezone('utc', now()) - interval '24 hours'
  ) then
    raise exception 'duplicate_submission';
  end if;

  insert into public.parent_posts (id, event_id, author_name, comment, consent, content_hash)
  values (p_post_id, p_event_id, v_name, v_comment, true, p_content_hash);

  for v_img in select value from jsonb_array_elements(p_images)
  loop
    insert into public.parent_post_images (post_id, storage_path, mime_type, file_size, sort_order)
    values (
      p_post_id,
      v_img ->> 'path',
      v_img ->> 'mime',
      (v_img ->> 'size')::integer,
      v_idx
    );
    v_idx := v_idx + 1;
  end loop;

  return p_post_id;
end;
$$;

revoke all on function public.parent_submit_throttle(text) from public, anon, authenticated;
revoke all on function public.create_parent_post(uuid, uuid, text, text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.parent_submit_throttle(text) to service_role;
grant execute on function public.create_parent_post(uuid, uuid, text, text, boolean, jsonb, text) to service_role;

-- هل الكائن في bucket parents-eyes متاح للعامة؟ غلاف مناسبة، أو صورة مشاركة معتمدة فقط
create or replace function public.parents_eyes_object_is_public(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_name like 'events/%' then exists (
      select 1 from public.parent_events e where e.cover_path = p_name
    )
    when p_name like 'posts/%' then exists (
      select 1
      from public.parent_post_images i
      join public.parent_posts p on p.id = i.post_id
      where i.storage_path = p_name
        and p.status = 'approved'
    )
    else false
  end;
$$;

revoke all on function public.parents_eyes_object_is_public(text) from public;
grant execute on function public.parents_eyes_object_is_public(text) to anon, authenticated;

-- =====================================================================
-- 5) RLS و الصلاحيات — «بعيون أهالينا»
-- Supabase يمنح anon/authenticated كل الصلاحيات على جداول public افتراضياً؛
-- لذلك تُسحب أولاً ثم تُمنح أعمدة محددة فقط.
-- =====================================================================
alter table public.parent_events enable row level security;
alter table public.parent_posts enable row level security;
alter table public.parent_post_images enable row level security;
alter table public.parent_submit_attempts enable row level security;

revoke all on table public.parent_events from anon, authenticated;
revoke all on table public.parent_posts from anon, authenticated;
revoke all on table public.parent_post_images from anon, authenticated;
revoke all on table public.parent_submit_attempts from anon, authenticated;

grant select (id, title, description, cover_path, is_open, created_at)
  on public.parent_events to anon;
grant select (id, event_id, author_name, comment, status, published_at)
  on public.parent_posts to anon;
grant select (id, post_id, storage_path, mime_type, sort_order)
  on public.parent_post_images to anon;

grant select, insert, delete on table public.parent_events to authenticated;
grant update (title, description, cover_path, is_open) on public.parent_events to authenticated;
grant select, delete on table public.parent_posts to authenticated;
grant update (author_name, comment, status) on public.parent_posts to authenticated;
grant select, delete on table public.parent_post_images to authenticated;

-- parent_events: قراءة عامة، والإدارة لرائدة النشاط
drop policy if exists parent_events_select_public on public.parent_events;
drop policy if exists parent_events_insert on public.parent_events;
drop policy if exists parent_events_update on public.parent_events;
drop policy if exists parent_events_delete on public.parent_events;

create policy parent_events_select_public on public.parent_events
  for select to anon, authenticated
  using (true);

create policy parent_events_insert on public.parent_events
  for insert to authenticated
  with check (public.is_feature_manager());

create policy parent_events_update on public.parent_events
  for update to authenticated
  using (public.is_feature_manager())
  with check (public.is_feature_manager());

create policy parent_events_delete on public.parent_events
  for delete to authenticated
  using (public.is_feature_manager());

-- parent_posts: العامة ترى المعتمدة فقط؛ لا INSERT لأي عميل (Edge Function فقط)
drop policy if exists parent_posts_select_approved on public.parent_posts;
drop policy if exists parent_posts_select_editor on public.parent_posts;
drop policy if exists parent_posts_update on public.parent_posts;
drop policy if exists parent_posts_delete on public.parent_posts;

create policy parent_posts_select_approved on public.parent_posts
  for select to anon, authenticated
  using (status = 'approved');

create policy parent_posts_select_editor on public.parent_posts
  for select to authenticated
  using (public.is_feature_manager());

create policy parent_posts_update on public.parent_posts
  for update to authenticated
  using (public.is_feature_manager())
  with check (public.is_feature_manager());

create policy parent_posts_delete on public.parent_posts
  for delete to authenticated
  using (public.is_feature_manager());

-- parent_post_images: صور المشاركات المعتمدة فقط للعامة
drop policy if exists parent_post_images_select_approved on public.parent_post_images;
drop policy if exists parent_post_images_select_editor on public.parent_post_images;
drop policy if exists parent_post_images_delete on public.parent_post_images;

create policy parent_post_images_select_approved on public.parent_post_images
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.parent_posts p
      where p.id = post_id and p.status = 'approved'
    )
  );

create policy parent_post_images_select_editor on public.parent_post_images
  for select to authenticated
  using (public.is_feature_manager());

create policy parent_post_images_delete on public.parent_post_images
  for delete to authenticated
  using (public.is_feature_manager());

-- parent_submit_attempts: لا سياسات (لا وصول إلا عبر parent_submit_throttle)

-- =====================================================================
-- 6) Storage — bucket خاص parents-eyes (5 م.ب، صور فقط)
--   events/<event_id>/<uuid>.<ext> : أغلفة المناسبات (ترفعها رائدة النشاط)
--   posts/<post_id>/<uuid>.<ext>   : صور المشاركات (ترفعها Edge Function فقط)
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('parents-eyes', 'parents-eyes', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists pe_storage_public_read on storage.objects;
drop policy if exists pe_storage_editor_read on storage.objects;
drop policy if exists pe_storage_editor_insert on storage.objects;
drop policy if exists pe_storage_editor_delete on storage.objects;

create policy pe_storage_public_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'parents-eyes'
    and public.parents_eyes_object_is_public(name)
  );

create policy pe_storage_editor_read on storage.objects
  for select to authenticated
  using (bucket_id = 'parents-eyes' and public.is_feature_manager());

create policy pe_storage_editor_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'parents-eyes'
    and public.is_feature_manager()
    and name ~ '^events/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp)$'
  );

create policy pe_storage_editor_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'parents-eyes' and public.is_feature_manager());

-- لا سياسة UPDATE: لا نقل ولا كتابة فوق أي كائن في parents-eyes

-- =====================================================================
-- 7) المسابقات: رفع ملفات + عرض عام
-- =====================================================================
alter table public.competitions
  add column if not exists description text;
-- غير منشورة افتراضياً: كل المسابقات القائمة تبقى مخفية عن الزوار، وكذلك الجديدة حتى تُنشر صراحة
alter table public.competitions
  add column if not exists is_published boolean not null default false;
alter table public.competitions
  alter column is_published set default false;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'competitions_description_len'
      and conrelid = 'public.competitions'::regclass
  ) then
    alter table public.competitions
      add constraint competitions_description_len
      check (description is null or char_length(description) <= 2000);
  end if;
end $$;

-- توسيع أنواع ملفات المسابقات (القيود الجديدة أوسع من القديمة؛ كل الصفوف القائمة تطابقها)
do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.competition_files'::regclass
      and contype = 'c'
      and conname not in ('competition_files_file_type_v2', 'competition_files_mime_type_v2')
      and (
        pg_get_constraintdef(oid) ilike '%file_type%'
        or pg_get_constraintdef(oid) ilike '%mime_type%'
      )
  loop
    execute format('alter table public.competition_files drop constraint %I', c.conname);
  end loop;

  if not exists (
    select 1 from pg_constraint
    where conname = 'competition_files_file_type_v2'
      and conrelid = 'public.competition_files'::regclass
  ) then
    alter table public.competition_files
      add constraint competition_files_file_type_v2
      check (file_type in ('image', 'pdf', 'word', 'powerpoint'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'competition_files_mime_type_v2'
      and conrelid = 'public.competition_files'::regclass
  ) then
    alter table public.competition_files
      add constraint competition_files_mime_type_v2
      check (mime_type in (
        'image/jpeg', 'image/png', 'image/webp', 'image/gif',
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ));
  end if;
end $$;

create index if not exists idx_competition_files_path on public.competition_files (file_path);

-- إضافة أنواع PowerPoint إلى الـ bucket الحالي (دمج دون حذف أي نوع قائم)
update storage.buckets
set allowed_mime_types = (
  select array(
    select distinct m
    from unnest(
      allowed_mime_types || array[
        'application/vnd.ms-powerpoint',
        'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      ]
    ) as m
  )
)
where id = 'student-activity-files'
  and allowed_mime_types is not null;

create or replace function public.is_public_competition(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.competitions c where c.id = p_id and c.is_published
  );
$$;

create or replace function public.is_public_competition_file(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.competition_files f
    join public.competitions c on c.id = f.competition_id
    where f.file_path = p_name
      and c.is_published
  );
$$;

revoke all on function public.is_public_competition(uuid) from public;
revoke all on function public.is_public_competition_file(text) from public;
grant execute on function public.is_public_competition(uuid) to anon, authenticated;
grant execute on function public.is_public_competition_file(text) to anon, authenticated;

-- الزائر: أعمدة عامة فقط (لا أسماء طالبات ولا نتائج ولا ملاحظات ولا معرّف المنشئ)
revoke all on table public.competitions from anon;
revoke all on table public.competition_files from anon;
grant select (id, competition_name, description, competition_date, is_published, created_at)
  on public.competitions to anon;
grant select (id, competition_id, file_path, file_name, file_type, mime_type, file_size, created_at)
  on public.competition_files to anon;

drop policy if exists competitions_select_public on public.competitions;
create policy competitions_select_public on public.competitions
  for select to anon, authenticated
  using (is_published);

drop policy if exists competition_files_select_public on public.competition_files;
create policy competition_files_select_public on public.competition_files
  for select to anon, authenticated
  using (public.is_public_competition(competition_id));

-- قراءة عامة لكائنات ملفات المسابقات المنشورة فقط (بقية الـ bucket تبقى خاصة)
drop policy if exists sap_competition_files_public_read on storage.objects;
create policy sap_competition_files_public_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'student-activity-files'
    and name like '%/competitions/%'
    and public.is_public_competition_file(name)
  );

-- إدارة المسابقات (إضافة/تعديل/نشر/حذف) لحساب رائدة النشاط المعتمد فقط.
-- تستبدل سياسات الكتابة التي أنشأها database.sql لهذين الجدولين فقط (القراءة تبقى كما هي).
-- تنبيه: إعادة تشغيل database.sql لاحقاً تعيدها إلى is_editor()؛ أعد تشغيل 004 بعده.
drop policy if exists competitions_insert on public.competitions;
drop policy if exists competitions_update on public.competitions;
drop policy if exists competitions_delete on public.competitions;
drop policy if exists competition_files_insert on public.competition_files;
drop policy if exists competition_files_update on public.competition_files;
drop policy if exists competition_files_delete on public.competition_files;

create policy competitions_insert on public.competitions
  for insert to authenticated
  with check (public.is_feature_manager());
create policy competitions_update on public.competitions
  for update to authenticated
  using (public.is_feature_manager())
  with check (public.is_feature_manager());
create policy competitions_delete on public.competitions
  for delete to authenticated
  using (public.is_feature_manager());

create policy competition_files_insert on public.competition_files
  for insert to authenticated
  with check (public.is_feature_manager());
create policy competition_files_update on public.competition_files
  for update to authenticated
  using (public.is_feature_manager())
  with check (public.is_feature_manager());
create policy competition_files_delete on public.competition_files
  for delete to authenticated
  using (public.is_feature_manager());

-- سياسات RESTRICTIVE على كائنات ملفات المسابقات: تُضاف بـ AND إلى السياسات الحالية، فلا يرفع
-- أو يعدّل أو يحذف ملف مسابقة إلا الحساب المعتمد. لا أثر لها على أي مسار آخر (المعرض، الأقسام...).
drop policy if exists sap_competitions_storage_insert_guard on storage.objects;
drop policy if exists sap_competitions_storage_update_guard on storage.objects;
drop policy if exists sap_competitions_storage_delete_guard on storage.objects;

create policy sap_competitions_storage_insert_guard on storage.objects
  as restrictive
  for insert to authenticated
  with check (
    not (bucket_id = 'student-activity-files' and name like '%/competitions/%')
    or public.is_feature_manager()
  );
create policy sap_competitions_storage_update_guard on storage.objects
  as restrictive
  for update to authenticated
  using (
    not (bucket_id = 'student-activity-files' and name like '%/competitions/%')
    or public.is_feature_manager()
  )
  with check (
    not (bucket_id = 'student-activity-files' and name like '%/competitions/%')
    or public.is_feature_manager()
  );
create policy sap_competitions_storage_delete_guard on storage.objects
  as restrictive
  for delete to authenticated
  using (
    not (bucket_id = 'student-activity-files' and name like '%/competitions/%')
    or public.is_feature_manager()
  );

-- =====================================================================
-- 8) تحقق بعد التنفيذ (قراءة فقط)
-- =====================================================================
select id, public, file_size_limit, allowed_mime_types
from storage.buckets
where id in ('parents-eyes', 'student-activity-files');

select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
  and tablename in ('parent_events', 'parent_posts', 'parent_post_images', 'competitions', 'competition_files')
order by tablename, policyname;

select policyname, cmd, roles
from pg_policies
where schemaname = 'storage' and tablename = 'objects'
  and policyname in (
    'pe_storage_public_read', 'pe_storage_editor_read', 'pe_storage_editor_insert',
    'pe_storage_editor_delete', 'sap_competition_files_public_read',
    'sap_competitions_storage_insert_guard', 'sap_competitions_storage_update_guard',
    'sap_competitions_storage_delete_guard'
  )
order by policyname;

select m.user_id, p.username, p.role, p.is_active
from public.feature_managers m
join public.profiles p on p.id = m.user_id;
