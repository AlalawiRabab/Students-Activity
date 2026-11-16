-- تصحيح بصمة parent_list_orphan_upload_paths لتستخدم دقائق (RPC أوضح)
drop function if exists public.parent_list_orphan_upload_paths(interval);
drop function if exists public.parent_list_orphan_upload_paths(integer);

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

revoke all on function public.parent_list_orphan_upload_paths(integer) from public, anon, authenticated;
grant execute on function public.parent_list_orphan_upload_paths(integer) to service_role;
