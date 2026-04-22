import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ok = (data: unknown) =>
  new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const err = (msg: string, status = 400) =>
  new Response(JSON.stringify({ error: msg }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

async function sha256hex(message: string): Promise<string> {
  const buf = new TextEncoder().encode(message);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function generateToken(length = 24): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // ── 驗證 JWT ──────────────────────────────────────────────────────────
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) return err("未授權", 401);
    const jwt = authHeader.slice(7);

    const { data: { user }, error: authErr } = await supabase.auth.getUser(jwt);
    if (authErr || !user) return err("JWT 驗證失敗", 401);

    // ── 取得 caller profile ───────────────────────────────────────────────
    const { data: caller } = await supabase
      .from("admin_profiles")
      .select("id, role, assigned_location_id, is_active")
      .eq("auth_user_id", user.id)
      .maybeSingle();

    if (!caller || !caller.is_active) return err("無效帳號", 403);

    const allowedRoles = ["owner", "super_admin", "store_manager"];
    if (!allowedRoles.includes(caller.role)) return err("權限不足（需要 owner / super_admin / store_manager）", 403);

    // ── 解析 body ─────────────────────────────────────────────────────────
    const body = await req.json().catch(() => ({}));
    const { action, admin_profile_id } = body as { action: string; admin_profile_id: string };

    if (!action || !admin_profile_id) return err("缺少 action 或 admin_profile_id");

    // ── 取得 target profile ───────────────────────────────────────────────
    const { data: target } = await supabase
      .from("admin_profiles")
      .select(`
        id, name, role, assigned_location_id, is_active, line_user_id,
        assigned_location:locations!admin_profiles_assigned_location_id_fkey(name_zh, name_ja)
      `)
      .eq("id", admin_profile_id)
      .maybeSingle();

    if (!target) return err("找不到目標員工", 404);

    // ── store_manager scope 驗證 ──────────────────────────────────────────
    if (caller.role === "store_manager") {
      if (target.assigned_location_id !== caller.assigned_location_id) {
        return err("店長只能管理同門市員工", 403);
      }
    }

    const locationName =
      (target.assigned_location as any)?.name_zh ??
      (target.assigned_location as any)?.name_ja ??
      null;

    const employeeInfo = {
      id:            target.id,
      name:          target.name,
      role:          target.role,
      location_name: locationName,
      line_user_id:  target.line_user_id ?? null,
    };

    // ── action: get_status ────────────────────────────────────────────────
    if (action === "get_status") {
      const { data: latestToken } = await supabase
        .from("line_binding_tokens")
        .select("id, expires_at, used_at, invalidated_at, created_at, created_by_role")
        .eq("admin_profile_id", admin_profile_id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      return ok({ success: true, employee: employeeInfo, latest_token: latestToken ?? null });
    }

    // ── action: create ────────────────────────────────────────────────────
    if (action === "create") {
      if (!target.is_active) return err("目標員工已停用，無法產生綁定碼");

      // 失效所有現存未使用 token
      await supabase
        .from("line_binding_tokens")
        .update({ invalidated_at: new Date().toISOString() })
        .eq("admin_profile_id", admin_profile_id)
        .is("used_at", null)
        .is("invalidated_at", null);

      const plainToken = generateToken(24);
      const tokenHash  = await sha256hex(plainToken);
      const expiresAt  = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 min

      const { error: insertErr } = await supabase
        .from("line_binding_tokens")
        .insert({
          admin_profile_id,
          token_hash:                  tokenHash,
          expires_at:                  expiresAt,
          created_by_auth_user_id:     user.id,
          created_by_admin_profile_id: caller.id,
          created_by_role:             caller.role,
        });

      if (insertErr) return err(`建立失敗：${insertErr.message}`, 500);

      const bindBaseUrl = "https://pvivjq.readdy.co/liff/bind";
      const bindUrl     = `${bindBaseUrl}?bind_token=${plainToken}`;

      return ok({
        success:    true,
        token:      plainToken,
        expires_at: expiresAt,
        bind_url:   bindUrl,
        employee:   employeeInfo,
      });
    }

    // ── action: invalidate ────────────────────────────────────────────────
    if (action === "invalidate") {
      const { count } = await supabase
        .from("line_binding_tokens")
        .update({ invalidated_at: new Date().toISOString() })
        .eq("admin_profile_id", admin_profile_id)
        .is("used_at", null)
        .is("invalidated_at", null);

      return ok({ success: true, invalidated_count: count ?? 0 });
    }

    return err("未知的 action（可用：create / invalidate / get_status）");

  } catch (e) {
    return err(`伺服器錯誤：${String(e)}`, 500);
  }
});
