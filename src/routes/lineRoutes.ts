import { Router } from 'express';
import { requireAuth } from '../middleware/requireAuth';
import { lineBindHandler } from '../handlers/lineBindHandler';
import { issueLineBindingTokenHandler } from '../handlers/issueLineBindingTokenHandler';

export const lineRoutes = Router();

lineRoutes.post('/api/line/bind', requireAuth, lineBindHandler);
lineRoutes.post('/api/admin/line/binding-token', requireAuth, issueLineBindingTokenHandler);
