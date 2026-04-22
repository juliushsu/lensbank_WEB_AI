import type { Response } from 'express';
import { getServerSupabaseClient } from '../lib/supabase';
import type {
  AttendanceAdjustmentMode,
  AttendanceCheckType,
  RequestWithAuth
} from '../lib/types';
import { getAuthContext } from '../lib/auth';
import { errorFactory } from '../lib/errors';
import { sendAppError, sendOk } from '../lib/http';
import {
  ATTENDANCE_ADJUST_MODES,
  ATTENDANCE_CHECK_TYPES,
  ATTENDANCE_REASON_CATEGORIES,
  SUPERVISOR_ROLES
} from '../lib/attendance/constants';
import { toIsoOrThrow } from '../lib/attendance/time';
import { validateAttendanceSequence } from '../lib/attendance/sequence';
import { computeAttendanceColor } from '../lib/attendance/color';
import { getAdminProfileOrThrow, assertRoleAtLeastManager, isGlobalRole } from '../lib/adminProfiles';

interface AttendanceAdjustBody {
  adjust_mode?: AttendanceAdjustmentMode;
  admin_profile_id?: string;
  employee_id?: string;
  adjustment_type?: AttendanceCheckType;
  adjusted_checked_at?: string;
  reason?: string;
  reason_category?: (typeof ATTENDANCE_REASON_CATEGORIES)[number];
  attendance_log_id?: string;
  target_location_id?: string;
}

