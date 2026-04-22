import type { Request } from 'express';

export type AdminRole = 'owner' | 'super_admin' | 'store_manager' | 'staff';
export type AttendanceViewScope = 'store' | 'global' | 'hidden' | 'all';
export type AttendanceCheckType = 'check_in' | 'check_out';
export type AttendanceAdjustmentMode = 'modify_existing' | 'create_missing';
export type AttendanceStatusColor = 'green' | 'yellow' | 'orange' | 'red' | 'purple';

export interface AuthContext {
  authUserId: string;
  lineUserId?: string;
}

export interface RequestWithAuth extends Request {
  auth?: {
    userId?: string;
    authUserId?: string;
    lineUserId?: string;
  };
  user?: {
    id?: string;
    sub?: string;
    line_user_id?: string;
  };
}

export interface AdminProfileRecord {
  id: string;
  auth_user_id: string;
  role: AdminRole;
  assigned_location_id: string | null;
  line_user_id?: string | null;
  is_active?: boolean;
  attendance_tracking_enabled?: boolean;
  attendance_visibility_scope?: 'store' | 'global' | 'hidden';
}

export interface AttendanceActorRecord {
  id: string;
  role: AdminRole;
  assigned_location_id: string | null;
  line_user_id?: string | null;
  is_active?: boolean;
  attendance_tracking_enabled: boolean;
  attendance_visibility_scope: 'store' | 'global' | 'hidden';
  created_at?: string | null;
}
