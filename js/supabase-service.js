/**
 * supabase-service.js — CRUD عام + audit عبر RPC
 */
import { PAGE_SIZE } from './config.js';
import { getSupabase } from './supabase-client.js';
import { logDev } from './utils.js';
import { sanitizeBackupDetails } from './validators.js';

export async function writeAudit(action, entityType, entityId = null, details = {}) {
  try {
    const sb = getSupabase();
    const safe = sanitizeBackupDetails(details);
    const { error } = await sb.rpc('write_audit_log', {
      p_action: action,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_details: safe,
    });
    if (error) logDev('audit', error);
  } catch (err) {
    logDev('audit', err);
  }
}

export async function fetchSettings() {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('app_settings')
    .select('id, platform_name, leader_name, updated_at')
    .eq('id', 1)
    .maybeSingle();
  if (error) throw error;
  return (
    data || {
      platform_name: 'منصة النشاط الطلابي',
      leader_name: 'إيمان الرحيلي',
    }
  );
}

export async function updateSettings(platformName, leaderName, userId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('app_settings')
    .update({
      platform_name: platformName.trim(),
      leader_name: leaderName.trim(),
      updated_by: userId,
    })
    .eq('id', 1)
    .select()
    .single();
  if (error) throw error;
  await writeAudit('update', 'app_settings', null, {
    platform_name: platformName,
    leader_name: leaderName,
  });
  return data;
}

export async function countRows(table) {
  const sb = getSupabase();
  const { count, error } = await sb
    .from(table)
    .select('*', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function listRows(table, options = {}) {
  const {
    select = '*',
    orderBy = 'created_at',
    ascending = false,
    from = 0,
    to = PAGE_SIZE - 1,
    filters = [],
    orFilter = null,
  } = options;

  const sb = getSupabase();
  let q = sb.from(table).select(select, { count: 'exact' });

  filters.forEach((f) => {
    if (!f || f.value == null || f.value === '') return;
    if (f.op === 'eq') q = q.eq(f.column, f.value);
    else if (f.op === 'gte') q = q.gte(f.column, f.value);
    else if (f.op === 'lte') q = q.lte(f.column, f.value);
    else if (f.op === 'ilike') q = q.ilike(f.column, f.value);
  });

  if (orFilter) q = q.or(orFilter);

  q = q.order(orderBy, { ascending }).range(from, to);
  const { data, error, count } = await q;
  if (error) throw error;
  return { data: data || [], count: count || 0 };
}

export async function insertRow(table, payload, entityType) {
  const sb = getSupabase();
  const { data, error } = await sb.from(table).insert(payload).select().single();
  if (error) throw error;
  await writeAudit('create', entityType || table, data.id, { id: data.id });
  return data;
}

export async function updateRow(table, id, payload, entityType) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(table)
    .update(payload)
    .eq('id', id)
    .select()
    .single();
  if (error) throw error;
  await writeAudit('update', entityType || table, id, { id });
  return data;
}

export async function deleteRow(table, id, entityType) {
  const sb = getSupabase();
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) throw error;
  await writeAudit('delete', entityType || table, id, { id });
}

export async function fetchById(table, id, select = '*') {
  const sb = getSupabase();
  const { data, error } = await sb.from(table).select(select).eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchChildren(table, foreignKey, parentId) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from(table)
    .select('*')
    .eq(foreignKey, parentId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export function userMessageFromError(err) {
  const code = err?.code || '';
  const msg = String(err?.message || err || '');
  if (code === '42501' || /permission|rls|policy/i.test(msg)) {
    return 'ليست لديك صلاحية لتنفيذ هذا الإجراء';
  }
  if (/duplicate|unique/i.test(msg)) return 'هذا السجل موجود مسبقاً';
  if (/network|fetch/i.test(msg)) return 'تعذّر الاتصال بالخادم';
  if (err?.message && !/sql|token|password|stack/i.test(err.message)) {
    return err.message;
  }
  return 'حدث خطأ غير متوقع، حاول مرة أخرى';
}
