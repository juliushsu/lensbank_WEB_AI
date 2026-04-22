import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  // 處理 CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    console.log("=== 🚀 Edge Function 開始執行 ===");
    console.log("請求方法:", req.method);
    console.log("請求 URL:", req.url);
    
    // 只接受 POST 請求
    if (req.method !== "POST") {
      console.error("❌ 不支援的請求方法:", req.method);
      return new Response(
        JSON.stringify({ error: "只支援 POST 請求" }),
        { status: 405, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 取得環境變數
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    console.log("環境變數檢查:");
    console.log("- SUPABASE_URL:", supabaseUrl ? "✅ 已設定" : "❌ 未設定");
    console.log("- SERVICE_KEY:", supabaseServiceKey ? "✅ 已設定" : "❌ 未設定");

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("❌ 環境變數未設定");
      return new Response(
        JSON.stringify({ 
          error: "伺服器設定錯誤",
          details: "SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY 未設定"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 驗證 JWT Token
    const authHeader = req.headers.get("Authorization");
    console.log("\n=== 🔐 檢查 Authorization Header ===");
    console.log("Header 存在:", !!authHeader);
    
    if (authHeader) {
      console.log("Header 長度:", authHeader.length);
      console.log("Header 前綴:", authHeader.substring(0, 20) + "...");
    }
    
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.error("❌ Authorization header 格式錯誤或缺失");
      return new Response(
        JSON.stringify({ 
          error: "未授權：缺少身份驗證資訊",
          details: "請確認您已登入管理員帳號",
          code: "MISSING_AUTH_HEADER"
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 建立 Supabase 客戶端
    console.log("\n=== 📦 建立 Supabase 客戶端 ===");
    const adminClient = createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    console.log("✅ Service Role 客戶端已建立");

    // 從 JWT 中取得使用者資訊
    const token = authHeader.replace("Bearer ", "");
    console.log("\n=== 🔍 驗證 JWT Token ===");
    console.log("Token 長度:", token.length);
    
    const { data: { user }, error: userError } = await adminClient.auth.getUser(token);

    if (userError) {
      console.error("\n❌ JWT 驗證失敗");
      console.error("錯誤訊息:", userError.message);
      
      const isExpired = userError.message?.includes("expired") || userError.message?.includes("過期");
      
      return new Response(
        JSON.stringify({ 
          error: isExpired ? "登入已過期" : "身份驗證失敗",
          details: isExpired 
            ? "您的登入已過期，請重新登入後再試" 
            : `Token 驗證失敗：${userError.message}`,
          code: isExpired ? "TOKEN_EXPIRED" : "INVALID_TOKEN"
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!user) {
      console.error("❌ 無法從 Token 取得使用者資訊");
      return new Response(
        JSON.stringify({ 
          error: "身份驗證失敗",
          details: "無法識別使用者身份",
          code: "USER_NOT_FOUND"
        }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ JWT 驗證成功");
    console.log("👤 使用者 ID:", user.id);
    console.log("📧 使用者 Email:", user.email);

    // 確認呼叫者是管理員
    console.log("\n=== 👮 驗證管理員身份 ===");
    const { data: adminProfile, error: adminError } = await adminClient
      .from("admin_profiles")
      .select("id, role, status, name")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (adminError) {
      console.error("❌ 查詢管理員資料失敗:", adminError.message);
      return new Response(
        JSON.stringify({ 
          error: "查詢管理員資料失敗",
          details: adminError.message,
          code: "ADMIN_QUERY_ERROR"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!adminProfile) {
      console.error("❌ 找不到管理員資料");
      return new Response(
        JSON.stringify({ 
          error: "您沒有管理員權限",
          details: "此帳號不是管理員帳號",
          code: "NOT_ADMIN"
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (adminProfile.status !== "active") {
      console.error("❌ 管理員帳號已停用");
      return new Response(
        JSON.stringify({ 
          error: "您的管理員帳號已停用",
          details: "請聯絡系統管理員",
          code: "ADMIN_INACTIVE"
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ 管理員驗證成功:", adminProfile.name);

    // 解析請求內容
    console.log("\n=== 📋 解析請求參數 ===");
    const requestBody = await req.json();
    const { customerId, newPassword } = requestBody;

    console.log("客戶 ID:", customerId);
    console.log("密碼長度:", newPassword?.length);

    // 驗證必要參數
    if (!customerId || !newPassword) {
      console.error("❌ 缺少必要參數");
      return new Response(
        JSON.stringify({ 
          error: "缺少必要參數",
          details: "需要提供 customerId 和 newPassword",
          code: "MISSING_PARAMS"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 驗證密碼長度
    if (newPassword.length < 6) {
      console.error("❌ 密碼長度不足:", newPassword.length);
      return new Response(
        JSON.stringify({ 
          error: "密碼至少需要 6 個字元",
          code: "PASSWORD_TOO_SHORT"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 查詢目標客戶
    console.log("\n=== 🔍 查詢客戶資料 ===");
    const { data: customer, error: customerError } = await adminClient
      .from("customers")
      .select("id, auth_id, name, email")
      .eq("id", customerId)
      .maybeSingle();

    if (customerError) {
      console.error("❌ 查詢客戶資料失敗:", customerError.message);
      return new Response(
        JSON.stringify({ 
          error: "查詢客戶資料失敗",
          details: customerError.message,
          code: "CUSTOMER_QUERY_ERROR"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!customer) {
      console.error("❌ 找不到客戶:", customerId);
      return new Response(
        JSON.stringify({ 
          error: "找不到指定的客戶",
          code: "CUSTOMER_NOT_FOUND"
        }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ 找到目標客戶:", customer.name);

    // 確認客戶已建立登入帳號
    if (!customer.auth_id) {
      console.error("❌ 客戶尚未建立登入帳號");
      return new Response(
        JSON.stringify({ 
          error: "此客戶尚未建立登入帳號",
          details: "請先為客戶建立登入帳號後再變更密碼",
          code: "NO_AUTH_ACCOUNT"
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 執行密碼重設
    console.log("\n=== 🔄 執行密碼重設 ===");
    console.log("Auth ID:", customer.auth_id);
    
    const { error: updateError } = await adminClient.auth.admin.updateUserById(
      customer.auth_id,
      { password: newPassword }
    );

    if (updateError) {
      console.error("❌ 重設密碼失敗:", updateError.message);
      return new Response(
        JSON.stringify({ 
          error: "重設密碼失敗",
          details: updateError.message,
          code: "PASSWORD_UPDATE_ERROR"
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("✅ 密碼重設成功！");
    console.log("=== ✨ 處理完成 ===\n");

    return new Response(
      JSON.stringify({
        success: true,
        message: `已成功重設 ${customer.name} 的密碼`,
        customerName: customer.name,
        customerEmail: customer.email
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (err) {
    console.error("\n=== ❌ Edge Function 發生錯誤 ===");
    console.error("錯誤類型:", err.constructor.name);
    console.error("錯誤訊息:", err.message);
    console.error("錯誤堆疊:", err.stack);
    
    return new Response(
      JSON.stringify({ 
        error: "伺服器內部錯誤",
        details: err.message,
        code: "INTERNAL_ERROR"
      }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});