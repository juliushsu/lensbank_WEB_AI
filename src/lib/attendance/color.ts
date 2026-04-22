import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttendanceStatusColor } from '../types';
import { monthRange } from './time';
import { errorFactory } from '../errors';

interface ComputeColorInput {
  adminProfileId: string;
  referenceTimeIso: string;
  isAdjusted: boolean;
  isSelfAdjustment: boolean;
  includeCurrentAdjustment?: boolean;
}

export async function computeAttendanceColor(
  supabase: SupabaseClient,
  input: ComputeColorInput
): Promise<AttendanceStatusColor> {
  const { adminProfileId, referenceTimeIso, isAdjusted, isSelfAdjustment, includeCurrentAdjustment } = input;

  if (isSelfAdjustment) {
    return 'purple';
  }

  const { startIso, endIso } = monthRange(referenceTimeIso);

  const { count, error } = await supabase
    .from('attendance_adjustments')
    .select('id', { count: 'exact', head: true })
    .eq('admin_profile_id', adminProfileId)
    .gte('adjusted_checked_at', startIso)
    .lte('adjusted_checked_at', endIso);

  if (error) {
    throw errorFactory.internal(`Failed to calculate monthly adjustment count: ${error.message}`);
  }

  const monthlyAdjustmentCount = (count ?? 0) + (includeCurrentAdjustment ? 1 : 0);

  if (monthlyAdjustmentCount >= 6) {
    return 'red';
  }

  if (monthlyAdjustmentCount >= 3) {
    return 'orange';
  }

  if (isAdjusted) {
    return 'yellow';
  }

  return 'green';
}
