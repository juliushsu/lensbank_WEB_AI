import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    // ✅ 第一步：驗證管理員身分與權限（只允許 owner 和 super_admin）
    const { admin } = await verifyAdminAccess(req, ['owner', 'super_admin']);

    const { email, password, customerId } = await req.json();

    if (!email || !password || !customerId) {
      return new Response(
        JSON.stringify({ error: "缺少必要欄位：email、password、customerId" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (password.length < 6) {
      return new Response(
        JSON.stringify({ error: "密碼長度至少需要 6 個字元" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    const { data: existingUsers, error: listError } = await supabaseAdmin.auth.admin.listUsers();
    
    if (listError) {
      console.error("查詢使用者失敗:", listError);
      return new Response(
        JSON.stringify({ error: "查詢使用者失敗" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const emailExists = existingUsers.users.some(
      (user) => user.email?.toLowerCase() === email.toLowerCase()
    );

    if (emailExists) {
      return new Response(
        JSON.stringify({ error: "此 Email 已被註冊，無法重複建立帳號" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
      email: email,
      password: password,
      email_confirm: true,
      user_metadata: {
        customer_id: customerId,
      },
    });

    if (authError) {
      console.error("建立帳號失敗:", authError);
      return new Response(
        JSON.stringify({ error: `建立帳號失敗：${authError.message}` }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateError } = await supabaseAdmin
      .from("customers")
      .update({ 
        auth_user_id: authData.user.id,
        updated_at: new Date().toISOString()
      })
      .eq("id", customerId);

    if (updateError) {
      console.error("更新客戶資料失敗:", updateError);
      await supabaseAdmin.auth.admin.deleteUser(authData.user.id);
      return new Response(
        JSON.stringify({ error: "更新客戶資料失敗，帳號建立已取消" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`✅ 管理員 ${admin.name} (${admin.role}) 為客戶 ${customerId} 建立登入帳號成功`);

    return new Response(
      JSON.stringify({
        success: true,
        message: "登入帳號建立成功",
        authId: authData.user.id,
        performedBy: {
          adminId: admin.id,
          adminName: admin.name,
          adminRole: admin.role,
        },
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("Edge function error:", error);
    
    if (error.status === 401 || error.status === 403) {
      return new Response(
        JSON.stringify({ error: error.message }),
        { status: error.status, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    
    return new Response(
      JSON.stringify({ error: "伺服器錯誤，請稍後再試" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});