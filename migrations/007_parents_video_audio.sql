-- =====================================================================
-- 007 — فيديو وصوت في مشاركات «بعيون أهالينا»
-- يحافظ على خصوصية المرفقات: العامة ترى المعتمد فقط عبر parents_eyes_object_is_public
-- الاسم يبقى nullable للمشاركات القديمة؛ الإلزام في parent-submit
-- =====================================================================

-- توسيع قيود صفوف المرفقات (الصور + فيديو واحد + صوت واحد)
alter table public.parent_post_images
  drop constraint if exists parent_post_images_mime_type_check;
alter table public.parent_post_images
  drop constraint if exists parent_post_images_file_size_check;
alter table public.parent_post_images
  drop constraint if exists parent_post_images_sort_order_check;
alter table public.parent_post_images
  drop constraint if exists parent_post_images_path_format;

-- أوقف المحفّز أثناء تعبئة kind (المحفّز القديم يرفض أي UPDATE)
drop trigger if exists trg_guard_parent_post_image on public.parent_post_images;

alter table public.parent_post_images
  add column if not exists kind text;

update public.parent_post_images
set kind = 'image'
where kind is null;

alter table public.parent_post_images
  alter column kind set default 'image';

alter table public.parent_post_images
  alter column kind set not null;

alter table public.parent_post_images
  drop constraint if exists parent_post_images_kind_check;
alter table public.parent_post_images
  add constraint parent_post_images_kind_check
  check (kind in ('image', 'video', 'audio'));

alter table public.parent_post_images
  add constraint parent_post_images_mime_type_check
  check (mime_type in (
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav',
    'audio/webm', 'audio/ogg', 'audio/x-m4a'
  ));

alter table public.parent_post_images
  add constraint parent_post_images_file_size_check
  check (
    file_size > 0
    and (
      (kind = 'image' and file_size <= 5242880)
      or (kind = 'video' and file_size <= 52428800)
      or (kind = 'audio' and file_size <= 15728640)
    )
  );

alter table public.parent_post_images
  add constraint parent_post_images_sort_order_check
  check (sort_order between 0 and 6);

alter table public.parent_post_images
  add constraint parent_post_images_path_format
  check (
    storage_path ~ '^posts/[0-9a-f-]{36}/[0-9a-f-]{36}\.(jpg|png|webp|mp4|mov|webm|m4a|mp3|aac|wav|ogg)$'
    and split_part(storage_path, '/', 2) = post_id::text
  );

comment on table public.parent_post_images is
  'مرفقات مشاركات الأهالي (صور/فيديو/صوت). العامة ترى صفوف المشاركات المعتمدة فقط';

create or replace function public.guard_parent_post_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_images integer;
  v_videos integer;
  v_audios integer;
begin
  if tg_op = 'UPDATE' then
    raise exception 'لا يمكن تعديل مرفق مشاركة؛ احذفيه فقط';
  end if;

  select
    count(*) filter (where i.kind = 'image'),
    count(*) filter (where i.kind = 'video'),
    count(*) filter (where i.kind = 'audio')
  into v_images, v_videos, v_audios
  from public.parent_post_images i
  where i.post_id = new.post_id;

  if new.kind = 'image' and v_images >= 5 then
    raise exception 'الحد الأقصى 5 صور لكل مشاركة';
  end if;
  if new.kind = 'video' and v_videos >= 1 then
    raise exception 'الحد الأقصى فيديو واحد لكل مشاركة';
  end if;
  if new.kind = 'audio' and v_audios >= 1 then
    raise exception 'الحد الأقصى ملف صوتي واحد لكل مشاركة';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_parent_post_image on public.parent_post_images;
create trigger trg_guard_parent_post_image
  before insert or update on public.parent_post_images
  for each row execute function public.guard_parent_post_image();

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
  v_kind text;
  v_images integer := 0;
  v_videos integer := 0;
  v_audios integer := 0;
