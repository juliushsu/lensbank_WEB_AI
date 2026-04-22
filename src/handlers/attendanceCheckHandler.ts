import type { Response } from 'express';
import { getServerSupabaseClient } from '../lib/supabase';
import type { AttendanceCheckType, RequestWithAuth } from '../lib/types';
import { getAuthContext } from '../lib/auth';
import { errorFactory } from '../lib/errors';
import { sendAppError, sendCreated } from '../lib/http';
import { ATTENDANCE_CHECK_TYPES } from '../lib/attendance/constants';
import { haversineMeters } from '../lib/attendance/geo';
import { env } from '../lib/env';
import { secondsDiff } from '../lib/attendance/time';

interface AttendanceCheckBody {
  check_type?: AttendanceCheckType;
  gps_lat?: number;
  gps_lng?: number;
  line_user_id?: string;
}

export async function attendanceCheckHandler(req: RequestWithAuth, res: Response) {
  try {
    const body = (req.body ?? {}) as AttendanceCheckBody;

    if (!body.check_type || !ATTENDANCE_CHECK_TYPES.includes(body.check_type)) {
      throw errorFactory.badRequest('INVALID_REQUEST', 'check_type must be check_in or check_out');
    }

    if (typeof body.gps_lat !== 'number' || typeof body.gps_lng !== 'number') {
      throw errorFactory.badRequest('INVALID_REQUEST', 'gps_lat and gps_lng are required numbers');
    }

    const auth = getAuthContext(req);
    const lineUserId = auth.lineUserId ?? body.line_user_id;

    if (!lineUserId) {
      throw errorFactory.unauthorized('LINE user context is required');
    }

    const supabase = getServerSupabaseClient(req);

    const { data: adminProfile, error: profileError } = await supabase
      .from('admin_profiles')
      .select('id, assigned_location_id, is_active')
      .eq('line_user_id', lineUserId)
      .maybeSingle();

    if (profileError) {
      throw errorFactory.internal(`Failed to query admin profile by line_user_id: ${profileError.message}`);
    }

    if (!adminProfile) {
      throw errorFactory.notFound('ADMIN_PROFILE_NOT_FOUND', 'admin profile for current line_user_id not found');
    }

    if (adminProfile.is_active === false) {
      throw errorFactory.unprocessable('ADMIN_PROFILE_INACTIVE', 'admin profile is not active');
    }

    if (!adminProfile.assigned_location_id) {
      throw errorFactory.unprocessable('LOCATION_NOT_FOUND', 'admin profile has no assigned_location_id');
    }

    const { data: location, error: locationError } = await supabase
      .from('locations')
      .select('id, latitude, longitude, checkin_radius_m, is_attendance_enabled')
      .eq('id', adminProfile.assigned_location_id)
      .maybeSingle();

    if (locationError) {
      throw errorFactory.internal(`Failed to query assigned location: ${locationError.message}`);
    }

    if (!location) {
      throw errorFactory.notFound('LOCATION_NOT_FOUND', 'assigned location not found');
    }

    if (!location.is_attendance_enabled) {
      throw errorFactory.unprocessable('LOCATION_DISABLED', 'attendance is disabled for this location');
    }

    if (location.latitude === null || location.longitude === null) {
      throw errorFactory.unprocessable(
        'LOCATION_COORDINATES_NOT_SET',
        'location latitude/longitude is not configured'
      );
    }

    const distanceM = haversineMeters(
      body.gps_lat,
      body.gps_lng,
      Number(location.latitude),
      Number(location.longitude)
    );

    const withinRange = distanceM <= (location.checkin_radius_m ?? 50);
    if (!withinRange) {
      throw errorFactory.unprocessable('OUT_OF_RANGE', 'admin profile is outside attendance radius', {
        distance_m: distanceM,
        radius_m: location.checkin_radius_m ?? 50
      });
    }

    const { data: latestLog, error: latestLogError } = await supabase
      .from('attendance_logs')
      .select('id, check_type, checked_at')
      .eq('admin_profile_id', adminProfile.id)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestLogError) {
      throw errorFactory.internal(`Failed to query latest attendance log: ${latestLogError.message}`);
    }

    const nowIso = new Date().toISOString();

    if (latestLog) {
      const diffSeconds = secondsDiff(nowIso, latestLog.checked_at);
      if (diffSeconds >= 0 && diffSeconds < env.attendanceCooldownSeconds) {
        throw errorFactory.unprocessable('CHECK_COOLDOWN_ACTIVE', 'attendance action is too frequent', {
          cooldown_seconds: env.attendanceCooldownSeconds,
          remaining_seconds: env.attendanceCooldownSeconds - diffSeconds
        });
      }
    }

    if (body.check_type === 'check_in') {
      if (latestLog && latestLog.check_type === 'check_in') {
        const latestDay = latestLog.checked_at.slice(0, 10);
        const today = nowIso.slice(0, 10);

        if (latestDay < today) {
          throw errorFactory.unprocessable(
            'PREVIOUS_SHIFT_UNCLOSED',
            'previous shift is not closed; please ask supervisor to adjust first'
          );
        }

        throw errorFactory.unprocessable('CHECK_SEQUENCE_INVALID', 'cannot check in twice continuously');
      }
    }

    if (body.check_type === 'check_out') {
      if (!latestLog || latestLog.check_type !== 'check_in') {
        throw errorFactory.unprocessable('CHECK_OUT_WITHOUT_CHECK_IN', 'cannot check out without an open shift');
      }
    }

    const { data: insertedLog, error: insertError } = await supabase
      .from('attendance_logs')
      .insert({
        admin_profile_id: adminProfile.id,
        location_id: location.id,
        check_type: body.check_type,
        checked_at: nowIso,
        gps_lat: body.gps_lat,
        gps_lng: body.gps_lng,
        distance_m: distanceM,
        is_within_range: true,
        is_valid: true,
        record_source: 'line_liff',
        is_adjusted: false,
        adjustment_count: 0,
        status_color: 'green'
      })
      .select('*')
      .single();

    if (insertError) {
      throw errorFactory.internal(`Failed to insert attendance log: ${insertError.message}`);
    }

    return sendCreated(res, {
      attendance_log: {
        ...insertedLog,
        employee_id: insertedLog.admin_profile_id
      }
    });
  } catch (error) {
    return sendAppError(res, error);
  }
}
