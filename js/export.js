/**
 * export.js — Excel + JSON backup
 */
import { SCHEMA_VERSION, APP_NAME } from './config.js';
import { getSupabase } from './supabase-client.js';
import { downloadBlob, logDev } from './utils.js';
import { writeAudit } from './supabase-service.js';

const BACKUP_TABLES = [
  'app_settings',
  'elementary_calendar',
  'upper_calendar',
  'classroom_programs',
  'extracurricular_programs',
  'schedules',
  'competitions',
  'competition_files',
  'honors',
  'honor_files',
  'gallery',
];

const FORBIDDEN_IMPORT_TABLES = new Set(['profiles', 'audit_logs']);

async function loadXlsx() {
  if (window.XLSX) return window.XLSX;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = resolve;
    s.onerror = () => reject(new Error('تعذّر تحميل مكتبة Excel'));
    document.head.appendChild(s);
  });
  return window.XLSX;
}

export async function exportExcel(filename, rows, sheetName = 'بيانات') {
  const XLSX = await loadXlsx();
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ ملاحظة: 'لا توجد بيانات' }]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  downloadBlob(
    new Blob([out], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  );
}

export async function exportDataBackup() {
  const sb = getSupabase();
  const tables = {};

  for (const table of BACKUP_TABLES) {
    const { data, error } = await sb.from(table).select('*');
    if (error) {
      logDev(table, error);
      tables[table] = { error: 'تعذّر القراءة', rows: [] };
    } else {
      tables[table] = { rows: data || [] };
    }
  }

  const payload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    app: APP_NAME,
    tables,
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
  downloadBlob(blob, `student-activity-backup-${Date.now()}.json`);
  await writeAudit('export_backup', 'backup', null, { tables: BACKUP_TABLES.length });
  return payload;
}

const ALLOWED_FIELDS = {
  app_settings: ['platform_name', 'leader_name'],
  elementary_calendar: [
    'gregorian_date',
    'hijri_date',
    'activity_name',
    'description',
    'notes',
  ],
  upper_calendar: [
    'gregorian_date',
    'hijri_date',
    'activity_name',
    'description',
    'notes',
  ],
  classroom_programs: ['program_name', 'teacher_name', 'execution_date', 'notes'],
  extracurricular_programs: [
    'program_name',
    'teacher_name',
    'execution_date',
    'notes',
  ],
  competitions: [
    'competition_name',
    'teacher_name',
    'participant_students',
    'competition_date',
    'result',
    'notes',
  ],
  honors: [
    'recipient_name',
    'recipient_type',
    'reason',
    'honor_date',
    'notes',
  ],
};

function pickAllowed(table, row) {
  const allowed = ALLOWED_FIELDS[table];
  if (!allowed) return null;
  const out = {};
  allowed.forEach((k) => {
    if (row[k] !== undefined) out[k] = row[k];
  });
  return out;
}

/**
 * استيراد محدود وآمن — بدون ملفات Storage وبدون profiles/audit
 */
export async function importDataBackup(file, userId) {
  const text = await file.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('ملف النسخة الاحتياطية غير صالح');
  }

  if (!json || typeof json !== 'object') throw new Error('بنية الملف غير صحيحة');
  if (json.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`إصدار المخطط غير مدعوم (المتوقع ${SCHEMA_VERSION})`);
  }
  if (!json.tables || typeof json.tables !== 'object') {
    throw new Error('لا توجد جداول في الملف');
  }

  const sb = getSupabase();
  const report = { inserted: 0, skipped: 0, tables: [] };

  for (const table of Object.keys(ALLOWED_FIELDS)) {
    if (FORBIDDEN_IMPORT_TABLES.has(table)) continue;
    const block = json.tables[table];
    const rows = Array.isArray(block?.rows) ? block.rows : [];
    if (!rows.length) continue;

    if (table === 'app_settings') {
      const row = pickAllowed(table, rows[0] || {});
      if (row?.platform_name && row?.leader_name) {
        const { error } = await sb
          .from('app_settings')
          .update({ ...row, updated_by: userId })
          .eq('id', 1);
        if (error) throw error;
        report.inserted += 1;
        report.tables.push(table);
      }
      continue;
    }

    const payload = [];
    rows.forEach((r) => {
      const clean = pickAllowed(table, r);
      if (!clean) {
        report.skipped += 1;
        return;
      }
      // رفض حقول خطرة إن وُجدت في المصدر
      if (r.role != null || r.password != null || r.access_token != null) {
        report.skipped += 1;
        return;
      }
      payload.push({ ...clean, created_by: userId });
    });

    if (!payload.length) continue;

    // إدراج دفعي بدون الكتابة فوق المعرفات القديمة
    const chunk = 100;
    for (let i = 0; i < payload.length; i += chunk) {
      const slice = payload.slice(i, i + chunk);
      const { error } = await sb.from(table).insert(slice);
      if (error) throw error;
      report.inserted += slice.length;
    }
    report.tables.push(table);
  }

  await writeAudit('import_backup', 'backup', null, {
    inserted: report.inserted,
    tables: report.tables,
  });

  return report;
}
