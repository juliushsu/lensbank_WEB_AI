import type { Response } from 'express';
import { getServerSupabaseClient } from '../lib/supabase';
import { getAuthContext } from '../lib/auth';
import { errorFactory } from '../lib/errors';
import { sendAppError, sendOk } from '../lib/http';
import { pickLocationName, pickName } from '../lib/display';
import type { RequestWithAuth } from '../lib/types';
import { isDateOnly } from '../lib/attendance/time';

interface AttendanceMeQuery {
  date?: string;
}

export async function attendanceMeHandler(req: RequestWithAuth, res: Response) {
  try {
    const query = (req.query ?? {}) as AttendanceMeQuery;
    const auth = getAuthContext(req);
    const supabase = getServerSupabaseClient(req);

    const { data: adminProfile, error: profileError } = await supabase
      .from('admin_profiles')
      .select('id, auth_user_id, role, assigned_location_id, is_active, attendance_tracking_enabled, attendance_visibility_scope, line_user_id')
      .eq('auth_user_id', auth.authUserId)
      .maybeSingle();

    if (profileError) {
      throw errorFactory.internal(`Failed to query current admin profile: ${profileError.message}`);
    }

    if (!adminProfile) {
      throw errorFactory.notFound('ADMIN_PROFILE_NOT_FOUND', 'current admin profile not found');
    }

    if (!adminProfile.assigned_location_id) {
      throw errorFactory.unprocessable('LOCATION_NOT_FOUND', 'admin profile has no assigned_location_id');
    }

    const { data: location, error: locationError } = await supabase
      .from('locations')
      .select('id, name_zh, name_ja, latitude, longitude, checkin_radius_m, is_attendance_enabled')
      .eq('id', adminProfile.assigned_location_id)
      .maybeSingle();

    if (locationError) {
      throw errorFactory.internal(`Failed to query assigned location: ${locationError.message}`);
    }

    if (!location) {
      throw errorFactory.notFound('LOCATION_NOT_FOUND', 'assigned location not found');
    }

    const day = query.date ?? new Date().toISOString().slice(0, 10);
    if (!isDateOnly(day)) {
      throw errorFactory.badRequest('INVALID_DATE', 'date must be YYYY-MM-DD');
    }

    const dayStartIso = `${day}T00:00:00.000Z`;
    const dayEndIso = `${day}T23:59:59.999Z`;

    const { data: todayLatestValidLog, error: logError } = await supabase
      .from('attendance_logs')
      .select('id, admin_profile_id, location_id, check_type, checked_at, is_valid, status_color, record_source, is_adjusted, adjustment_count')
      .eq('admin_profile_id', adminProfile.id)
      .eq('location_id', adminProfile.assigned_location_id)
      .eq('is_valid', true)
      .gte('checked_at', dayStartIso)
      .lte('checked_at', dayEndIso)
      .order('checked_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (logError) {
      throw errorFactory.internal(`Failed to query latest valid attendance log: ${logError.message}`);
    }

    const nextExpectedCheckType =
      !todayLatestValidLog
        ? 'check_in'
        : todayLatestValidLog.check_type === 'check_in'
          ? 'check_out'
          : 'check_in';

    const profileRecord = adminProfile as unknown as Record<string, unknown>;
    const locationRecord = location as unknown as Record<string, unknown>;
    const adminName = pickName(profileRecord);
    const locationName = pickLocationName(locationRecord);

    return sendOk(
      res,
      {
        admin_profile: {
          ...adminProfile,
          admin_name: adminName,
          employee_id: adminProfile.id,
          employee_name: adminName
        },
        location: {
          ...location,
          display_name: locationName
        },
        today_latest_valid_log: todayLatestValidLog
          ? {
              ...todayLatestValidLog,
              employee_id: todayLatestValidLog.admin_profile_id
            }
          : null,
        next_expected_check_type: nextExpectedCheckType
      },
      {
        date: day,
        population_basis: 'admin_profiles.assigned_location_id',
        event_basis: 'attendance_logs.location_id'
      }
    );
  } catch (error) {
    return sendAppError(res, error);
  }
}
