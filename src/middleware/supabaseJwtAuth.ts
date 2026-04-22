import type { NextFunction, Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { env } from '../lib/env';
import type { RequestWithAuth } from '../lib/types';
import { sendAppError } from '../lib/http';
import { errorFactory } from '../lib/errors';

const supabaseAuthClient = createClient(env.supabaseUrl, env.supabaseAnonKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return null;
  }

  const [scheme, token] = authHeader.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }

  return token;
}

export async function supabaseJwtAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const token = extractBearerToken(req);
    if (!token) {
      return next();
    }

    const { data, error } = await supabaseAuthClient.auth.getUser(token);
    if (error || !data.user) {
      return sendAppError(res, errorFactory.unauthorized('Invalid or expired Supabase JWT'));
    }

    const r = req as RequestWithAuth;
    const lineUserId =
      (data.user.app_metadata?.line_user_id as string | undefined) ??
      (data.user.user_metadata?.line_user_id as string | undefined);

    r.user = {
      ...(r.user ?? {}),
      id: data.user.id,
      sub: data.user.id,
      line_user_id: lineUserId
    };

    r.auth = {
      ...(r.auth ?? {}),
      userId: data.user.id,
      authUserId: data.user.id,
      lineUserId
    };

    return next();
  } catch {
    return sendAppError(res, errorFactory.internal('Failed to verify Supabase JWT'));
  }
}
