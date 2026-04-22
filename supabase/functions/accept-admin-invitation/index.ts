import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ROLE_MAP: Record<string, string> = {
  owner:   'owner',
  manager: 'store_manager',
  staff:   'staff',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabaseAdmin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  const respond = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  try {
    const { token, name, password } = await req.json();

    if (!token || !name || !password) {
      return respond({ error: 'missing_fields', message: '缺少必要欄位：token、name、password' }, 400);
    }
    if (password.length < 6) {
      return respond({ error: 'password_too_short', message: '密碼至少需要 6 個字元' }, 400);
    }

    // ── 1. 驗證邀請 token ──────────────────────────────────────
    const { data: invitation, error: invErr } = await supabaseAdmin
      .from('admin_invitations')
      .select('id, email, role, assigned_location_id, organization_id, expires_at, accepted_at, invited_by')
      .eq('token', token)
      .maybeSingle();

    if (invErr || !invitation) {
      return respond({ error: 'token_invalid', message: '邀請連結無效或不存在' }, 404);
    }
    if (invitation.accepted_at) {
      return respond({ error: 'token_used', message: '此邀請連結已被使用' }, 409);
    }
    if (new Date(invitation.expires_at) < new Date()) {
      return respond({ error: 'token_expired', message: '邀請連結已過期' }, 410);
    }

    // ── 2. email 標準化（強制小寫）────────────────────────────
    const normalizedEmail = invitation.email.toLowerCase().trim();

    // ── 3. GUARD：以 email 查 admin_profiles（防同 email 不同 auth_user_id 重複）──
    const { data: existingByEmail } = await supabaseAdmin
      .from('admin_profiles')
      .select('id, status, role, auth_user_id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingByEmail?.status === 'active') {
      return respond({
        error: 'already_admin',
        message: `此 Email（${normalizedEmail}）已是有效管理員（role: ${existingByEmail.role}），無法重複接受邀請`,
      }, 409);
    }

    // ── 4. 檢查 auth.users 是否已存在此 email ─────────────────
    const { data: authUserList, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (listError) {
      return respond({ error: 'auth_list_failed', message: '查詢帳號失敗：' + listError.message }, 500);
    }

    const existingAuthUser = authUserList.users.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    let authUserId: string;
    let isNewAuthUser = false;

    if (existingAuthUser) {
      // ── 4a. auth 帳號已存在 → 再以 auth_user_id 查一次 admin_profiles（雙重確認）
      const { data: existingByAuthId } = await supabaseAdmin
        .from('admin_profiles')
        .select('id, status, role')
        .eq('auth_user_id', existingAuthUser.id)
        .maybeSingle();

      if (existingByAuthId?.status === 'active') {
        return respond({
          error: 'already_admin',
          message: '此帳號已是有效管理員，無需重複接受邀請',
        }, 409);
      }

      authUserId = existingAuthUser.id;
      isNewAuthUser = false;
    } else {
      // ── 4b. auth 帳號不存在 → 建立新帳號
      const { data: newAuth, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { name: name.trim() },
      });

      if (createError || !newAuth.user) {
        return respond({
          error: 'auth_create_failed',
          message: '建立登入帳號失敗：' + (createError?.message ?? '未知錯誤'),
        }, 500);
      }

      authUserId = newAuth.user.id;
      isNewAuthUser = true;
    }

    // ── 5. 從 DB 讀取 role + location（不信任前端傳值）────────
    const mappedRole = ROLE_MAP[invitation.role] ?? 'staff';
    const now = new Date().toISOString();

    // ── 6. 建立 admin_profiles ───────────────────────────────
    const { error: insertError } = await supabaseAdmin
      .from('admin_profiles')
      .insert({
        auth_user_id:         authUserId,
        name:                 name.trim(),
        email:                normalizedEmail,
        role:                 mappedRole,
        assigned_location_id: invitation.assigned_location_id ?? null,
        organization_id:      invitation.organization_id ?? null,
        status:               'active',
        is_active:            true,
        admin_granted_by:     invitation.invited_by ?? null,
        admin_granted_at:     now,
        created_at:           now,
        updated_at:           now,
      });

    if (insertError) {
      // ── 6a. 失敗 → rollback：刪除剛建立的 auth user ─────────
      if (isNewAuthUser) {
        await supabaseAdmin.auth.admin.deleteUser(authUserId);
        console.warn(`[accept-admin-invitation] rollback: deleted auth user ${authUserId}`);
      }
      return respond({
        error: 'profile_insert_failed',
        message: '建立管理員資料失敗（已回滾）：' + insertError.message,
      }, 500);
    }

    // ── 7. 標記邀請為已使用 ──────────────────────────────────
    const { error: acceptErr } = await supabaseAdmin
      .from('admin_invitations')
      .update({ accepted_at: now })
      .eq('id', invitation.id);

    if (acceptErr) {
      console.warn('[accept-admin-invitation] accepted_at update failed（非致命）:', acceptErr.message);
    }

    // ── 8. Audit log ─────────────────────────────────────────
    try {
      await supabaseAdmin.from('order_logs').insert({
        order_id:    null,
        action_type: 'admin_granted',
        description: `[AUDIT] 邀請接受：${normalizedEmail} 透過邀請建立 ${mappedRole} 管理員帳號 (invitation_id=${invitation.id})`,
        admin_id:    invitation.invited_by ?? null,
        created_at:  now,
      });
    } catch (_) { /* audit log 失敗不影響主流程 */ }

    return respond({
      success:      true,
      message:      `歡迎加入！${mappedRole} 帳號已建立，請使用 ${normalizedEmail} 登入。`,
      auth_user_id: authUserId,
      role:         mappedRole,
      is_new_user:  isNewAuthUser,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    console.error('[accept-admin-invitation] error:', message);
    return respond({ error: 'server_error', message: '伺服器錯誤：' + message }, 500);
  }
});
