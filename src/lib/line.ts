import crypto from 'crypto';
import { env } from './env';
import { errorFactory } from './errors';

export interface LineTokenVerifyResult {
  sub: string;
}

export function generateBindingTokenRaw(): string {
  return crypto.randomBytes(24).toString('base64url');
}

export function hashBindingToken(rawToken: string): string {
  const pepper = env.lineBindingTokenPepper;
  return crypto.createHash('sha256').update(`${rawToken}:${pepper}`).digest('hex');
}

export async function verifyLineIdToken(idToken: string): Promise<LineTokenVerifyResult> {
  if (!env.lineChannelId) {
    throw errorFactory.internal('LINE_LIFF_CHANNEL_ID is required');
  }

  const body = new URLSearchParams({
    id_token: idToken,
    client_id: env.lineChannelId
  });

  const response = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    throw errorFactory.unprocessable('LINE_ID_TOKEN_INVALID', 'LINE ID token verification failed');
  }

  const payload = (await response.json()) as { sub?: string };
  if (!payload.sub) {
    throw errorFactory.unprocessable('LINE_ID_TOKEN_INVALID', 'LINE ID token has no subject');
  }

  return { sub: payload.sub };
}
