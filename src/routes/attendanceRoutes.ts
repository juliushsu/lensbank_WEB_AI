import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { attendanceCheckHandler } from '../handlers/attendanceCheckHandler';
import { attendanceAdjustHandler } from '../handlers/attendanceAdjustHandler';
import { attendanceMeHandler } from '../handlers/attendanceMeHandler';

export const attendanceRoutes = Router();

attendanceRoutes.get('/api/attendance/me', requireAuth, attendanceMeHandler);
attendanceRoutes.post('/api/attendance/check', requireAuth, attendanceCheckHandler);
attendanceRoutes.post('/api/attendance/adjust', requireAuth, attendanceAdjustHandler);
