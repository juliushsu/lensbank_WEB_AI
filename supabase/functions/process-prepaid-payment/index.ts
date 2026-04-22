/**
 * 處理儲值金扣款 Edge Function
 * 
 * 功能：
 * 1. 訂單確認後自動判斷是否為儲值客戶
 * 2. 優先扣除實體金額，不足時扣除贈送金額
 * 3. 產生扣款交易記錄並關聯訂單
 * 4. 處理發票開立邏輯（實體金額開票/贈送金額標註）
 * 
 * 🔒 安全性：需要管理員身分驗證（owner/super_admin/store_manager）
 * 
 * 請求參數：
 * - order_id: 訂單 ID（支援 UUID 或訂單編號）
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// 允許的管理員角色
type AdminRole = 'owner' | 'super_admin' | 'store_manager' | 'staff' | 'part_time';

// 管理員資料結構
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

interface PrepaidPaymentRequest {
  order_id: string;
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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    console.log('🚀 ===== 開始處理儲值金扣款 =====');
    
    // 🔒 第一步：驗證管理員身分與權限
    const { admin } = await verifyAdminAccess(req, ['owner', 'super_admin', 'store_manager']);
    console.log(`✅ 管理員驗證成功：${admin.name} (${admin.role})`);
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      console.error('❌ 環境變數未設定');
      throw new Error('Supabase 環境變數未設定');
    }
    
    const supabase = createClient(supabaseUrl, supabaseKey);

    const requestBody = await req.json();
    console.log('📥 請求參數:', JSON.stringify(requestBody, null, 2));
    
    const { order_id } = requestBody as PrepaidPaymentRequest;

    if (!order_id) {
      console.error('❌ 缺少訂單 ID');
      return new Response(
        JSON.stringify({ success: false, message: '缺少訂單 ID' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('📋 訂單 ID/編號:', order_id);

    // 1. 載入訂單資料
    console.log('🔍 步驟 1: 載入訂單資料...');
    
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(order_id);
    console.log(`📌 識別為：${isUUID ? 'UUID' : '訂單編號'}`);
    
    let orderQuery = supabase
      .from('orders')
      .select('id, order_number, customer_id, total_price, total_amount, status, prepaid_used, payment_method');
    
    if (isUUID) {
      orderQuery = orderQuery.eq('id', order_id);
    } else {
      orderQuery = orderQuery.eq('order_number', order_id);
    }
    
    const { data: order, error: orderError } = await orderQuery.maybeSingle();

    if (orderError) {
      console.error('❌ 載入訂單失敗:', orderError);
      throw new Error(`載入訂單失敗: ${orderError.message}`);
    }

    if (!order) {
      console.error('❌ 找不到訂單');
      return new Response(
        JSON.stringify({ success: false, message: '找不到訂單' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ 訂單資料:', {
      id: order.id,
      order_number: order.order_number,
      status: order.status,
      total_price: order.total_price,
    });

    if (order.status !== 'approved' && order.status !== 'renting') {
      console.error('❌ 訂單狀態不符:', order.status);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `只有「已確認」或「出租中」的訂單才能進行儲值扣款，目前狀態：${order.status}` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (order.prepaid_used) {
      console.error('❌ 訂單已使用儲值金');
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: '此訂單已經使用儲值金扣款，無法重複扣款' 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 2. 檢查客戶是否為儲值會員
    console.log('🔍 步驟 2: 檢查客戶資料...');
    const { data: customer, error: customerError } = await supabase
      .from('customers')
      .select('id, name, member_level')
      .eq('id', order.customer_id)
      .maybeSingle();

    if (customerError) {
      console.error('❌ 載入客戶資料失敗:', customerError);
      throw new Error(`載入客戶資料失敗: ${customerError.message}`);
    }

    if (!customer) {
      console.error('❌ 找不到客戶資料');
      return new Response(
        JSON.stringify({ success: false, message: '找不到客戶資料' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ 客戶資料:', {
      name: customer.name,
      member_level: customer.member_level,
    });

    if (customer.member_level !== 'gold') {
      console.error('❌ 客戶不是儲值會員:', customer.member_level);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `此客戶不是儲值會員（會員等級：${customer.member_level}），無法使用儲值金付款` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. 載入儲值帳戶
    console.log('🔍 步驟 3: 載入儲值帳戶...');
    const { data: account, error: accountError } = await supabase
      .from('prepaid_accounts')
      .select('*')
      .eq('customer_id', order.customer_id)
      .maybeSingle();

    if (accountError) {
      console.error('❌ 載入儲值帳戶失敗:', accountError);
      throw new Error(`載入儲值帳戶失敗: ${accountError.message}`);
    }

    if (!account) {
      console.error('❌ 找不到儲值帳戶');
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: '找不到儲值帳戶，請先建立儲值帳戶'
        }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log('✅ 儲值帳戶:', {
      status: account.status,
      real_balance: account.real_balance,
      bonus_balance: account.bonus_balance,
      total_balance: account.total_balance,
    });

    if (account.status !== 'active') {
      console.error('❌ 儲值帳戶狀態異常:', account.status);
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `儲值帳戶狀態異常：${account.status === 'frozen' ? '已凍結' : '已關閉'}` 
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 4. 計算扣款金額
    console.log('🔍 步驟 4: 計算扣款金額...');
    
    let totalAmount = 0;
    
    try {
      if (order.total_price !== null && order.total_price !== undefined) {
        totalAmount = parseFloat(String(order.total_price));
      }
    } catch (parseError) {
      console.error('❌ 解析 total_price 失敗:', parseError);
      totalAmount = 0;
    }

    const realBalance = account.real_balance ? parseFloat(String(account.real_balance)) : 0;
    const bonusBalance = account.bonus_balance ? parseFloat(String(account.bonus_balance)) : 0;
    const totalBalance = realBalance + bonusBalance;

    console.log('💰 扣款金額計算:', {
      '使用金額': totalAmount,
      '實體餘額': realBalance,
      '贈送餘額': bonusBalance,
      '總餘額': totalBalance,
    });

    if (!totalAmount || totalAmount <= 0 || isNaN(totalAmount)) {
      console.error('❌ 訂單金額無效:', { 
        total_price: order.total_price, 
        parsed: totalAmount,
      });
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: '訂單金額無效，無法進行扣款'
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (totalBalance < totalAmount) {
      console.error('❌ 儲值餘額不足');
      return new Response(
        JSON.stringify({ 
          success: false, 
          message: `儲值餘額不足。需要 NT$ ${totalAmount.toLocaleString()}，目前餘額 NT$ ${totalBalance.toLocaleString()}`,
          data: {
            required: totalAmount,
            real_balance: realBalance,
            bonus_balance: bonusBalance,
            total_balance: totalBalance,
            shortage: totalAmount - totalBalance
          }
        }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let realAmountUsed = 0;
    let bonusAmountUsed = 0;

    if (realBalance >= totalAmount) {
      realAmountUsed = totalAmount;
      bonusAmountUsed = 0;
    } else {
      realAmountUsed = realBalance;
      bonusAmountUsed = totalAmount - realBalance;
    }

    const newRealBalance = realBalance - realAmountUsed;
    const newBonusBalance = bonusBalance - bonusAmountUsed;
    const newTotalBalance = newRealBalance + newBonusBalance;

    console.log('💳 扣款明細:', {
      '扣除實體金額': realAmountUsed,
      '扣除贈送金額': bonusAmountUsed,
      '新實體餘額': newRealBalance,
      '新贈送餘額': newBonusBalance,
      '新總餘額': newTotalBalance,
    });

    // 5. 更新儲值帳戶
    console.log('🔍 步驟 5: 更新儲值帳戶...');
    const transactionUuid = crypto.randomUUID();
    console.log('📝 交易 UUID:', transactionUuid);

    const { error: updateAccountError } = await supabase
      .from('prepaid_accounts')
      .update({
        real_balance: newRealBalance,
        bonus_balance: newBonusBalance,
        total_spent: parseFloat(String(account.total_spent || 0)) + totalAmount,
        updated_at: new Date().toISOString(),
      })
      .eq('id', account.id);

    if (updateAccountError) {
      console.error('❌ 更新儲值帳戶失敗:', updateAccountError);
      throw new Error(`更新儲值帳戶失敗: ${updateAccountError.message}`);
    }

    console.log('✅ 儲值帳戶更新成功');

    // 6. 記錄實體金額交易
    if (realAmountUsed > 0) {
      console.log('🔍 步驟 6a: 記錄實體金額交易...');
      const { error: realTxError } = await supabase
        .from('prepaid_transactions')
        .insert({
          account_id: account.id,
          transaction_uuid: transactionUuid,
          transaction_type: 'deduct',
          real_amount: realAmountUsed,
          bonus_amount: 0,
          balance_before: totalBalance,
          balance_after: totalBalance - realAmountUsed,
          reference_type: 'order',
          reference_id: order.id,
          description: `訂單 ${order.order_number} 扣款（實體金額）`,
          performed_by: admin.id,
          requires_invoice: true,
          created_at: new Date().toISOString(),
        });

      if (realTxError) {
        console.error('❌ 記錄實體金額交易失敗:', realTxError);
        throw new Error(`記錄實體金額交易失敗: ${realTxError.message}`);
      }

      console.log('✅ 實體金額交易記錄成功');
    }

    // 7. 記錄贈送金額交易
    if (bonusAmountUsed > 0) {
      console.log('🔍 步驟 6b: 記錄贈送金額交易...');
      const { error: bonusTxError } = await supabase
        .from('prepaid_transactions')
        .insert({
          account_id: account.id,
          transaction_uuid: transactionUuid,
          transaction_type: 'deduct',
          real_amount: 0,
          bonus_amount: bonusAmountUsed,
          balance_before: totalBalance - realAmountUsed,
          balance_after: newTotalBalance,
          reference_type: 'order',
          reference_id: order.id,
          description: `訂單 ${order.order_number} 扣款（贈送金額，不開發票）`,
          performed_by: admin.id,
          requires_invoice: false,
          created_at: new Date().toISOString(),
        });

      if (bonusTxError) {
        console.error('❌ 記錄贈送金額交易失敗:', bonusTxError);
        throw new Error(`記錄贈送金額交易失敗: ${bonusTxError.message}`);
      }

      console.log('✅ 贈送金額交易記錄成功');
    }

    // 8. 更新訂單付款資訊
    console.log('🔍 步驟 7: 更新訂單付款資訊...');
    const { error: updateOrderError } = await supabase
      .from('orders')
      .update({
        payment_method: 'prepaid',
        prepaid_used: true,
        prepaid_real_amount: realAmountUsed,
        prepaid_bonus_amount: bonusAmountUsed,
        cash_amount: 0,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id);

    if (updateOrderError) {
      console.error('❌ 更新訂單付款資訊失敗:', updateOrderError);
      throw new Error(`更新訂單付款資訊失敗: ${updateOrderError.message}`);
    }

    console.log('✅ 訂單付款資訊更新成功');

    // 9. 寫入訂單日誌
    console.log('🔍 步驟 8: 寫入訂單日誌...');
    const { error: logError } = await supabase
      .from('order_logs')
      .insert({
        order_id: order.id,
        action_type: 'prepaid_payment',
        action_description: `使用儲值金付款 NT$ ${totalAmount.toLocaleString()}（實體 NT$ ${realAmountUsed.toLocaleString()} + 贈送 NT$ ${bonusAmountUsed.toLocaleString()}）- 操作人：${admin.name}`,
        performed_by: admin.id,
        performed_at: new Date().toISOString(),
        metadata: {
          transaction_uuid: transactionUuid,
          real_amount: realAmountUsed,
          bonus_amount: bonusAmountUsed,
          total_amount: totalAmount,
          balance_before: totalBalance,
          balance_after: newTotalBalance,
          admin_name: admin.name,
          admin_role: admin.role,
        },
      });

    if (logError) {
      console.error('⚠️ 寫入訂單日誌失敗:', logError);
    } else {
      console.log('✅ 訂單日誌寫入成功');
    }

    if (newTotalBalance < 3000 && newTotalBalance > 0) {
      console.log(`⚠️ 客戶 ${customer.name} 儲值餘額不足 NT$ 3,000，建議提醒儲值`);
    }

    console.log('✅ ===== 儲值金扣款處理完成 =====');

    return new Response(
      JSON.stringify({
        success: true,
        message: '儲值金扣款成功',
        data: {
          order_id: order.id,
          order_number: order.order_number,
          customer_name: customer.name,
          transaction_uuid: transactionUuid,
          performed_by: {
            admin_id: admin.id,
            admin_name: admin.name,
            admin_role: admin.role,
          },
          payment_breakdown: {
            total_amount: totalAmount,
            real_amount_used: realAmountUsed,
            bonus_amount_used: bonusAmountUsed,
            requires_invoice: realAmountUsed > 0,
          },
          balance_info: {
            before: {
              real: realBalance,
              bonus: bonusBalance,
              total: totalBalance,
            },
            after: {
              real: newRealBalance,
              bonus: newBonusBalance,
              total: newTotalBalance,
            },
          },
          low_balance_warning: newTotalBalance < 3000,
        },
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
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

    console.error('❌ ===== 處理儲值金扣款時發生錯誤 =====');
    console.error('錯誤訊息:', error instanceof Error ? error.message : String(error));
    console.error('錯誤堆疊:', error instanceof Error ? error.stack : '無堆疊資訊');
    
    return new Response(
      JSON.stringify({
        success: false,
        message: error instanceof Error ? error.message : '處理儲值金扣款失敗',
        error_type: error?.constructor?.name,
        error_details: error instanceof Error ? error.stack : String(error),
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});