-- =====================================================================
-- 008 — منح العامة قراءة عمود kind لمرفقات المشاركات المعتمدة فقط
-- السبب: 007 أضاف kind دون تحديث grant select الأعمدة لـ anon،
-- فاستعلام الواجهة parent_post_images(..., kind) يفشل بـ 42501
-- ويظهر «تعذّر تحميل المحتوى» رغم أن RLS تسمح بالمعتمد.
-- لا يوسّع الصلاحيات لغير المعتمد؛ لا يمس المعرض أو الجداول الأخرى.
-- =====================================================================

grant select (id, post_id, storage_path, mime_type, sort_order, kind)
  on public.parent_post_images to anon;

-- تأكيد أن المصادق عليهم يبقون على صلاحية الصف كاملة (كما في 004)
grant select, delete on table public.parent_post_images to authenticated;
