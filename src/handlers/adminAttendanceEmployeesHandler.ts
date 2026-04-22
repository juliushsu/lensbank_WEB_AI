import type { Response } from 'express';
import { getServerSupabaseClient } from '../lib/supabase';
import type { AttendanceViewScope, RequestWithAuth } from '../lib/types';
import { getAuthContext } from '../lib/auth';
import { errorFactory } from '../lib/errors';
import { sendAppError, sendOk } from '../lib/http';
import {
  assertRoleAtLeastManager,
  getAdminProfileOrThrow,
  isGlobalRole
} from '../lib/adminProfiles';
import { pickName, pickLocationName } from '../lib/display';

interface AdminAttendanceEmployeesQuery {
  location_id?: string;
  view_scope?: AttendanceViewScope;
}

function resolveViewScope(requested: string | undefined, isGlobal: boolean): AttendanceViewScope {
  const scope = (requested ?? 'store') as AttendanceViewScope;
  if (!['store', 'global', 'hidden', 'all'].includes(scope)) {
    throw errorFactory.badRequest('INVALID_REQUEST', 'view_scope must be store/global/hidden/all');
  }

  if (!isGlobal && scope !== 'store') {
    throw errorFactory.forbidden('store_manager can only use store scope');
  }

  return scope;
}

export async function adminAttendanceEmployeesHandler(req: RequestWithAuth, res: Response) {
  try {
    const query = (req.query ?? {}) as AdminAttendanceEmployeesQuery;

    const supabase = getServerSupabaseClient(req);
    const auth = getAuthContext(req);
    const actorProfile = await getAdminProfileOrThrow(supabase, auth.authUserId);
    assertRoleAtLeastManager(actorProfile.role);

    const globalRole = isGlobalRole(actorProfile.role);
    const viewScope = resolveViewScope(query.view_scope, globalRole);

    let locationFilter = query.location_id;
    if (!globalRole) {
      locationFilter = actorProfile.assigned_location_id ?? undefined;
      if (!locationFilter) {
        throw errorFactory.forbidden('store_manager requires assigned_location_id');
      }
    }

    let q = supabase
      .from('admin_profiles')
      .select('id, role, assigned_location_id, attendance_tracking_enabled, attendance_visibility_scope, is_active, created_at, locations(*)')
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    if (locationFilter) {
      q = q.eq('assigned_location_id', locationFilter);
    }

    if (viewScope === 'store') {
      q = q
        .eq('attendance_tracking_enabled', true)
        .eq('attendance_visibility_scope', 'store');
    } else if (viewScope === 'global') {
      q = q.eq('attendance_visibility_scope', 'global');
    } else if (viewScope === 'hidden') {
      q = q.eq('attendance_visibility_scope', 'hidden');
    }

    const { data, error } = await q;

    if (error) {
      throw errorFactory.internal(`Failed to query attendance actors from admin_profiles: ${error.message}`);
    }

    const items = (data ?? []).map((profile) => {
      const locationRow = (profile.locations ?? null) as Record<string, unknown> | null;
      const adminName = pickName(profile as unknown as Record<string, unknown>);

      return {
        admin_profile_id: profile.id,
        admin_name: adminName,
        role: profile.role,
        employee_id: profile.id,
        employee_name: adminName,
        location_id: profile.assigned_location_id,
        location_name: pickLocationName(locationRow),
        attendance_tracking_enabled: profile.attendance_tracking_enabled,
        attendance_visibility_scope: profile.attendance_visibility_scope,
        is_active: profile.is_active,
        created_at: profile.created_at
      };
    });

    return sendOk(res, {
      items
    }, {
      population_basis: 'admin_profiles.assigned_location_id',
      event_basis: 'attendance_logs.location_id'
    });
  } catch (error) {
    return sendAppError(res, error);
  }
}
