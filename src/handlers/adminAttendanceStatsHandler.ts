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
import { env } from '../lib/env';
import { getDayRangeUtc, isDateOnly } from '../lib/attendance/time';

interface AdminAttendanceStatsQuery {
  date?: string;
  date_from?: string;
  date_to?: string;
  location_id?: string;
}

interface StatsLog {
  admin_profile_id: string;
  check_type: 'check_in' | 'check_out';
  checked_at: string;
  status_color: 'green' | 'yellow' | 'orange' | 'red' | 'purple';
}

function resolveSingleDate(query: AdminAttendanceStatsQuery): string {
  if (query.date) {
    if (!isDateOnly(query.date)) {
      throw errorFactory.badRequest('INVALID_DATE', 'date must be YYYY-MM-DD');
    }
    return query.date;
  }

  if (query.date_from || query.date_to) {
    if (!query.date_from || !query.date_to) {
      throw errorFactory.badRequest('STATS_SINGLE_DAY_ONLY', 'stats v1 requires a single day range');
    }

    if (!isDateOnly(query.date_from) || !isDateOnly(query.date_to)) {
      throw errorFactory.badRequest('STATS_SINGLE_DAY_ONLY', 'stats v1 requires date-only YYYY-MM-DD');
    }

    if (query.date_from !== query.date_to) {
      throw errorFactory.badRequest('STATS_SINGLE_DAY_ONLY', 'stats v1 only supports single-day query');
    }

    return query.date_from;
  }

  return new Date().toISOString().slice(0, 10);
}

export async function adminAttendanceStatsHandler(req: RequestWithAuth, res: Response) {
  try {
    const query = (req.query ?? {}) as AdminAttendanceStatsQuery;

    const supabase = getServerSupabaseClient(req);
    const auth = getAuthContext(req);
    const actorProfile = await getAdminProfileOrThrow(supabase, auth.authUserId);
    assertRoleAtLeastManager(actorProfile.role);

    const day = resolveSingleDate(query);
    const { dayStart, dayEnd } = getDayRangeUtc(day);
    const dayStartIso = dayStart.toISOString();
    const dayEndIso = dayEnd.toISOString();

    const globalRole = isGlobalRole(actorProfile.role);
    let locationFilter = query.location_id;

    if (!globalRole) {
      locationFilter = actorProfile.assigned_location_id ?? undefined;
      if (!locationFilter) {
        throw errorFactory.forbidden('store_manager requires assigned_location_id');
      }
    }

    let profilesQuery = supabase
      .from('admin_profiles')
      .select('id, role, assigned_location_id, attendance_tracking_enabled, attendance_visibility_scope, is_active')
      .eq('is_active', true)
      .eq('attendance_tracking_enabled', true)
      .eq('attendance_visibility_scope', 'store')
      .in('role', ['owner', 'super_admin', 'store_manager', 'staff']);

    if (locationFilter) {
      profilesQuery = profilesQuery.eq('assigned_location_id', locationFilter);
    }

    const { data: profiles, error: profilesError } = await profilesQuery;
    if (profilesError) {
      throw errorFactory.internal(`Failed to query scoped admin profiles: ${profilesError.message}`);
    }

    const scopedProfileIds = (profiles ?? []).map((p) => p.id);

    if (scopedProfileIds.length === 0) {
      return sendOk(
        res,
        {
          absent_count: 0,
          late_count: 0,
          on_duty_count: 0,
          high_risk_count: 0
        },
        {
          date: day,
          location_id: locationFilter ?? null,
          mode: 'single_day',
          population_basis: 'admin_profiles.assigned_location_id',
          event_basis: 'attendance_logs.location_id'
        }
      );
    }

    let logsQuery = supabase
      .from('attendance_logs')
      .select('admin_profile_id, check_type, checked_at, status_color, location_id')
      .in('admin_profile_id', scopedProfileIds)
      .gte('checked_at', dayStartIso)
      .lte('checked_at', dayEndIso)
      .order('checked_at', { ascending: true });

    if (locationFilter) {
      logsQuery = logsQuery.eq('location_id', locationFilter);
    }

    const { data: logs, error: logsError } = await logsQuery;
    if (logsError) {
      throw errorFactory.internal(`Failed to query attendance logs for stats: ${logsError.message}`);
    }

    const logsByProfile = new Map<string, StatsLog[]>();
    for (const profileId of scopedProfileIds) {
      logsByProfile.set(profileId, []);
    }

    for (const log of logs ?? []) {
      const arr = logsByProfile.get(log.admin_profile_id);
      if (arr) {
        arr.push(log as StatsLog);
      }
    }

    const lateThreshold = new Date(`${day}T${String(env.attendanceShiftStartHour).padStart(2, '0')}:00:00.000Z`);
    lateThreshold.setUTCMinutes(lateThreshold.getUTCMinutes() + env.attendanceLateAfterMinutes);

    let absentCount = 0;
    let lateCount = 0;
    let onDutyCount = 0;
    let highRiskCount = 0;

    const todayUtc = new Date().toISOString().slice(0, 10);
    const allowOnDutyRealtime = day === todayUtc;

    for (const profileId of scopedProfileIds) {
      const profileLogs = logsByProfile.get(profileId) ?? [];
      const firstCheckIn = profileLogs.find((l) => l.check_type === 'check_in');

      if (!firstCheckIn) {
        absentCount += 1;
      } else if (new Date(firstCheckIn.checked_at).getTime() > lateThreshold.getTime()) {
        lateCount += 1;
      }

      if (allowOnDutyRealtime && profileLogs.length > 0) {
        const latest = profileLogs[profileLogs.length - 1];
        if (latest.check_type === 'check_in') {
          onDutyCount += 1;
        }
      }

      if (profileLogs.some((l) => l.status_color === 'red' || l.status_color === 'purple')) {
        highRiskCount += 1;
      }
    }

    return sendOk(
      res,
      {
        absent_count: absentCount,
        late_count: lateCount,
        on_duty_count: onDutyCount,
        high_risk_count: highRiskCount
      },
      {
        date: day,
        location_id: locationFilter ?? null,
        mode: 'single_day',
        population_basis: 'admin_profiles.assigned_location_id',
        event_basis: 'attendance_logs.location_id'
      }
    );
  } catch (error) {
    return sendAppError(res, error);
  }
}
