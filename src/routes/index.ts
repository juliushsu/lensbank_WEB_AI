import type { Express } from 'express';
import { lineRoutes } from './lineRoutes';
import { attendanceRoutes } from './attendanceRoutes';
import { adminAttendanceRoutes } from './adminAttendanceRoutes';

export function registerAttendanceRoutes(app: Express) {
  app.use(lineRoutes);
  app.use(attendanceRoutes);
  app.use(adminAttendanceRoutes);
}
