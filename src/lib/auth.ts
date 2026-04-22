import type { RequestWithAuth, AuthContext } from './types';
import { errorFactory } from './errors';

export function getAuthContext(req: RequestWithAuth): AuthContext {
  const authUserId = req.auth?.authUserId ?? req.auth?.userId ?? req.user?.id ?? req.user?.sub;
  if (!authUserId) {
    throw errorFactory.unauthorized('Missing authenticated user context');
  }

  const lineUserId = req.auth?.lineUserId ?? req.user?.line_user_id;

  return {
    authUserId,
    lineUserId
  };
}
