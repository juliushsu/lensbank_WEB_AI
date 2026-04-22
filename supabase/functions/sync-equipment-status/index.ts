import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
    // ✅ 第一步：驗證管理員身分與權限
    const { admin } = await verifyAdminAccess(req, ['owner', 'super_admin', 'store_manager']);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { orderId, newStatus, oldStatus } = await req.json();

    console.log(`訂單 ${orderId} 狀態變更: ${oldStatus} -> ${newStatus} (操作人: ${admin.name})`);

    const { data: orderItems, error: itemsError } = await supabase
      .from("order_items")
      .select("equipment_item_id")
      .eq("order_id", orderId)
      .not("equipment_item_id", "is", null);

    if (itemsError) {
      throw new Error(`獲取訂單品項失敗: ${itemsError.message}`);
    }

    if (!orderItems || orderItems.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "此訂單沒有關聯的品項" 
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const equipmentItemIds = orderItems.map(item => item.equipment_item_id);
    let newEquipmentStatus: string | null = null;

    if (newStatus === 'confirmed' || newStatus === 'rented') {
      newEquipmentStatus = 'rented';
    } else if (newStatus === 'completed') {
      newEquipmentStatus = 'available';
    } else if (newStatus === 'cancelled') {
      newEquipmentStatus = 'available';
    }

    if (newEquipmentStatus) {
      const { error: updateError } = await supabase
        .from("equipment_items")
        .update({ status: newEquipmentStatus })
        .in("id", equipmentItemIds);

      if (updateError) {
        throw new Error(`更新品項狀態失敗: ${updateError.message}`);
      }

      console.log(`✅ 管理員 ${admin.name} (${admin.role}) 已更新 ${equipmentItemIds.length} 個品項狀態為: ${newEquipmentStatus}`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `已更新 ${equipmentItemIds.length} 個品項狀態`,
        updatedStatus: newEquipmentStatus,
        itemCount: equipmentItemIds.length,
        performedBy: {
          adminId: admin.id,
          adminName: admin.name,
          adminRole: admin.role,
        },
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("錯誤:", error);
    
    if (error.status === 401 || error.status === 403) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: error.message 
      }),
      { 
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" } 
      }
    );
  }
});