begin
  if p_consent is not true then
    raise exception 'يلزم الإقرار بالموافقة على نشر المرفقات';
  end if;
  if v_name is null then
    raise exception 'name_required';
  end if;
  if p_images is null or jsonb_typeof(p_images) <> 'array' then
    raise exception 'قائمة مرفقات غير صالحة';
  end if;
  if jsonb_array_length(p_images) > 7 then
    raise exception 'عدد المرفقات يتجاوز الحد المسموح';
  end if;
  if v_comment is null and jsonb_array_length(p_images) = 0 then
    raise exception 'أضف تعليقاً أو مرفقاً على الأقل';
  end if;
  if char_length(v_name) > 80 then
    raise exception 'الاسم أطول من المسموح';
  end if;
  if v_comment is not null and char_length(v_comment) > 2000 then
    raise exception 'التعليق أطول من المسموح';
  end if;
  if p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'بصمة محتوى غير صالحة';
  end if;

  for v_img in select value from jsonb_array_elements(p_images)
  loop
    v_kind := coalesce(v_img ->> 'kind', 'image');
    if v_kind = 'image' then v_images := v_images + 1;
    elsif v_kind = 'video' then v_videos := v_videos + 1;
    elsif v_kind = 'audio' then v_audios := v_audios + 1;
    else raise exception 'نوع مرفق غير صالح';
    end if;
  end loop;
  if v_images > 5 then raise exception 'الحد الأقصى 5 صور لكل مشاركة'; end if;
  if v_videos > 1 then raise exception 'الحد الأقصى فيديو واحد لكل مشاركة'; end if;
  if v_audios > 1 then raise exception 'الحد الأقصى ملف صوتي واحد لكل مشاركة'; end if;

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
    insert into public.parent_post_images (post_id, storage_path, mime_type, file_size, sort_order, kind)
    values (
      p_post_id,
      v_img ->> 'path',
      v_img ->> 'mime',
      (v_img ->> 'size')::integer,
      v_idx,
      coalesce(v_img ->> 'kind', 'image')
    );
    v_idx := v_idx + 1;
  end loop;

  return p_post_id;
end;
$$;

revoke all on function public.create_parent_post(uuid, uuid, text, text, boolean, jsonb, text) from public, anon, authenticated;
grant execute on function public.create_parent_post(uuid, uuid, text, text, boolean, jsonb, text) to service_role;

-- تخزين خاص: رفع الحد للسماح بالفيديو مع الإبقاء على bucket غير عام
update storage.buckets
set
  file_size_limit = 52428800,
  allowed_mime_types = array[
    'image/jpeg', 'image/png', 'image/webp',
    'video/mp4', 'video/quicktime', 'video/webm',
    'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/wav', 'audio/x-wav',
    'audio/webm', 'audio/ogg', 'audio/x-m4a'
  ]
where id = 'parents-eyes';