export async function attendanceAdjustHandler(req: RequestWithAuth, res: Response) {
  try {
    const body = (req.body ?? {}) as AttendanceAdjustBody;

    if (!body.adjust_mode || !ATTENDANCE_ADJUST_MODES.includes(body.adjust_mode)) {
      throw errorFactory.badRequest('ADJUSTMENT_MODE_REQUIRED', 'adjust_mode must be modify_existing or create_missing');
    }

    const targetAdminProfileId = body.admin_profile_id ?? body.employee_id;
    if (!targetAdminProfileId) {
      throw errorFactory.badRequest('INVALID_REQUEST', 'admin_profile_id is required');
    }

    if (!body.adjustment_type || !ATTENDANCE_CHECK_TYPES.includes(body.adjustment_type)) {
      throw errorFactory.badRequest('INVALID_REQUEST', 'adjustment_type must be check_in or check_out');
    }

    if (!body.adjusted_checked_at) {
      throw errorFactory.badRequest('INVALID_REQUEST', 'adjusted_checked_at is required');
    }

    if (!body.reason || !body.reason.trim()) {
      throw errorFactory.badRequest('ADJUSTMENT_REASON_REQUIRED', 'reason is required');
    }

    if (!body.reason_category || !ATTENDANCE_REASON_CATEGORIES.includes(body.reason_category)) {
      throw errorFactory.badRequest('INVALID_REQUEST', 'reason_category is invalid');
    }

    const adjustedCheckedAtIso = toIsoOrThrow(body.adjusted_checked_at, 'INVALID_DATETIME');

    const supabase = getServerSupabaseClient(req);
    const auth = getAuthContext(req);
    const actorProfile = await getAdminProfileOrThrow(supabase, auth.authUserId);
    assertRoleAtLeastManager(actorProfile.role);

    const { data: targetAdminProfile, error: targetError } = await supabase
      .from('admin_profiles')
      .select('id, assigned_location_id, is_active')
      .eq('id', targetAdminProfileId)
      .maybeSingle();

    if (targetError) {
      throw errorFactory.internal(`Failed to query target admin profile: ${targetError.message}`);
    }

    if (!targetAdminProfile) {
      throw errorFactory.notFound('ADMIN_PROFILE_NOT_FOUND', 'admin profile not found');
    }

    if (!isGlobalRole(actorProfile.role)) {
      if (
        !actorProfile.assigned_location_id ||
        targetAdminProfile.assigned_location_id !== actorProfile.assigned_location_id
      ) {
        throw errorFactory.forbidden('store_manager can only adjust profiles in assigned location', {
          code: 'PROFILE_SCOPE_FORBIDDEN'
        });
      }
    }

    const requestedByAdminProfileId = actorProfile.id;
    const isSelfAdjustment = actorProfile.id === targetAdminProfile.id && SUPERVISOR_ROLES.has(actorProfile.role);

    if (body.adjust_mode === 'modify_existing') {
      if (!body.attendance_log_id) {
        throw errorFactory.badRequest('INVALID_REQUEST', 'attendance_log_id is required in modify_existing');
      }

      const { data: sourceLog, error: sourceLogError } = await supabase
        .from('attendance_logs')
        .select('id, admin_profile_id, location_id, check_type, checked_at, adjustment_count')
        .eq('id', body.attendance_log_id)
        .eq('admin_profile_id', targetAdminProfile.id)
        .maybeSingle();

      if (sourceLogError) {
        throw errorFactory.internal(`Failed to query source attendance log: ${sourceLogError.message}`);
      }

      if (!sourceLog) {
        throw errorFactory.notFound('ATTENDANCE_LOG_NOT_FOUND', 'attendance_log_id not found');
      }

      if (sourceLog.check_type !== body.adjustment_type) {
        throw errorFactory.badRequest(
          'INVALID_REQUEST',
          'adjustment_type must match original attendance log check_type in modify_existing'
        );
      }

      if (!isGlobalRole(actorProfile.role) && sourceLog.location_id !== actorProfile.assigned_location_id) {
        throw errorFactory.forbidden('store_manager cannot modify log outside assigned store', {
          code: 'PROFILE_SCOPE_FORBIDDEN'
        });
      }

      await validateAttendanceSequence(supabase, {
        adminProfileId: targetAdminProfile.id,
        checkType: body.adjustment_type,
        checkedAtIso: adjustedCheckedAtIso,
        excludeLogId: sourceLog.id
      });

      const statusColor = await computeAttendanceColor(supabase, {
        adminProfileId: targetAdminProfile.id,
        referenceTimeIso: adjustedCheckedAtIso,
        isAdjusted: true,
        isSelfAdjustment,
        includeCurrentAdjustment: true
      });

      const nowIso = new Date().toISOString();

      const { error: adjustmentInsertError } = await supabase
        .from('attendance_adjustments')
        .insert({
          attendance_log_id: sourceLog.id,
          admin_profile_id: targetAdminProfile.id,
          adjustment_mode: 'modify_existing',
          adjustment_type: body.adjustment_type,
          original_checked_at: sourceLog.checked_at,
          adjusted_checked_at: adjustedCheckedAtIso,
          reason: body.reason.trim(),
          reason_category: body.reason_category,
          requested_by_admin_profile_id: requestedByAdminProfileId,
          approved_by_admin_profile_id: requestedByAdminProfileId,
          approved_at: nowIso,
          is_self_adjustment: isSelfAdjustment
        });

      if (adjustmentInsertError) {
        throw errorFactory.internal(`Failed to insert attendance adjustment: ${adjustmentInsertError.message}`);
      }

      const { data: updatedLog, error: updateLogError } = await supabase
        .from('attendance_logs')
        .update({
          is_adjusted: true,
          adjustment_count: (sourceLog.adjustment_count ?? 0) + 1,
          status_color: statusColor
        })
        .eq('id', sourceLog.id)
        .select('*')
        .single();

      if (updateLogError) {
        throw errorFactory.internal(`Failed to update attendance log adjustment status: ${updateLogError.message}`);
      }

      return sendOk(res, {
        attendance_log: {
          ...updatedLog,
          employee_id: updatedLog.admin_profile_id
        }
      });
    }

    if (!body.target_location_id) {
      throw errorFactory.badRequest(
        'ADJUSTMENT_TARGET_LOCATION_REQUIRED',
        'target_location_id is required in create_missing'
      );
    }

    if (!isGlobalRole(actorProfile.role) && body.target_location_id !== actorProfile.assigned_location_id) {
      throw errorFactory.forbidden('store_manager cannot create missing log for another store', {
        code: 'PROFILE_SCOPE_FORBIDDEN'
      });
    }

    const { data: targetLocation, error: locationError } = await supabase
      .from('locations')
      .select('id, is_attendance_enabled')
      .eq('id', body.target_location_id)
      .maybeSingle();

    if (locationError) {
      throw errorFactory.internal(`Failed to query target location: ${locationError.message}`);
    }

    if (!targetLocation) {
      throw errorFactory.notFound('LOCATION_NOT_FOUND', 'target_location_id not found');
    }

    await validateAttendanceSequence(supabase, {
      adminProfileId: targetAdminProfile.id,
      checkType: body.adjustment_type,
      checkedAtIso: adjustedCheckedAtIso
    });

    const statusColor = await computeAttendanceColor(supabase, {
      adminProfileId: targetAdminProfile.id,
      referenceTimeIso: adjustedCheckedAtIso,
      isAdjusted: true,
      isSelfAdjustment,
      includeCurrentAdjustment: true
    });

    const { data: newManualLog, error: manualLogInsertError } = await supabase
      .from('attendance_logs')
      .insert({
        admin_profile_id: targetAdminProfile.id,
        location_id: body.target_location_id,
        check_type: body.adjustment_type,
        checked_at: adjustedCheckedAtIso,
        gps_lat: null,
        gps_lng: null,
        distance_m: null,
        is_within_range: null,
        is_valid: true,
        record_source: 'manual',
        is_adjusted: true,
        adjustment_count: 1,
        status_color: statusColor
      })
      .select('*')
      .single();

    if (manualLogInsertError) {
      throw errorFactory.internal(`Failed to create missing manual attendance log: ${manualLogInsertError.message}`);
    }

    const nowIso = new Date().toISOString();

    const { error: adjustmentInsertError } = await supabase
      .from('attendance_adjustments')
      .insert({
        attendance_log_id: null,
        admin_profile_id: targetAdminProfile.id,
        adjustment_mode: 'create_missing',
        adjustment_type: body.adjustment_type,
        original_checked_at: null,
        adjusted_checked_at: adjustedCheckedAtIso,
        reason: body.reason.trim(),
        reason_category: body.reason_category,
        target_location_id: body.target_location_id,
        created_manual_log_id: newManualLog.id,
        requested_by_admin_profile_id: requestedByAdminProfileId,
        approved_by_admin_profile_id: requestedByAdminProfileId,
        approved_at: nowIso,
        is_self_adjustment: isSelfAdjustment
      });

    if (adjustmentInsertError) {
      throw errorFactory.internal(`Failed to insert create_missing adjustment: ${adjustmentInsertError.message}`);
    }

    return sendOk(res, {
      attendance_log: {
        ...newManualLog,
        employee_id: newManualLog.admin_profile_id
      }
    });
  } catch (error) {
    return sendAppError(res, error);
  }
}
