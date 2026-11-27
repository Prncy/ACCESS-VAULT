import { USING_MOCK } from './authApi.js';
import { getSupabase } from './supabaseClient.js';

// Audit rows are server-written. The browser may only request the two approved
// client-observable events and read the caller's permitted activity feed.
export async function logAuditEvent(action, resourceId = null, resourceType = null) {
  if (USING_MOCK) return;
  const { error } = await getSupabase().rpc('log_event', {
    p_action: action,
    p_resource_id: resourceId,
    p_resource_type: resourceType,
  });
  if (error) throw error;
}

export async function getAuditLog({ limit = 50, before = null, resourceId = null } = {}) {
  if (USING_MOCK) return [];
  const { data, error } = await getSupabase().rpc('get_audit_log', {
    p_limit: Math.min(200, Math.max(1, limit)),
    p_before: before,
    p_resource_id: resourceId,
  });
  if (error) throw error;
  return data ?? [];
}
