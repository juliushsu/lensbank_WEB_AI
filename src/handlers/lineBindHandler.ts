import type { Response } from 'express';
import { getServerSupabaseClient } from '../lib/supabase';
import { errorFactory } from '../lib/errors';
import { sendAppError, sendOk } from '../lib/http';
import { hashBindingToken, verifyLineIdToken } from '../lib/line';
import type { RequestWithAuth } from '../lib/types';

interface LineBindBody {
  binding_token?: string;
  line_id_token?: string;
}

export async function lineBindHandler(req: RequestWithAuth, res: Response) {
  try {
    const body = (req.body ?? {}) as LineBindBody;

    if (!body.binding_token || !body.line_id_token) {
      throw errorFactory.badRequest('INVALID_REQUEST', 'binding_token and line_id_token are required');
    }

    const supabase = getServerSupabaseClient(req);
    const tokenHash = hashBindingToken(body.binding_token);
    const nowIso = new Date().toISOString();

    const { data: tokenRow, error: tokenError } = await supabase
      .from('line_binding_tokens')
      .select('id, admin_profile_id, expires_at, used_at, invalidated_at')
      .eq('token_hash', tokenHash)
      .maybeSingle();

    if (tokenError) {
      throw errorFactory.internal(`Failed to query line binding token: ${tokenError.message}`);
    }

    if (!tokenRow) {
      throw errorFactory.notFound('LINE_BINDING_TOKEN_INVALID', 'binding token not found');
    }

    if (tokenRow.used_at) {
      throw errorFactory.conflict('LINE_BINDING_TOKEN_USED', 'binding token already used');
    }

    if (tokenRow.invalidated_at) {
      throw errorFactory.conflict('LINE_BINDING_TOKEN_INVALID', 'binding token already invalidated');
    }

    if (new Date(tokenRow.expires_at).getTime() <= Date.now()) {
      throw errorFactory.unprocessable('LINE_BINDING_TOKEN_EXPIRED', 'binding token expired');
    }

    const lineToken = await verifyLineIdToken(body.line_id_token);

    const { data: currentBinding, error: existingError } = await supabase
      .from('admin_profiles')
      .select('id, line_user_id')
      .eq('line_user_id', lineToken.sub)
      .maybeSingle();

    if (existingError) {
      throw errorFactory.internal(`Failed to check existing line binding: ${existingError.message}`);
    }

    if (currentBinding && currentBinding.id !== tokenRow.admin_profile_id) {
      throw errorFactory.conflict('LINE_USER_ALREADY_BOUND', 'LINE user already bound to another admin profile');
    }

    const { data: boundProfile, error: bindError } = await supabase
      .from('admin_profiles')
      .update({ line_user_id: lineToken.sub })
      .eq('id', tokenRow.admin_profile_id)
      .select('id, line_user_id, assigned_location_id, is_active')
      .single();

    if (bindError) {
      throw errorFactory.internal(`Failed to update admin_profiles.line_user_id: ${bindError.message}`);
    }

    const { error: markUsedError } = await supabase
      .from('line_binding_tokens')
      .update({ used_at: nowIso })
      .eq('id', tokenRow.id)
      .is('used_at', null)
      .is('invalidated_at', null);

    if (markUsedError) {
      throw errorFactory.internal(`Failed to mark token as used: ${markUsedError.message}`);
    }

    const { error: invalidateOthersError } = await supabase
      .from('line_binding_tokens')
      .update({ invalidated_at: nowIso })
      .eq('admin_profile_id', tokenRow.admin_profile_id)
      .neq('id', tokenRow.id)
      .is('used_at', null)
      .is('invalidated_at', null);

    if (invalidateOthersError) {
      throw errorFactory.internal(`Failed to invalidate sibling binding tokens: ${invalidateOthersError.message}`);
    }

    return sendOk(res, {
      admin_profile_id: boundProfile.id,
      employee_id: boundProfile.id,
      line_user_id: boundProfile.line_user_id,
      bound_at: nowIso
    });
  } catch (error) {
    return sendAppError(res, error);
  }
}
