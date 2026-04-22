import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { auth: { autoRefreshToken: false, persistSession: false } }
    );

    // ── 1. 驗證呼叫者身份（必須是 active admin）
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: '未授權：缺少 Authorization header' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user: callerUser }, error: callerError } = await supabaseAdmin.auth.getUser(token);
    if (callerError || !callerUser) {
      return new Response(JSON.stringify({ error: '無效的授權 token' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { data: callerProfile, error: callerProfileError } = await supabaseAdmin
      .from('admin_profiles')
      .select('role, status')
      .eq('auth_user_id', callerUser.id)
      .maybeSingle();

    if (callerProfileError || !callerProfile) {
      return new Response(JSON.stringify({ error: '呼叫者不是有效管理員' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (callerProfile.status !== 'active') {
      return new Response(JSON.stringify({ error: '呼叫者帳號已停用' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (!['owner', 'super_admin'].includes(callerProfile.role)) {
      return new Response(JSON.stringify({ error: '權限不足：只有 owner 或 super_admin 可以新增管理員' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── 2. 解析請求參數
    const body = await req.json();
    const { email, password, name, phone, role, assigned_location_id } = body;

    if (!email || !name || !role) {
      return new Response(JSON.stringify({ error: '缺少必要欄位：email、name、role' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const normalizedEmail = email.toLowerCase().trim();

    // ── 3. GUARD：先以 email 查 admin_profiles（防同 email 不同 auth_user_id 重複）──
    const { data: existingByEmail } = await supabaseAdmin
      .from('admin_profiles')
      .select('id, status, role, auth_user_id')
      .eq('email', normalizedEmail)
      .maybeSingle();

    if (existingByEmail?.status === 'active') {
      return new Response(
        JSON.stringify({
          error: '此 Email 已是有效管理員，無需重複授權',
          detail: { current_role: existingByEmail.role, auth_user_id: existingByEmail.auth_user_id },
        }),
        { status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ── 4. 查詢 auth.users 是否已存在此 email
    const { data: authUserList, error: listError } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });

    if (listError) {
      return new Response(JSON.stringify({ error: '查詢 auth 使用者失敗：' + listError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const existingAuthUser = authUserList.users.find(
      (u) => u.email?.toLowerCase() === normalizedEmail
    );

    let authUserId: string;
    let action: string;

    if (!existingAuthUser) {
      // ── CASE A: auth.users 不存在 → 建立新帳號
      if (!password || password.length < 6) {
        return new Response(JSON.stringify({ error: '新帳號需提供至少 6 個字元的密碼' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const { data: newAuth, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: normalizedEmail,
        password,
        email_confirm: true,
        user_metadata: { name, role },
      });

      if (createError) {
        return new Response(JSON.stringify({ error: '建立 auth 帳號失敗：' + createError.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      authUserId = newAuth.user.id;
      action = 'created_new_auth';
    } else {
      authUserId = existingAuthUser.id;
      action = 'linked_existing_auth';
    }

    // ── 5. 查詢 admin_profiles 是否已存在（以 auth_user_id）
    const { data: existingProfile, error: profileQueryError } = await supabaseAdmin
      .from('admin_profiles')
      .select('id, status, role')
      .eq('auth_user_id', authUserId)
      .maybeSingle();

    if (profileQueryError) {
      return new Response(JSON.stringify({ error: '查詢 admin_profiles 失敗：' + profileQueryError.message }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const now = new Date().toISOString();
    let profileAction: string;

    if (existingProfile) {
      if (existingProfile.status === 'active') {
        return new Response(JSON.stringify({
          error: '此帳號已是有效管理員，無需重複授權',
          detail: { auth_user_id: authUserId, current_role: existingProfile.role },
        }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } else {
        // inactive admin → 重新啟用
        const { error: reactivateError } = await supabaseAdmin
          .from('admin_profiles')
          .update({
            status: 'active',
            role,
            assigned_location_id: assigned_location_id || null,
            admin_granted_by: callerUser.id,
            admin_granted_at: now,
            updated_at: now,
          })
          .eq('id', existingProfile.id);

        if (reactivateError) {
          return new Response(JSON.stringify({ error: '重新啟用管理員失敗：' + reactivateError.message }), {
            status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }

        profileAction = 'reactivated';
      }
    } else {
      // 建立新的 admin_profiles
      const { error: insertError } = await supabaseAdmin
        .from('admin_profiles')
        .insert({
          auth_user_id: authUserId,
          name: name.trim(),
          email: normalizedEmail,
          phone: phone || null,
          role,
          assigned_location_id: assigned_location_id || null,
          status: 'active',
          is_active: true,
          admin_granted_by: callerUser.id,
          admin_granted_at: now,
          created_at: now,
          updated_at: now,
        });

      if (insertError) {
        return new Response(JSON.stringify({ error: '建立 admin_profiles 失敗：' + insertError.message }), {
          status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      profileAction = 'created';
    }

    // ── 6. Audit log
    try {
      await supabaseAdmin.from('order_logs').insert({
        order_id: null,
        action_type: 'admin_granted',
        description: `[AUDIT] 管理員授權：${normalizedEmail} 被授予 ${role} 角色。auth_action=${action}, profile_action=${profileAction ?? 'created'}`,
        admin_id: callerUser.id,
        created_at: now,
      });
    } catch (_) {
      console.warn('[create-admin-profile] Audit log 寫入失敗（非致命）');
    }

    return new Response(
      JSON.stringify({
        success: true,
        auth_user_id: authUserId,
        auth_action: action,
        profile_action: profileAction ?? 'created',
        message: profileAction === 'reactivated'
          ? `管理員帳號已重新啟用：${normalizedEmail}`
          : action === 'linked_existing_auth'
          ? `已將既有帳號（${normalizedEmail}）授予 ${role} 管理員身份`
          : `管理員帳號建立成功：${normalizedEmail}`,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : '未知錯誤';
    console.error('create-admin-profile error:', message);
    return new Response(JSON.stringify({ error: '伺服器錯誤：' + message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
