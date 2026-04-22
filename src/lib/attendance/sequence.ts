import type { SupabaseClient } from '@supabase/supabase-js';
import type { AttendanceCheckType } from '../types';
import { errorFactory } from '../errors';

interface NeighborLog {
  id: string;
  check_type: AttendanceCheckType;
  checked_at: string;
}

interface SequenceValidationInput {
  adminProfileId: string;
  checkType: AttendanceCheckType;
  checkedAtIso: string;
  excludeLogId?: string;
}

async function getNeighborLog(
  supabase: SupabaseClient,
  adminProfileId: string,
  checkedAtIso: string,
  direction: 'prev' | 'next',
  excludeLogId?: string
): Promise<NeighborLog | null> {
  let query = supabase
    .from('attendance_logs')
    .select('id, check_type, checked_at')
    .eq('admin_profile_id', adminProfileId);

  if (excludeLogId) {
    query = query.neq('id', excludeLogId);
  }

  if (direction === 'prev') {
    query = query.lt('checked_at', checkedAtIso).order('checked_at', { ascending: false }).limit(1);
  } else {
    query = query.gt('checked_at', checkedAtIso).order('checked_at', { ascending: true }).limit(1);
  }

  const { data, error } = await query.maybeSingle();
  if (error) {
    throw errorFactory.internal(`Failed to check attendance sequence: ${error.message}`);
  }

  return (data as NeighborLog | null) ?? null;
}

export async function validateAttendanceSequence(
  supabase: SupabaseClient,
  input: SequenceValidationInput
): Promise<void> {
  const { adminProfileId, checkType, checkedAtIso, excludeLogId } = input;

  const prev = await getNeighborLog(supabase, adminProfileId, checkedAtIso, 'prev', excludeLogId);
  const next = await getNeighborLog(supabase, adminProfileId, checkedAtIso, 'next', excludeLogId);

  if (prev && prev.check_type === checkType) {
    throw errorFactory.unprocessable(
      'ADJUSTMENT_SEQUENCE_INVALID',
      'Previous record has same check_type; would break attendance chain',
      { prev }
    );
  }

  if (next && next.check_type === checkType) {
    throw errorFactory.unprocessable(
      'ADJUSTMENT_SEQUENCE_INVALID',
      'Next record has same check_type; would break attendance chain',
      { next }
    );
  }
}
