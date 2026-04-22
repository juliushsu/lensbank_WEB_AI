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
import { normalizeDateBoundary } from '../lib/attendance/time';
import { pickName, pickLocationName } from '../lib/display';

interface AdminAttendanceListQuery {
  page?: string;
  page_size?: string;
  date_from?: string;
  date_to?: string;
  location_id?: string;
  admin_profile_id?: string;
  employee_id?: string;
  view_scope?: AttendanceViewScope;
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const n = Number(value ?? fallback);
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.floor(n);
}

function resolveViewScope(requested: string | undefined, isGlobal: boolean): AttendanceViewScope {
  const scope = (requested ?? 'store') as AttendanceViewScope;
  if (!['store', 'global', 'hidden', 'all'].includes(scope)) {
    throw errorFactory.badRequest('INVALID_REQUEST', 'view_scope must be store/global/hidden/all');
  }

  if (!isGlobal && scope !== 'store') {
    throw errorFactory.forbidden('store_manager can only use store scope', {
      code: 'PROFILE_SCOPE_FORBIDDEN'
    });
  }

  return scope;
}

export async function adminAttendanceListHandler(req: RequestWithAuth, res: Response) {
  try {
    const query = (req.query ?? {}) as AdminAttendanceListQuery;
    const page = parsePositiveInt(query.page, 1);
    const pageSize = Math.min(parsePositiveInt(query.page_size, 20), 100);
    const rangeFrom = (page - 1) * pageSize;
    const rangeTo = rangeFrom + pageSize - 1;

    const today = new Date().toISOString().slice(0, 10);
    const { fromIso, toIso } = normalizeDateBoundary(query.date_from ?? today, query.date_to ?? query.date_from ?? today);

    const supabase = getServerSupabaseClient(req);
    const auth = getAuthContext(req);
    const actorProfile = await getAdminProfileOrThrow(supabase, auth.authUserId);
    assertRoleAtLeastManager(actorProfile.role);

    const globalRole = isGlobalRole(actorProfile.role);
    const viewScope = resolveViewScope(query.view_scope, globalRole);

    // 人員母體: admin_profiles.assigned_location_id
    // 打卡事件: attendance_logs.location_id
    let locationFilter = query.location_id;
    if (!globalRole) {
      locationFilter = actorProfile.assigned_location_id ?? undefined;
      if (!locationFilter) {
        throw errorFactory.forbidden('store_manager requires assigned_location_id');
      }
    }

    const targetAdminProfileId = query.admin_profile_id ?? query.employee_id;

    let q = supabase
      .from('attendance_logs')
      .select(
        `
          id,
          admin_profile_id,
          location_id,
          check_type,
          checked_at,
          is_valid,
          record_source,
          is_adjusted,
          adjustment_count,
          status_color,
          created_at,
          admin_profiles(*),
          locations(*)
        `,
        { count: 'exact' }
      )
      .order('checked_at', { ascending: false })
      .range(rangeFrom, rangeTo);

    if (fromIso) q = q.gte('checked_at', fromIso);
    if (toIso) q = q.lte('checked_at', toIso);
    if (locationFilter) q = q.eq('location_id', locationFilter);
    if (targetAdminProfileId) q = q.eq('admin_profile_id', targetAdminProfileId);

    if (viewScope === 'store') {
      q = q
        .eq('admin_profiles.attendance_tracking_enabled', true)
        .eq('admin_profiles.attendance_visibility_scope', 'store');
    } else if (viewScope === 'global') {
      q = q.eq('admin_profiles.attendance_visibility_scope', 'global');
    } else if (viewScope === 'hidden') {
      q = q.eq('admin_profiles.attendance_visibility_scope', 'hidden');
    }

    const { data, error, count } = await q;

    if (error) {
      throw errorFactory.internal(`Failed to query attendance list: ${error.message}`);
    }

    const items = (data ?? []).map((row) => {
      const profileRow = (row.admin_profiles ?? null) as Record<string, unknown> | null;
      const locationRow = (row.locations ?? null) as Record<string, unknown> | null;
      const adminName = pickName(profileRow);

      return {
        id: row.id,
        admin_profile_id: row.admin_profile_id,
        admin_name: adminName,
        role: (profileRow?.role ?? null) as string | null,
        employee_id: row.admin_profile_id,
        employee_name: adminName,
        location_id: row.location_id,
        location_name: pickLocationName(locationRow),
        check_type: row.check_type,
        checked_at: row.checked_at,
        is_valid: row.is_valid,
        record_source: row.record_source,
        is_adjusted: row.is_adjusted,
        adjustment_count: row.adjustment_count,
        status_color: row.status_color,
        attendance_tracking_enabled: Boolean(profileRow?.attendance_tracking_enabled ?? false),
        attendance_visibility_scope: (profileRow?.attendance_visibility_scope ?? null) as
          | 'store'
          | 'global'
          | 'hidden'
          | null,
        created_at: row.created_at
      };
    });

    return sendOk(
      res,
      {
        items
      },
      {
        page,
        page_size: pageSize,
        total: count ?? 0,
        view_scope: viewScope,
        location_id: locationFilter ?? null,
        population_basis: 'admin_profiles.assigned_location_id',
        event_basis: 'attendance_logs.location_id',
        date_from: fromIso,
        date_to: toIso
      }
    );
  } catch (error) {
    return sendAppError(res, error);
  }
}
