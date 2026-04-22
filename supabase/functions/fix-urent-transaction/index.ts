/**
 * 修正 Urent 交易記錄 Edge Function
 * 
 * 🔒 安全性：需要管理員身分驗證（僅限 owner）
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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
    console.error(`[Auth] 使用者 ${user.email} 不是管理員`);
    throw new Error('NOT_ADMIN');
  }

  if (!adminProfile.is_active || adminProfile.status !== 'active') {
    console.error(`[Auth] 管理員 ${adminProfile.email} 已停用或狀態異常`);
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
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // 🔒 第一步：驗證管理員身分與權限（僅限 owner）
    const { admin } = await verifyAdminAccess(req, ['owner']);
    console.log(`✅ 管理員驗證成功：${admin.name} (${admin.role})`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // 修正交易記錄
    // 正確計算：12000 × 50% = 6000（折扣後租金）
    // 客戶收入：6000 × 65% = 3900
    // 平台抽成：6000 × 35% = 2100
    const { error: txError } = await supabase
      .from('urent_transactions')
      .update({
        rental_amount: 6000,
        income_amount: 3900,
        commission_amount: 2100,
        balance_before: 0,
        balance_after: 3900,
        description: '訂單 ORD-1771752925103 - ARRI Alexa Mini LF 大畫幅攝影機 (1天，套用50%折扣後租金NT$6,000)',
        performed_by: admin.id,
      })
      .eq('id', '076d7a74-c74b-4a40-896c-7ec53956e17a')

    if (txError) {
      return new Response(JSON.stringify({ success: false, step: 'tx', error: txError }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // 修正帳戶餘額
    const { error: accError } = await supabase
      .from('urent_accounts')
      .update({
        current_balance: 3900,
        total_income: 3900,
        updated_at: new Date().toISOString(),
      })
      .eq('id', '238a185c-ab9f-4cb5-a3ef-31e7ecbd390c')

    if (accError) {
      return new Response(JSON.stringify({ success: false, step: 'account', error: accError }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({
      success: true,
      message: '修正完成',
      performed_by: {
        admin_id: admin.id,
        admin_name: admin.name,
        admin_role: admin.role,
      },
      corrected: {
        rental_amount: 6000,
        income_amount: 3900,
        commission_amount: 2100,
        account_balance: 3900,
      }
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

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

    return new Response(JSON.stringify({ success: false, error: String(error) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})