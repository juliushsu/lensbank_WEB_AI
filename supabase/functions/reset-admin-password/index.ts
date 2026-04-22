/**
 * 重設管理員密碼 Edge Function
 *
 * 🔒 安全性：需要管理員身分驗證（僅限 owner）
 *
 * 權限規則：
 * - 只有 owner 可以重設任何人的密碼（除了自己）
 * - 不能重設自己的密碼（應使用忘記密碼流程）
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type AdminRole = 'owner' | 'super_admin' | 'store_manager' | 'staff' | 'part_time';

interface AdminProfile {
  id: string;
  auth_user_id: string;
  name: string;
  email: string;
  role: AdminRole;
  assigned_location_id: string | null;
  status: string;
  is_active: boolean;
}

/**
 * 統一管理員身分驗證函數
 */
async function verifyAdminAccess(
  req: Request,
  allowedRoles: AdminRole[]
): Promise<{ admin: AdminProfile; user: { id: string; email: string } }> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    console.error('[Auth] 缺少 Authorization header');
    throw new Error('MISSING_AUTH_HEADER');
  }

  if (!authHeader.startsWith('Bearer ')) {
    console.error('[Auth] Authorization header 格式錯誤');
    throw new Error('INVALID_AUTH_HEADER');
  }

  const token = authHeader.replace('Bearer ', '');
  console.log(`[Auth] token received, length: ${token.length}, first 30: ${token.substring(0, 30)}`);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    console.error('[Auth] Supabase 環境變數未設定');
    throw new Error('SERVER_CONFIG_ERROR');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);

  if (authError || !user) {
    console.error('[Auth] JWT 驗證失敗:', authError?.message);
    throw new Error('INVALID_TOKEN');
  }

  console.log(`[Auth] JWT 驗證成功，user_id: ${user.id}, email: ${user.email}`);

  const { data: adminProfile, error: profileError } = await supabase
    .from('admin_profiles')
    .select('*')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (profileError) {
    console.error('[Auth] 查詢 admin_profiles 失敗:', profileError.message);
    throw new Error('PROFILE_QUERY_ERROR');
  }

  if (!adminProfile) {
    console.error(`[Auth] 使用者 ${user.email} 不是管理員 (auth_user_id=${user.id})`);
    throw new Error('NOT_ADMIN');
  }

  if (!adminProfile.is_active || adminProfile.status !== 'active') {
    console.error(`[Auth] 管理員 ${adminProfile.email} 已停用或狀態異常 is_active=${adminProfile.is_active} status=${adminProfile.status}`);
    throw new Error('ADMIN_DISABLED');
  }

  const adminRole = adminProfile.role as AdminRole;
  if (!allowedRoles.includes(adminRole)) {
    console.error(
      `[Auth] 管理員 ${adminProfile.email} (${adminRole}) 權限不足，` +
      `需要角色: ${allowedRoles.join(', ')}`
    );
    throw new Error('INSUFFICIENT_PERMISSION');
  }

  console.log(
    `[Auth] ✅ 驗證成功 - 管理員: ${adminProfile.name} (${adminProfile.email}), ` +
    `角色: ${adminRole}`
  );

  return {
    admin: adminProfile as AdminProfile,
    user: {
      id: user.id,
      email: user.email || '',
    },
  };
}

/**
 * 統一錯誤處理
 */
