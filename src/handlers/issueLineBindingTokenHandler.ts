import type { Response } from 'express';
import crypto from 'crypto';
import { getServerSupabaseClient } from '../lib/supabase';
import { getAuthContext } from '../lib/auth';
import type { RequestWithAuth } from '../lib/types';
import { getAdminProfileOrThrow, assertRoleAtLeastManager, isGlobalRole } from '../lib/adminProfiles';
import { errorFactory } from '../lib/errors';
import { sendAppError, sendCreated } from '../lib/http';
import { generateBindingTokenRaw, hashBindingToken } from '../lib/line';

interface IssueLineBindingTokenBody {
  admin_profile_id?: string;
  employee_id?: string;
  expires_in_minutes?: number;
}

export async function issueLineBindingTokenHandler(req: RequestWithAuth, res: Response) {
  try {
    const body = (req.body ?? {}) as IssueLineBindingTokenBody;
    const targetAdminProfileId = body.admin_profile_id ?? body.employee_id;

    if (!targetAdminProfileId) {
      throw errorFactory.badRequest('INVALID_REQUEST', 'admin_profile_id is required');
    }

    const expiresInMinutesRaw = body.expires_in_minutes ?? 15;
    const expiresInMinutes = Math.min(Math.max(expiresInMinutesRaw, 5), 60);

    const supabase = getServerSupabaseClient(req);
    const auth = getAuthContext(req);
    const actorProfile = await getAdminProfileOrThrow(supabase, auth.authUserId);
    assertRoleAtLeastManager(actorProfile.role);

    const { data: targetAdminProfile, error: targetError } = await supabase
      .from('admin_profiles')
      .select('id, assigned_location_id, is_active')
      .eq('id', targetAdminProfileId)
      .maybeSingle();

    if (targetError) {
      throw errorFactory.internal(`Failed to query target admin profile: ${targetError.message}`);
    }

    if (!targetAdminProfile) {
      throw errorFactory.notFound('ADMIN_PROFILE_NOT_FOUND', 'admin profile not found');
    }

    if (!isGlobalRole(actorProfile.role)) {
      if (
        !actorProfile.assigned_location_id ||
        targetAdminProfile.assigned_location_id !== actorProfile.assigned_location_id
      ) {
        throw errorFactory.forbidden('Cannot issue token for admin profile outside assigned store', {
          code: 'PROFILE_SCOPE_FORBIDDEN'
        });
      }
    }

    const nowIso = new Date().toISOString();
    const expiresAt = new Date(Date.now() + expiresInMinutes * 60_000).toISOString();

    const { error: invalidateError } = await supabase
      .from('line_binding_tokens')
      .update({ invalidated_at: nowIso })
      .eq('admin_profile_id', targetAdminProfileId)
      .is('used_at', null)
      .is('invalidated_at', null);

    if (invalidateError) {
      throw errorFactory.internal(`Failed to invalidate previous binding tokens: ${invalidateError.message}`);
    }

    const rawToken = generateBindingTokenRaw();
    const tokenHash = hashBindingToken(rawToken);

    const { data: inserted, error: insertError } = await supabase
      .from('line_binding_tokens')
      .insert({
        admin_profile_id: targetAdminProfileId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        created_by_auth_user_id: auth.authUserId,
        created_by_admin_profile_id: actorProfile.id,
        created_by_role: actorProfile.role
      })
      .select('id, admin_profile_id, expires_at, created_at')
      .single();

    if (insertError) {
      throw errorFactory.internal(`Failed to create line binding token: ${insertError.message}`);
    }

    return sendCreated(res, {
      id: inserted.id,
      admin_profile_id: inserted.admin_profile_id,
      employee_id: inserted.admin_profile_id,
      binding_token: rawToken,
      token_hint: crypto.createHash('sha1').update(rawToken).digest('hex').slice(0, 8),
      expires_at: inserted.expires_at,
      created_at: inserted.created_at,
      created_by: {
        auth_user_id: auth.authUserId,
        admin_profile_id: actorProfile.id,
        role: actorProfile.role
      }
    });
  } catch (error) {
    return sendAppError(res, error);
  }
}
