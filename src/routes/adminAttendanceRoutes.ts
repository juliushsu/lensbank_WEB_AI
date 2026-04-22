import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { adminAttendanceListHandler } from '../handlers/adminAttendanceListHandler';
import { adminAttendanceStatsHandler } from '../handlers/adminAttendanceStatsHandler';
import { adminAttendanceEmployeesHandler } from '../handlers/adminAttendanceEmployeesHandler';
import { adminAttendanceDetailHandler } from '../handlers/adminAttendanceDetailHandler';

export const adminAttendanceRoutes = Router();

adminAttendanceRoutes.get('/api/admin/attendance/list', requireAuth, adminAttendanceListHandler);
adminAttendanceRoutes.get('/api/admin/attendance/stats', requireAuth, adminAttendanceStatsHandler);
adminAttendanceRoutes.get('/api/admin/attendance/detail/:id', requireAuth, adminAttendanceDetailHandler);
adminAttendanceRoutes.get('/api/admin/attendance/employees', requireAuth, adminAttendanceEmployeesHandler);