-- إعادة تثبيت قراءة العامة للمعتمد فقط (صور/فيديو/صوت)
create or replace function public.parents_eyes_object_is_public(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_name like 'events/%/%' then exists (
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

drop policy if exists pe_storage_public_read on storage.objects;
create policy pe_storage_public_read on storage.objects
  for select
  to anon, authenticated
  using (
    bucket_id = 'parents-eyes'
    and public.parents_eyes_object_is_public(name)
  );

-- =====================================================================
-- نوايا الرفع الكبير (Signed Upload) + تنظيف المؤقت غير المربوط
-- لا تُحذف مرفقات مشاركات محفوظة؛ ولا نوايا أحدث من المهلة (رفع جارٍ)
-- =====================================================================
create table if not exists public.parent_upload_intents (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null,
  storage_path text not null,
  kind text not null,
  expected_size bigint not null,
  expected_ext text not null,
  created_at timestamptz not null default timezone('utc', now()),
  consumed_at timestamptz,
  constraint parent_upload_intents_kind_check check (kind in ('video', 'audio')),
  constraint parent_upload_intents_size_check check (expected_size > 0 and expected_size <= 52428800),
  constraint parent_upload_intents_path_unique unique (storage_path),
  constraint parent_upload_intents_path_format check (
    storage_path ~ ('^posts/' || post_id::text || '/[0-9a-f-]{36}\.(mp4|mov|webm|m4a|mp3|aac|wav|ogg)$')
  )
);

create index if not exists idx_parent_upload_intents_created
  on public.parent_upload_intents (created_at)
  where consumed_at is null;

create index if not exists idx_parent_upload_intents_post
  on public.parent_upload_intents (post_id);

alter table public.parent_upload_intents enable row level security;
revoke all on table public.parent_upload_intents from public, anon, authenticated;
grant select, insert, update, delete on table public.parent_upload_intents to service_role;

comment on table public.parent_upload_intents is
  'نوايا رفع فيديو/صوت عبر Signed Upload قبل ربطها بمشاركة؛ تُستهلك عند finalize أو تُنظَّف بعد المهلة';

create or replace function public.parent_register_upload_intents(
  p_post_id uuid,
  p_intents jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
begin
  if p_post_id is null then
    raise exception 'post_id مطلوب';
  end if;
  if p_intents is null or jsonb_typeof(p_intents) <> 'array' or jsonb_array_length(p_intents) = 0 then
    raise exception 'قائمة نوايا غير صالحة';
  end if;
  if jsonb_array_length(p_intents) > 2 then
    raise exception 'عدد النوايا يتجاوز الحد';
  end if;

  for v_item in select value from jsonb_array_elements(p_intents)
  loop
    insert into public.parent_upload_intents (
      post_id, storage_path, kind, expected_size, expected_ext
    ) values (
      p_post_id,
      v_item ->> 'path',
      v_item ->> 'kind',
      (v_item ->> 'size')::bigint,
      lower(v_item ->> 'ext')
    );
  end loop;
end;
$$;

create or replace function public.parent_get_upload_intents(p_post_id uuid)
returns table (
  storage_path text,
  kind text,
  expected_size bigint,
  expected_ext text,
  created_at timestamptz,
  consumed_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select i.storage_path, i.kind, i.expected_size, i.expected_ext, i.created_at, i.consumed_at
  from public.parent_upload_intents i
  where i.post_id = p_post_id
  order by i.created_at;
$$;

create or replace function public.parent_consume_upload_intents(
  p_post_id uuid,
  p_paths text[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.parent_upload_intents
  set consumed_at = timezone('utc', now())
  where post_id = p_post_id
    and consumed_at is null
    and storage_path = any (p_paths);
end;
$$;

-- مسارات مؤقتة مرشّحة للحذف: نية غير مستهلكة أقدم من المهلة وغير مربوطة بصف مرفق
-- الدقائق كعدد صحيح لأن استدعاء RPC من Edge أوضح من تمرير interval
create or replace function public.parent_list_orphan_upload_paths(
  p_max_age_minutes integer default 120
)
returns table (storage_path text)
language sql
stable
security definer
set search_path = public
as $$
  select i.storage_path
  from public.parent_upload_intents i
  where i.consumed_at is null
    and i.created_at < timezone('utc', now()) - make_interval(mins => greatest(p_max_age_minutes, 1))
    and not exists (
      select 1 from public.parent_post_images ppi
      where ppi.storage_path = i.storage_path
    );
$$;

create or replace function public.parent_delete_upload_intents(p_paths text[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_paths is null or cardinality(p_paths) = 0 then
    return 0;
  end if;
  delete from public.parent_upload_intents i
  where i.storage_path = any (p_paths)
    and i.consumed_at is null
    and not exists (
      select 1 from public.parent_post_images ppi
      where ppi.storage_path = i.storage_path
    );
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.parent_register_upload_intents(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.parent_get_upload_intents(uuid) from public, anon, authenticated;
revoke all on function public.parent_consume_upload_intents(uuid, text[]) from public, anon, authenticated;
drop function if exists public.parent_list_orphan_upload_paths(interval);
revoke all on function public.parent_list_orphan_upload_paths(integer) from public, anon, authenticated;
revoke all on function public.parent_delete_upload_intents(text[]) from public, anon, authenticated;

grant execute on function public.parent_register_upload_intents(uuid, jsonb) to service_role;
grant execute on function public.parent_get_upload_intents(uuid) to service_role;
grant execute on function public.parent_consume_upload_intents(uuid, text[]) to service_role;
grant execute on function public.parent_list_orphan_upload_paths(integer) to service_role;
grant execute on function public.parent_delete_upload_intents(text[]) to service_role;
