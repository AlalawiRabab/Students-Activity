-- =====================================================================
-- 006 — تثبيت قراءة أغلفة المناسبات للعامة (صور المشاركات غير المعتمدة تبقى خاصة)
-- الاسم يبقى nullable في القاعدة للمشاركات القديمة؛ الإلزام في parent-submit فقط.
-- =====================================================================

create or replace function public.parents_eyes_object_is_public(p_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when p_name like 'events/%/%' then exists (
      select 1
      from public.parent_events e
      where e.cover_path = p_name
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
