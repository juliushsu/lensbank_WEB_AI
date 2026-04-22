import type {
  AttendanceAdjustmentMode,
  AttendanceCheckType,
  AttendanceStatusColor
} from '../types';

export const ATTENDANCE_CHECK_TYPES: AttendanceCheckType[] = ['check_in', 'check_out'];
export const ATTENDANCE_ADJUST_MODES: AttendanceAdjustmentMode[] = [
  'modify_existing',
  'create_missing'
];

export const ATTENDANCE_REASON_CATEGORIES = [
  'missed_punch',
  'traffic',
  'device_issue',
  'system_issue',
  'personal',
  'manager_override',
  'other'
] as const;

export type AttendanceReasonCategory = (typeof ATTENDANCE_REASON_CATEGORIES)[number];

export const ATTENDANCE_COLORS: AttendanceStatusColor[] = [
  'green',
  'yellow',
  'orange',
  'red',
  'purple'
];

// Staff is intentionally excluded to avoid purple false positives.
export const SUPERVISOR_ROLES = new Set(['owner', 'super_admin', 'store_manager']);
