import type { NextFunction, Request, Response } from 'express';
import { sendAppError } from '../lib/http';
import { errorFactory } from '../lib/errors';
import type { RequestWithAuth } from '../lib/types';

// This middleware expects JWT parsing middleware (e.g. supabaseJwtAuth)
// to attach req.auth or req.user before protected routes.
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const r = req as RequestWithAuth;
  const authUserId = r.auth?.authUserId ?? r.auth?.userId ?? r.user?.id ?? r.user?.sub;
  if (!authUserId) {
    return sendAppError(res, errorFactory.unauthorized());
  }

  return next();
}