function handleAuthError(error: unknown): Response {
  const errorMap: Record<string, { status: number; message: string }> = {
    MISSING_AUTH_HEADER: { status: 401, message: '缺少身分驗證標頭' },
    INVALID_AUTH_HEADER: { status: 401, message: '身分驗證標頭格式錯誤' },
    INVALID_TOKEN: { status: 401, message: '身分驗證失敗' },
    NOT_ADMIN: { status: 403, message: '此帳號不是管理員' },
    ADMIN_DISABLED: { status: 403, message: '此管理員帳號已停用' },
    INSUFFICIENT_PERMISSION: { status: 403, message: '權限不足' },
    SERVER_CONFIG_ERROR: { status: 500, message: '伺服器配置錯誤' },
    PROFILE_QUERY_ERROR: { status: 500, message: '查詢管理員資料失敗' },
  };

  if (error instanceof Error) {
    const errorInfo = errorMap[error.message] || {
      status: 500,
      message: '伺服器內部錯誤',
    };

    return new Response(
      JSON.stringify({
        error: errorInfo.message,
        code: error.message,
      }),
      {
        status: errorInfo.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }

  console.error('[Auth] 未預期的錯誤:', error);
  return new Response(
    JSON.stringify({
      error: '伺服器內部錯誤',
      code: 'INTERNAL_ERROR',
    }),
    {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // ── 入口 log：記錄收到的 headers ──
  const incomingAuth = req.headers.get('Authorization');
  const incomingApiKey = req.headers.get('apikey');
  console.log(`[Entry] method: ${req.method}`);
  console.log(`[Entry] has Authorization header: ${!!incomingAuth}`);
  if (incomingAuth) {
    console.log(`[Entry] Authorization first 30 chars: ${incomingAuth.substring(0, 30)}`);
    console.log(`[Entry] Authorization total length: ${incomingAuth.length}`);
  }
  console.log(`[Entry] has apikey header: ${!!incomingApiKey}`);

  try {
    if (req.method !== "POST") {
      return new Response(
        JSON.stringify({ error: "Method not allowed" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 🔒 第一步：驗證管理員身分與權限（僅限 owner）
    const { admin: caller } = await verifyAdminAccess(req, ['owner']);
    console.log(`✅ 管理員驗證成功：${caller.name} (${caller.role})`);

    const { targetAdminId, newPassword } = await req.json();

    console.log("收到重設密碼請求，目標管理員 ID:", targetAdminId);

    if (!targetAdminId || !newPassword) {
      return new Response(
        JSON.stringify({ error: "缺少必要參數" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (newPassword.length < 6) {
      return new Response(
        JSON.stringify({ error: "密碼至少需要 6 個字元" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("環境變數未設定");
      return new Response(
        JSON.stringify({ error: "伺服器設定錯誤：缺少必要的環境變數" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });

    // 取得目標管理員的資料
    const { data: targetAdmin, error: targetError } = await adminClient
      .from("admin_profiles")
      .select("id, auth_user_id, name, email, role")
      .eq("id", targetAdminId)
      .maybeSingle();

    if (targetError) {
      console.error("查詢目標管理員失敗:", targetError);
      return new Response(
        JSON.stringify({ error: "查詢目標管理員失敗：" + targetError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!targetAdmin) {
      return new Response(
        JSON.stringify({ error: "找不到目標管理員" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 禁止重設自己的密碼
    if (caller.id === targetAdmin.id) {
      return new Response(
        JSON.stringify({ error: "不能重設自己的密碼，請使用忘記密碼功能" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("目標管理員:", targetAdmin.name, "Auth User ID:", targetAdmin.auth_user_id);

    if (!targetAdmin.auth_user_id) {
      return new Response(
        JSON.stringify({ error: "此管理員尚未綁定認證帳號" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 重設密碼
    console.log("開始重設密碼...");
    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      targetAdmin.auth_user_id,
      { password: newPassword }
    );

    if (updateError) {
      console.error("重設密碼失敗:", updateError);
      return new Response(
        JSON.stringify({ error: "重設密碼失敗：" + updateError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("密碼重設成功！");

    return new Response(
      JSON.stringify({
        success: true,
        message: `已成功重設 ${targetAdmin.name} 的密碼`,
        performed_by: {
          admin_id: caller.id,
          admin_name: caller.name,
          admin_role: caller.role,
        },
        target: {
          admin_id: targetAdmin.id,
          admin_name: targetAdmin.name,
          admin_role: targetAdmin.role,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    if (error instanceof Error && [
      'MISSING_AUTH_HEADER',
      'INVALID_AUTH_HEADER',
      'INVALID_TOKEN',
      'NOT_ADMIN',
      'ADMIN_DISABLED',
      'INSUFFICIENT_PERMISSION',
      'SERVER_CONFIG_ERROR',
      'PROFILE_QUERY_ERROR',
    ].includes(error.message)) {
      return handleAuthError(error);
    }

    console.error("Edge Function 錯誤:", error);
    return new Response(
      JSON.stringify({ error: "伺服器內部錯誤：" + (error instanceof Error ? error.message : "未知錯誤") }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
