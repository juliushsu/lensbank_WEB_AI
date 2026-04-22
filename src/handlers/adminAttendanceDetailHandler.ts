import type { Response } from 'express';
import { getServerSupabaseClient } from '../lib/supabase';
import type { RequestWithAuth } from '../lib/types';
import { getAuthContext } from '../lib/auth';
import { errorFactory } from '../lib/errors';
import { sendAppError, sendOk } from '../lib/http';
import {
  assertRoleAtLeastManager,
  getAdminProfileOrThrow,
  isGlobalRole
} from '../lib/adminProfiles';
import { pickLocationName, pickName } from '../lib/display';

export async function adminAttendanceDetailHandler(req: RequestWithAuth, res: Response) {
  try {
    const attendanceLogId = req.params.id;
    if (!attendanceLogId) {
      throw errorFactory.badRequest('INVALID_REQUEST', 'attendance log id is required');
    }

    const supabase = getServerSupabaseClient(req);
    const auth = getAuthContext(req);
    const actorProfile = await getAdminProfileOrThrow(supabase, auth.authUserId);
    assertRoleAtLeastManager(actorProfile.role);

    const { data: attendanceLog, error: attendanceLogError } = await supabase
      .from('attendance_logs')
      .select(
        `
          id,
          admin_profile_id,
          location_id,
          check_type,
          checked_at,
          gps_lat,
          gps_lng,
          distance_m,
          is_within_range,
          is_valid,
          record_source,
          is_adjusted,
          adjustment_count,
          status_color,
          created_at,
          updated_at,
          admin_profiles(*),
          locations(*)
        `
      )
      .eq('id', attendanceLogId)
      .maybeSingle();

    if (attendanceLogError) {
      throw errorFactory.internal(`Failed to query attendance log detail: ${attendanceLogError.message}`);
    }

    if (!attendanceLog) {
      throw errorFactory.notFound('ATTENDANCE_LOG_NOT_FOUND', 'attendance log not found');
    }

    if (!isGlobalRole(actorProfile.role)) {
      if (!actorProfile.assigned_location_id || attendanceLog.location_id !== actorProfile.assigned_location_id) {
        throw errorFactory.forbidden('store_manager can only view logs in assigned location', {
          code: 'PROFILE_SCOPE_FORBIDDEN'
        });
      }
    }

    const { data: adjustmentRows, error: adjustmentError } = await supabase
      .from('attendance_adjustments')
      .select(`
        id,
        attendance_log_id,
        admin_profile_id,
        adjustment_mode,
        adjustment_type,
        original_checked_at,
        adjusted_checked_at,
        reason,
        reason_category,
        target_location_id,
        created_manual_log_id,
        requested_by_admin_profile_id,
        approved_by_admin_profile_id,
        is_self_adjustment,
        created_at,
        approved_at
      `)
      .or(`attendance_log_id.eq.${attendanceLogId},created_manual_log_id.eq.${attendanceLogId}`)
      .order('created_at', { ascending: true });

    if (adjustmentError) {
      throw errorFactory.internal(`Failed to query attendance adjustments: ${adjustmentError.message}`);
    }

    const profileIds = new Set<string>();
    const locationIds = new Set<string>();

    for (const row of adjustmentRows ?? []) {
      if (row.admin_profile_id) profileIds.add(row.admin_profile_id);
      if (row.requested_by_admin_profile_id) profileIds.add(row.requested_by_admin_profile_id);
      if (row.approved_by_admin_profile_id) profileIds.add(row.approved_by_admin_profile_id);
      if (row.target_location_id) locationIds.add(row.target_location_id);
    }

    const profileMap = new Map<string, { id: string; role: string | null; name: string }>();
    if (profileIds.size > 0) {
      const { data: profiles, error: profilesError } = await supabase
        .from('admin_profiles')
        .select('*')
        .in('id', Array.from(profileIds));

      if (profilesError) {
        throw errorFactory.internal(`Failed to query adjustment admin profiles: ${profilesError.message}`);
      }

      for (const p of profiles ?? []) {
        const profileRecord = p as unknown as Record<string, unknown>;
        profileMap.set(p.id, {
          id: p.id,
          role: (profileRecord.role as string | null) ?? null,
          name: pickName(profileRecord)
        });
      }
    }

    const locationMap = new Map<string, { id: string; name: string }>();
    if (locationIds.size > 0) {
      const { data: locations, error: locationsError } = await supabase
        .from('locations')
        .select('id, name_zh, name_ja')
        .in('id', Array.from(locationIds));

      if (locationsError) {
        throw errorFactory.internal(`Failed to query adjustment locations: ${locationsError.message}`);
      }

      for (const loc of locations ?? []) {
        const locationRecord = loc as unknown as Record<string, unknown>;
        locationMap.set(loc.id, {
          id: loc.id,
          name: pickLocationName(locationRecord)
        });
      }
    }

    const adminProfileRow = (attendanceLog.admin_profiles ?? null) as Record<string, unknown> | null;
    const locationRow = (attendanceLog.locations ?? null) as Record<string, unknown> | null;
    const adminName = pickName(adminProfileRow);
    const locationName = pickLocationName(locationRow);

    const adjustments = (adjustmentRows ?? []).map((row) => {
      const targetProfile = row.admin_profile_id ? profileMap.get(row.admin_profile_id) : null;
      const requestedBy = row.requested_by_admin_profile_id
        ? profileMap.get(row.requested_by_admin_profile_id)
        : null;
      const approvedBy = row.approved_by_admin_profile_id
        ? profileMap.get(row.approved_by_admin_profile_id)
        : null;
      const targetLocation = row.target_location_id ? locationMap.get(row.target_location_id) : null;

      return {
        id: row.id,
        attendance_log_id: row.attendance_log_id,
        created_manual_log_id: row.created_manual_log_id,
        admin_profile_id: row.admin_profile_id,
        admin_name: targetProfile?.name ?? null,
        employee_id: row.admin_profile_id,
        employee_name: targetProfile?.name ?? null,
        adjustment_mode: row.adjustment_mode,
        adjustment_type: row.adjustment_type,
        original_checked_at: row.original_checked_at,
        adjusted_checked_at: row.adjusted_checked_at,
        reason: row.reason,
        reason_category: row.reason_category,
        target_location_id: row.target_location_id,
        target_location_name: targetLocation?.name ?? null,
        requested_by_admin_profile_id: row.requested_by_admin_profile_id,
        requested_by_name: requestedBy?.name ?? null,
        requested_by_role: requestedBy?.role ?? null,
        approved_by_admin_profile_id: row.approved_by_admin_profile_id,
        approved_by_name: approvedBy?.name ?? null,
        approved_by_role: approvedBy?.role ?? null,
        is_self_adjustment: row.is_self_adjustment,
        created_at: row.created_at,
        approved_at: row.approved_at
      };
    });

    return sendOk(
      res,
      {
        attendance_log: {
          id: attendanceLog.id,
          admin_profile_id: attendanceLog.admin_profile_id,
          admin_name: adminName,
          employee_id: attendanceLog.admin_profile_id,
          employee_name: adminName,
          role: (adminProfileRow?.role as string | null) ?? null,
          location_id: attendanceLog.location_id,
          location_name: locationName,
          check_type: attendanceLog.check_type,
          checked_at: attendanceLog.checked_at,
          gps_lat: attendanceLog.gps_lat,
          gps_lng: attendanceLog.gps_lng,
          distance_m: attendanceLog.distance_m,
          is_within_range: attendanceLog.is_within_range,
          is_valid: attendanceLog.is_valid,
          record_source: attendanceLog.record_source,
          is_adjusted: attendanceLog.is_adjusted,
          adjustment_count: attendanceLog.adjustment_count,
          status_color: attendanceLog.status_color,
          created_at: attendanceLog.created_at,
          updated_at: attendanceLog.updated_at
        },
        adjustments
      },
      {
        population_basis: 'admin_profiles.assigned_location_id',
        event_basis: 'attendance_logs.location_id'
      }
    );
  } catch (error) {
    return sendAppError(res, error);
  }
}
