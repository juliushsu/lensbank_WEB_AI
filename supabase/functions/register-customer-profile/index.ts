import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

/**
 * register-customer-profile
 *
 * 供前端自助註冊流程呼叫。
 * 呼叫者必須是剛完成 signUp / email 確認的客戶本人（Bearer = 客戶的 JWT）。
 *
 * 行為：
 *   - 若 customers 記錄尚不存在 → INSERT
 *   - 若 customers 記錄已存在   → 直接 skip（回傳 skipped: true）
 *
 * 傳入欄位：
 *   { name, email, phone, company?, avatar_url? }
 */

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  try {
    // ── 1. 驗證呼叫者的 JWT（客戶本人）
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: "缺少身分驗證標頭" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const token = authHeader.replace("Bearer ", "");
    const supabaseUser = createClient(supabaseUrl, anonKey);
    const { data: { user }, error: authError } = await supabaseUser.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: "身分驗證失敗，請重新登入" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 2. 解析 body
    const body = await req.json();
    const {
      name,
      email,
      phone,
      company = null,
      avatar_url = null,
    } = body;

    if (!name || !email || !phone) {
      return new Response(
        JSON.stringify({ error: "缺少必要欄位：name、email、phone" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 3. 使用 service role 操作 DB（繞過 RLS）
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // ── 4. 檢查是否已存在
    const { data: existing, error: checkError } = await supabaseAdmin
      .from("customers")
      .select("id")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (checkError) {
      console.error("查詢客戶記錄失敗:", checkError);
      return new Response(
        JSON.stringify({ error: "查詢客戶記錄時發生錯誤" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 5a. 已存在 → skip
    if (existing) {
      console.log(`[register-customer-profile] ✅ 客戶已存在，跳過建立 (auth_user_id=${user.id})`);
      return new Response(
        JSON.stringify({ success: true, skipped: true, customerId: existing.id }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // ── 5b. 不存在 → INSERT
    const { data: inserted, error: insertError } = await supabaseAdmin
      .from("customers")
      .insert({
        auth_user_id: user.id,
        name: name.trim(),
        email: email.toLowerCase().trim(),
        phone: phone.trim(),
        company: company?.trim() || null,
        avatar_url: avatar_url || null,
        member_level: "normal",
        discount: 100,
        status: "active",
        total_orders: 0,
        total_spent: 0,
        total_deposit: 0,
        registered_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("建立客戶記錄失敗:", insertError);
      return new Response(
        JSON.stringify({ error: `建立客戶記錄失敗：${insertError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[register-customer-profile] ✅ 客戶建立成功 (id=${inserted.id}, auth_user_id=${user.id})`);

    return new Response(
      JSON.stringify({ success: true, skipped: false, customerId: inserted.id }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error("[register-customer-profile] 未預期錯誤:", err);
    return new Response(
      JSON.stringify({ error: "伺服器錯誤，請稍後再試" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
