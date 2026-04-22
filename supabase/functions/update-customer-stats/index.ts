import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ✅ 統一的管理員身分驗證函數
async function verifyAdminAccess(req: Request, allowedRoles: string[]) {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    throw { status: 401, message: '缺少身分驗證標頭' };
  }

  const token = authHeader.replace('Bearer ', '');
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  
  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    throw { status: 401, message: '身分驗證失敗' };
  }

  const supabaseAdmin = createClient(
    supabaseUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const { data: adminProfile, error: profileError } = await supabaseAdmin
    .from('admin_profiles')
    .select('id, name, email, role, status, is_active')
    .eq('auth_user_id', user.id)
    .maybeSingle();

  if (profileError || !adminProfile) {
    throw { status: 403, message: '此帳號不是管理員' };
  }

  if (!adminProfile.is_active || adminProfile.status !== 'active') {
    throw { status: 403, message: '此管理員帳號已停用' };
  }

  if (!allowedRoles.includes(adminProfile.role)) {
    throw { status: 403, message: '權限不足' };
  }

  return { admin: adminProfile };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // ✅ 第一步：驗證管理員身分與權限（只允許 owner）
    const { admin } = await verifyAdminAccess(req, ['owner']);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('id');

    if (customersError) {
      throw customersError;
    }

    let updatedCount = 0;
    const errors: any[] = [];
    const debugInfo: any[] = [];

    for (const customer of customers || []) {
      try {
        const { data: ordersByCustomerId, error: err1 } = await supabase
          .from('orders')
          .select('id, total_amount, created_at')
          .eq('customer_id', customer.id)
          .not('status', 'in', '("cancelled","draft")');

        const { data: ordersByUserId, error: err2 } = await supabase
          .from('orders')
          .select('id, total_amount, created_at')
          .eq('user_id', customer.id)
          .not('status', 'in', '("cancelled","draft")');

        if (err1 || err2) {
          errors.push({ customerId: customer.id, error: err1 || err2 });
          continue;
        }

        const allOrders = [...(ordersByCustomerId || [])];
        const existingIds = new Set(allOrders.map(o => o.id));
        
        for (const order of (ordersByUserId || [])) {
          if (!existingIds.has(order.id)) {
            allOrders.push(order);
          }
        }

        const totalOrders = allOrders.length;
        const totalSpent = allOrders.reduce((sum, order) => {
          const amount = parseFloat(order.total_amount) || 0;
          return sum + amount;
        }, 0);
        
        const lastOrderAt = allOrders.length > 0
          ? allOrders.reduce((latest, order) => {
              const orderDate = new Date(order.created_at);
              return orderDate > latest ? orderDate : latest;
            }, new Date(0))
          : null;

        debugInfo.push({
          customerId: customer.id,
          byCustomerId: ordersByCustomerId?.length || 0,
          byUserId: ordersByUserId?.length || 0,
          totalOrders,
          totalSpent
        });

        const { error: updateError } = await supabase
          .from('customers')
          .update({
            total_orders: totalOrders,
            total_spent: Math.round(totalSpent),
            last_order_at: lastOrderAt ? lastOrderAt.toISOString() : null,
          })
          .eq('id', customer.id);

        if (updateError) {
          errors.push({ customerId: customer.id, error: updateError });
        } else {
          updatedCount++;
        }
      } catch (err) {
        errors.push({ customerId: customer.id, error: err });
      }
    }

    console.log(`✅ 管理員 ${admin.name} (${admin.role}) 執行客戶統計更新，成功更新 ${updatedCount} 位客戶`);

    return new Response(
      JSON.stringify({
        success: true,
        message: `成功更新 ${updatedCount} 位客戶的訂單統計`,
        totalCustomers: customers?.length || 0,
        updatedCount,
        errorCount: errors.length,
        debugInfo: debugInfo.filter(d => d.totalOrders > 0),
        errors: errors.length > 0 ? errors : undefined,
        performedBy: {
          adminId: admin.id,
          adminName: admin.name,
          adminRole: admin.role,
        },
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );
  } catch (error) {
    console.error('更新客戶統計失敗:', error);
    
    if (error.status === 401 || error.status === 403) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500,
      }
    );
  }
});