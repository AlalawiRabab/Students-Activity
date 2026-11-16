-- 1) اجمع مسارات الاختبار ثم احذف صفوف المشاركة فقط (التخزين عبر Edge لاحقًا)
create temporary table if not exists _pe_test_cleanup_paths (storage_path text primary key) on commit drop;

insert into _pe_test_cleanup_paths (storage_path)
select storage_path from public.parent_post_images
where post_id = '5f3f52e5-0a04-44c2-886b-80b7fa2b286e'
on conflict do nothing;

insert into _pe_test_cleanup_paths (storage_path) values
  ('posts/5f3f52e5-0a04-44c2-886b-80b7fa2b286e/fdb6bd21-bde5-4a46-b625-77547b03a85b.mp4'),
  ('posts/5f3f52e5-0a04-44c2-886b-80b7fa2b286e/8daeff8b-dc71-475f-820b-a8c34b954f62.wav'),
  ('posts/6025ca12-0bb9-4b7e-89d5-0a22436a914c/bdf4e338-ad49-4927-a975-7870bbf2265c.mp4')
on conflict do nothing;

delete from public.parent_upload_intents
where post_id = '5f3f52e5-0a04-44c2-886b-80b7fa2b286e'
   or storage_path in (select storage_path from _pe_test_cleanup_paths)
   or consumed_at is null;

delete from public.parent_post_images
where post_id = '5f3f52e5-0a04-44c2-886b-80b7fa2b286e';

delete from public.parent_posts
where id = '5f3f52e5-0a04-44c2-886b-80b7fa2b286e'
  and author_name = 'اختبار آلي فيديو/صوت';

-- نوايا قديمة لمسارات الاختبار حتى ينظّفها parent-submit
insert into public.parent_upload_intents (
  post_id, storage_path, kind, expected_size, expected_ext, created_at
)
select
  '5f3f52e5-0a04-44c2-886b-80b7fa2b286e'::uuid,
  p.storage_path,
  case when p.storage_path like '%.wav' then 'audio' else 'video' end,
  64,
  case
    when p.storage_path like '%.wav' then 'wav'
    when p.storage_path like '%.jpg' then 'mp4'
    else coalesce(nullif(split_part(p.storage_path, '.', 2), ''), 'mp4')
  end,
  timezone('utc', now()) - interval '3 hours'
from _pe_test_cleanup_paths p
where p.storage_path ~ '\.(mp4|mov|webm|m4a|mp3|aac|wav|ogg)$'
on conflict (storage_path) do update
set created_at = excluded.created_at, consumed_at = null;

select storage_path from _pe_test_cleanup_paths order by 1;
