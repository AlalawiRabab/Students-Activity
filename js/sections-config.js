/**
 * sections-config.js — تعريف أقسام السجل الإلكتروني لرائدة النشاط
 * المفاتيح (key) ثابتة ومطابقة لجدول public.activity_sections في migrations/002_activity_sections.sql
 */

export const GRADE_TABS = Object.freeze([
  { key: 'primary', label: 'الصفوف الأولية' },
  { key: 'upper', label: 'الصفوف العليا' },
]);

const REPORT_CATEGORIES = [
  { key: 'report', label: 'تقرير' },
  { key: 'evidence', label: 'شاهد' },
];

const SURVEY_CATEGORIES = [
  { key: 'questionnaire', label: 'الاستبانة' },
  { key: 'analysis', label: 'تحليل النتائج' },
  { key: 'attachment', label: 'مرفق' },
];

const programReportFields = [
  { name: 'title', label: 'اسم البرنامج', required: true },
  { name: 'event_date', label: 'تاريخ التنفيذ', type: 'date' },
  { name: 'target_group', label: 'الفئة المستهدفة' },
  { name: 'description', label: 'وصف مختصر', type: 'textarea' },
];

export const SECTIONS = Object.freeze([
  {
    key: 'noor_assignment',
    page: 'noor-assignment.html',
    icon: 'idcard',
    kind: 'files',
    title: 'تكليف رائدة النشاط في نظام نور',
    short: 'تكليف نظام نور',
    description: 'حفظ خطاب أو قرار تكليف رائدة النشاط في نظام نور، مع إمكانية الإرفاق والاستعراض والتحديث.',
    uploadLabel: 'إرفاق خطاب / قرار التكليف',
    emptyText: 'لم يُرفق خطاب التكليف بعد',
  },
  {
    key: 'leader_record',
    page: 'leader-record.html',
    icon: 'book',
    kind: 'files',
    title: 'سجل رائدة النشاط',
    short: 'سجل رائدة النشاط',
    description: 'سجل منظّم لوثائق رائدة النشاط؛ يمكن رفع عدة ملفات لكل منها عنوان ووصف.',
    uploadLabel: 'إضافة وثيقة',
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
    description: 'خطط البرامج الصفية الفصلية في تبويبين مستقلين؛ لكل تبويب ملفاته الخاصة.',
    uploadLabel: 'رفع ملف الخطة',
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
    description: 'خطة المدرسة للأنشطة اللاصفية في تبويبين مستقلين؛ لكل تبويب ملفاته الخاصة.',
    uploadLabel: 'رفع ملف الخطة',
    emptyText: 'لا توجد ملفات خطة في هذا التبويب بعد',
  },
  {
    key: 'announcements',
    page: 'announcements.html',
    icon: 'megaphone',
    kind: 'records',
    title: 'إعلانات البرامج',
    short: 'إعلانات البرامج',
    description: 'إعلانات البرامج بعنوان ووصف وتاريخ، مع إرفاق صور أو ملفات الإعلان.',
    recordLabel: 'إعلان',
    addLabel: 'إضافة إعلان',
    emptyText: 'لا توجد إعلانات بعد',
    fields: [
      { name: 'title', label: 'عنوان الإعلان', required: true },
      { name: 'event_date', label: 'تاريخ الإعلان', type: 'date' },
      { name: 'description', label: 'وصف الإعلان', type: 'textarea' },
    ],
  },
  {
    key: 'class_reports',
    page: 'class-reports.html',
    icon: 'clipboard',
    kind: 'records',
    title: 'تقارير البرامج الصفية',
    short: 'تقارير البرامج الصفية',
    description: 'توثيق البرامج الصفية المنفذة مع إرفاق التقارير والشواهد.',
    recordLabel: 'تقرير',
    addLabel: 'إضافة تقرير برنامج صفي',
    emptyText: 'لا توجد تقارير برامج صفية بعد',
    fields: programReportFields,
    categories: REPORT_CATEGORIES,
  },
  {
    key: 'extra_reports',
    page: 'extracurricular-reports.html',
    icon: 'chart',
    kind: 'records',
    title: 'تقارير البرامج اللاصفية',
    short: 'تقارير البرامج اللاصفية',
    description: 'توثيق البرامج اللاصفية المنفذة مع إرفاق التقارير والشواهد.',
    recordLabel: 'تقرير',
    addLabel: 'إضافة تقرير برنامج لاصفي',
    emptyText: 'لا توجد تقارير برامج لاصفية بعد',
    fields: programReportFields,
    categories: REPORT_CATEGORIES,
  },
  {
    key: 'parent_reports',
    page: 'parent-reports.html',
    icon: 'users',
    kind: 'records',
    title: 'تقارير تعزيز أولياء الأمور',
    short: 'تعزيز أولياء الأمور',
    description: 'توثيق مشاركة أولياء الأمور في برامج النشاط مع التقارير والشواهد.',
    recordLabel: 'تقرير',
    addLabel: 'إضافة تقرير مشاركة',
    emptyText: 'لا توجد تقارير مشاركة لأولياء الأمور بعد',
    fields: [
      { name: 'title', label: 'العنوان', required: true },
      { name: 'event_date', label: 'التاريخ', type: 'date' },
      { name: 'description', label: 'الوصف', type: 'textarea' },
    ],
    categories: REPORT_CATEGORIES,
  },
  {
    key: 'student_workshops',
    page: 'student-workshops.html',
    icon: 'presentation',
    kind: 'records',
    title: 'الورش التدريبية للطالبات',
    short: 'الورش التدريبية',
    description: 'توثيق الورش التدريبية للطالبات مع إرفاق الملفات والصور والتقارير.',
    recordLabel: 'ورشة',
    addLabel: 'إضافة ورشة',
    emptyText: 'لا توجد ورش تدريبية بعد',
    fields: [
      { name: 'title', label: 'اسم الورشة', required: true },
      { name: 'event_date', label: 'تاريخ التنفيذ', type: 'date' },
      { name: 'target_group', label: 'الفئة المستهدفة' },
      { name: 'objective', label: 'الهدف', type: 'textarea' },
    ],
    categories: [
      { key: 'material', label: 'ملف الورشة' },
      { key: 'photo', label: 'صورة' },
      { key: 'report', label: 'تقرير' },
    ],
  },
  {
    key: 'student_surveys',
    page: 'student-surveys.html',
    icon: 'checklist',
    kind: 'records',
    title: 'استطلاع الطالبات والطلاب على برامج ومجالات النشاط',
    short: 'استطلاع الطالبات والطلاب',
    description: 'استطلاعات الطالبات والطلاب: الاستبانة وتحليل النتائج والمرفقات.',
    recordLabel: 'استطلاع',
    addLabel: 'إضافة استطلاع',
    emptyText: 'لا توجد استطلاعات بعد',
    fields: [
      { name: 'title', label: 'عنوان الاستطلاع', required: true },
      { name: 'event_date', label: 'التاريخ', type: 'date' },
      { name: 'target_group', label: 'الفئة المستهدفة' },
      { name: 'description', label: 'ملاحظات / ملخص النتائج', type: 'textarea' },
    ],
    categories: SURVEY_CATEGORIES,
  },
  {
    key: 'parent_surveys',
    page: 'parent-surveys.html',
    icon: 'message',
    kind: 'records',
    title: 'استطلاع ولي الأمر على مجالات النشاط',
    short: 'استطلاع ولي الأمر',
    description: 'استطلاعات أولياء الأمور على مجالات النشاط ونتائجها وتحليلها.',
    recordLabel: 'استطلاع',
    addLabel: 'إضافة استطلاع',
    emptyText: 'لا توجد استطلاعات لأولياء الأمور بعد',
    fields: [
      { name: 'title', label: 'عنوان الاستطلاع', required: true },
      { name: 'event_date', label: 'التاريخ', type: 'date' },
      { name: 'target_group', label: 'الفئة المستهدفة' },
      { name: 'description', label: 'النتائج والتحليل', type: 'textarea' },
    ],
    categories: SURVEY_CATEGORIES,
  },
  {
    key: 'honors',
    page: 'honors-record.html',
    icon: 'award',
    kind: 'records',
    title: 'التكريمات',
    short: 'التكريمات',
    description: 'توثيق التكريمات مع إرفاق الصور والشهادات والملفات.',
    recordLabel: 'تكريم',
    addLabel: 'إضافة تكريم',
    emptyText: 'لا توجد تكريمات مسجلة في السجل الجديد بعد',
    fields: [
      { name: 'title', label: 'اسم التكريم', required: true },
      { name: 'event_date', label: 'التاريخ', type: 'date' },
      { name: 'honored_group', label: 'الفئة المكرّمة' },
      { name: 'reason', label: 'سبب التكريم', type: 'textarea' },
    ],
    categories: [
      { key: 'photo', label: 'صورة' },
      { key: 'certificate', label: 'شهادة' },
      { key: 'attachment', label: 'ملف' },
    ],
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

export function categoryLabel(section, key) {
  if (!key) return '';
  const c = (section?.categories || []).find((x) => x.key === key);
  return c ? c.label : '';
}
