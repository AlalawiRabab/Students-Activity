/**
 * sections-config.js — أقسام السجل الإلكتروني لرائدة النشاط (مكتبة ملفات)
 * المفاتيح (key) ثابتة ومطابقة لجدول public.activity_sections في migrations/002_activity_sections.sql
 * kind:
 *   files   → ملفات مباشرة على القسم
 *   tabs    → تبويبان مستقلان (الصفوف الأولية / العليا)
 *   records → ملفات مباشرة على القسم + عرض مرفقات السجلات السابقة (إن وُجدت) في القائمة نفسها
 */

export const GRADE_TABS = Object.freeze([
  { key: 'primary', label: 'الصفوف الأولية' },
  { key: 'upper', label: 'الصفوف العليا' },
]);

export const UPLOAD_LABEL = 'رفع ملف جديد';

export const SECTIONS = Object.freeze([
  {
    key: 'noor_assignment',
    page: 'noor-assignment.html',
    icon: 'idcard',
    kind: 'files',
    title: 'تكليف رائدة النشاط في نظام نور',
    short: 'تكليف نظام نور',
    description: 'حفظ خطاب أو قرار تكليف رائدة النشاط في نظام نور واستعراضه وتحديثه.',
    emptyText: 'لم يُرفع خطاب التكليف بعد',
  },
  {
    key: 'leader_record',
    page: 'leader-record.html',
    icon: 'book',
    kind: 'files',
    title: 'سجل رائدة النشاط',
    short: 'سجل رائدة النشاط',
    description: 'مكتبة منظمة لوثائق رائدة النشاط.',
    emptyText: 'لا توجد وثائق في السجل بعد',
  },
  {
    key: 'class_plan',
    page: 'class-activity-plan.html',
    icon: 'calendar',
    kind: 'tabs',
    tabs: GRADE_TABS,
    title: 'خطة النشاط الفصلية للبرامج الصفية – الصفوف الأولية والعليا',
    short: 'خطة البرامج الصفية',
    description: 'ملفات خطط البرامج الصفية الفصلية في تبويبين مستقلين.',
    emptyText: 'لا توجد ملفات خطة في هذا التبويب بعد',
  },
  {
    key: 'extra_plan',
    page: 'extracurricular-plan.html',
    icon: 'layers',
    kind: 'tabs',
    tabs: GRADE_TABS,
    title: 'خطة المدرسة للأنشطة اللاصفية – الصفوف الأولية والعليا',
    short: 'خطة الأنشطة اللاصفية',
    description: 'ملفات خطة المدرسة للأنشطة اللاصفية في تبويبين مستقلين.',
    emptyText: 'لا توجد ملفات خطة في هذا التبويب بعد',
  },
  {
    key: 'announcements',
    page: 'announcements.html',
    icon: 'megaphone',
    kind: 'records',
    title: 'إعلانات البرامج',
    short: 'إعلانات البرامج',
    description: 'ملفات وصور إعلانات البرامج.',
    emptyText: 'لا توجد إعلانات مرفوعة بعد',
  },
  {
    key: 'class_reports',
    page: 'class-reports.html',
    icon: 'clipboard',
    kind: 'records',
    title: 'تقارير البرامج الصفية',
    short: 'تقارير البرامج الصفية',
    description: 'تقارير البرامج الصفية وشواهدها.',
    emptyText: 'لا توجد تقارير برامج صفية بعد',
  },
  {
    key: 'extra_reports',
    page: 'extracurricular-reports.html',
    icon: 'chart',
    kind: 'records',
    title: 'تقارير البرامج اللاصفية',
    short: 'تقارير البرامج اللاصفية',
    description: 'تقارير البرامج اللاصفية وشواهدها.',
    emptyText: 'لا توجد تقارير برامج لاصفية بعد',
  },
  {
    key: 'parent_reports',
    page: 'parent-reports.html',
    icon: 'users',
    kind: 'records',
    title: 'تقارير تعزيز أولياء الأمور',
    short: 'تعزيز أولياء الأمور',
    description: 'تقارير وشواهد مشاركة أولياء الأمور.',
    emptyText: 'لا توجد تقارير مشاركة لأولياء الأمور بعد',
  },
  {
    key: 'student_workshops',
    page: 'student-workshops.html',
    icon: 'presentation',
    kind: 'records',
    title: 'الورش التدريبية للطالبات',
    short: 'الورش التدريبية',
    description: 'ملفات وصور وتقارير الورش التدريبية للطالبات.',
    emptyText: 'لا توجد ملفات ورش تدريبية بعد',
  },
  {
    key: 'student_surveys',
    page: 'student-surveys.html',
    icon: 'checklist',
    kind: 'records',
    title: 'استطلاع الطالبات والطلاب على برامج ومجالات النشاط',
    short: 'استطلاع الطالبات والطلاب',
    description: 'الاستبانات وتحليل النتائج والمرفقات.',
    emptyText: 'لا توجد ملفات استطلاعات بعد',
  },
  {
    key: 'parent_surveys',
    page: 'parent-surveys.html',
    icon: 'message',
    kind: 'records',
    title: 'استطلاع ولي الأمر على مجالات النشاط',
    short: 'استطلاع ولي الأمر',
    description: 'استطلاعات أولياء الأمور ونتائجها وتحليلها.',
    emptyText: 'لا توجد ملفات استطلاعات لأولياء الأمور بعد',
  },
  {
    key: 'honors',
    page: 'honors-record.html',
    icon: 'award',
    kind: 'records',
    title: 'التكريمات',
    short: 'التكريمات',
    description: 'صور وشهادات وملفات التكريم.',
    emptyText: 'لا توجد ملفات تكريم مرفوعة بعد',
  },
]);

/** الصفحات القديمة: تبقى متاحة بكامل بياناتها تحت «أقسام سابقة» */
export const LEGACY_PAGES = Object.freeze([
  { href: './elementary-calendar.html', label: 'تقويم خطة الصفوف الأولية', icon: 'calendarSmall' },
  { href: './upper-calendar.html', label: 'تقويم خطة الصفوف العليا', icon: 'calendarSmall' },
  { href: './programs.html', label: 'البرامج والأنشطة', icon: 'layers' },
  { href: './schedule.html', label: 'جدول حصص النشاط', icon: 'calendar' },
  { href: './competitions.html', label: 'المسابقات', icon: 'award' },
  { href: './honors.html', label: 'التكريم (السجل السابق)', icon: 'award' },
  { href: './gallery.html', label: 'معرض النشاط', icon: 'image' },
]);

export function getSection(key) {
  return SECTIONS.find((s) => s.key === key) || null;
}

export function sectionIndex(key) {
  return SECTIONS.findIndex((s) => s.key === key) + 1;
}
