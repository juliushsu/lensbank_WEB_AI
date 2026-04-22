import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminProfileRecord, AdminRole } from './types';
import { errorFactory } from './errors';

const MANAGER_OR_ABOVE: AdminRole[] = ['owner', 'super_admin', 'store_manager'];
const GLOBAL_ROLES: AdminRole[] = ['owner', 'super_admin'];

export function isManagerOrAbove(role: AdminRole): boolean {
  return MANAGER_OR_ABOVE.includes(role);
}

export function isGlobalRole(role: AdminRole): boolean {
  return GLOBAL_ROLES.includes(role);
}

export async function getAdminProfileOrThrow(
  supabase: SupabaseClient,
  authUserId: string
): Promise<AdminProfileRecord> {
  const { data, error } = await supabase
    .from('admin_profiles')
    .select('id, auth_user_id, role, assigned_location_id, line_user_id, is_active, attendance_tracking_enabled, attendance_visibility_scope')
    .eq('auth_user_id', authUserId)
    .maybeSingle();

  if (error) {
    throw errorFactory.internal(`Failed to query admin_profiles: ${error.message}`);
  }

  if (!data) {
    throw errorFactory.forbidden('Admin profile not found');
  }

  return data as AdminProfileRecord;
}

export function assertRoleAtLeastManager(role: AdminRole) {
  if (!isManagerOrAbove(role)) {
    throw errorFactory.forbidden('Only store_manager and above can access this API', {
      code: 'ROLE_NOT_ALLOWED'
    });
  }
}
