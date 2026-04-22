/**
 * 計算 Urent 收入 Edge Function
 * 
 * 🔒 安全性：需要管理員身分驗證（owner/super_admin/store_manager）
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

interface RequestBody {
  order_id: string
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
    // 🔒 第一步：驗證管理員身分與權限
    const { admin } = await verifyAdminAccess(req, ['owner', 'super_admin', 'store_manager']);
    console.log(`✅ 管理員驗證成功：${admin.name} (${admin.role})`);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    const { order_id }: RequestBody = await req.json()

    if (!order_id) {
      return new Response(
        JSON.stringify({ success: false, error: '缺少訂單 ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 1. 取得訂單資訊（JOIN customers 取得客戶折扣）
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .select(`
        id, order_number, discount, start_date, end_date, status,
        customers:customer_id (
          id, discount
        )
      `)
      .eq('id', order_id)
      .maybeSingle()

    if (orderError || !order) {
      return new Response(
        JSON.stringify({ success: false, error: '找不到訂單', details: orderError }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // 2. 取得訂單中的 Urent 品項（尚未計算收入的）
    const { data: urentItems, error: itemsError } = await supabase
      .from('order_items')
      .select(`
        id,
        product_id,
        equipment_item_id,
        daily_price_snapshot,
        days,
        quantity,
        is_urent_item,
        urent_customer_id,
        urent_income_calculated,
        products:product_id (
          name_zh,
          name_ja
        )
      `)
      .eq('order_id', order_id)
      .eq('is_urent_item', true)
      .eq('urent_income_calculated', false)

    if (itemsError) {
      return new Response(
        JSON.stringify({ success: false, error: '查詢訂單明細失敗', details: itemsError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (!urentItems || urentItems.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: '此訂單沒有需要計算收入的 Urent 品項',
          processed_count: 0 
        }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const orderDiscount = order.discount || 100
    const customerDiscount = (order.customers as any)?.discount || 100
    const effectiveDiscountRate = Math.min(orderDiscount, customerDiscount)

    const startDate = new Date(order.start_date)
    const endDate = new Date(order.end_date)
    const rentalDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24))

    const results: any[] = []
    const errors: any[] = []

    for (const item of urentItems) {
      try {
        if (!item.urent_customer_id) {
          errors.push({ item_id: item.id, error: '缺少 Urent 客戶 ID' })
          continue
        }

        const { data: urentAccount, error: accountError } = await supabase
          .from('urent_accounts')
          .select('id, commission_rate, current_balance, total_income, status')
          .eq('customer_id', item.urent_customer_id)
          .eq('status', 'active')
          .maybeSingle()

        if (accountError || !urentAccount) {
          errors.push({ 
            item_id: item.id, 
            error: '找不到有效的 Urent 帳戶',
            details: accountError 
          })
          continue
        }

        const dailyPrice = item.daily_price_snapshot || 0
        const days = item.days || rentalDays

        const rentalAmount = Math.round(dailyPrice * days * (effectiveDiscountRate / 100))

        const platformRate = Number(urentAccount.commission_rate) || 35
        const urentRate = 100 - platformRate

        const incomeAmount = Math.round(rentalAmount * (urentRate / 100))
        const platformCommission = rentalAmount - incomeAmount

        const balanceBefore = urentAccount.current_balance || 0
        const balanceAfter = balanceBefore + incomeAmount

        const productName = (item.products as any)?.name_zh || (item.products as any)?.name_ja || '未知產品'

        const { error: transactionError } = await supabase
          .from('urent_transactions')
          .insert({
            account_id: urentAccount.id,
            transaction_type: 'income',
            order_id: order_id,
            order_item_id: item.id,
            equipment_item_id: item.equipment_item_id,
            product_name: productName,
            rental_days: days,
            rental_amount: rentalAmount,
            commission_rate: platformRate,
            commission_amount: platformCommission,
            income_amount: incomeAmount,
            balance_before: balanceBefore,
            balance_after: balanceAfter,
            description: `訂單 ${order.order_number} - ${productName} (${days}天，折扣${effectiveDiscountRate}%)`,
            performed_by: admin.id,
          })

        if (transactionError) {
          errors.push({ item_id: item.id, error: '寫入交易記錄失敗', details: transactionError })
          continue
        }

        const { error: updateAccountError } = await supabase
          .from('urent_accounts')
          .update({
            total_income: (urentAccount.total_income || 0) + incomeAmount,
            current_balance: balanceAfter,
            updated_at: new Date().toISOString(),
          })
          .eq('id', urentAccount.id)

        if (updateAccountError) {
          errors.push({ item_id: item.id, error: '更新帳戶餘額失敗', details: updateAccountError })
          continue
        }

        const { error: updateItemError } = await supabase
          .from('order_items')
          .update({ urent_income_calculated: true })
          .eq('id', item.id)

        if (updateItemError) {
          errors.push({ item_id: item.id, error: '更新訂單明細狀態失敗', details: updateItemError })
          continue
        }

        results.push({
          item_id: item.id,
          product_name: productName,
          rental_days: days,
          daily_price: dailyPrice,
          effective_discount_rate: effectiveDiscountRate,
          rental_amount: rentalAmount,
          platform_rate: platformRate,
          urent_rate: urentRate,
          income_amount: incomeAmount,
          platform_commission: platformCommission,
          balance_after: balanceAfter,
        })

      } catch (itemError) {
        errors.push({ item_id: item.id, error: '處理品項時發生錯誤', details: String(itemError) })
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `成功處理 ${results.length} 個 Urent 品項`,
        order_number: order.order_number,
        effective_discount_rate: effectiveDiscountRate,
        rental_days: rentalDays,
        processed_count: results.length,
        error_count: errors.length,
        performed_by: {
          admin_id: admin.id,
          admin_name: admin.name,
          admin_role: admin.role,
        },
        results,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

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

    return new Response(
      JSON.stringify({ success: false, error: '伺服器錯誤', details: String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})