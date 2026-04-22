import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

async function sha256Hex(text: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(text);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json();
    const { line_uid, bind_token } = body as { line_uid?: string; bind_token?: string };

    if (!line_uid) {
      return new Response(JSON.stringify({ error: "line_uid is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Case B: Bind token flow ─────────────────────────────────────────────
    if (bind_token) {
      const tokenHash = await sha256Hex(bind_token.trim());

      const { data: tokenRow, error: tokenErr } = await supabase
        .from("line_binding_tokens")
        .select("id, admin_profile_id, expires_at, used_at, invalidated_at")
        .eq("token_hash", tokenHash)
        .is("used_at", null)
        .is("invalidated_at", null)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();

      if (tokenErr || !tokenRow) {
        return new Response(
          JSON.stringify({ bound: false, error: "綁定碼無效或已過期，請重新取得" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 確認 line_uid 未被其他員工使用
      const { data: existingBound } = await supabase
        .from("admin_profiles")
        .select("id")
        .eq("line_user_id", line_uid)
        .maybeSingle();

      if (existingBound && existingBound.id !== tokenRow.admin_profile_id) {
        return new Response(
          JSON.stringify({ bound: false, error: "此 LINE 帳號已綁定其他員工帳號" }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 寫入 line_user_id
      const { error: updateErr } = await supabase
        .from("admin_profiles")
        .update({ line_user_id: line_uid, updated_at: new Date().toISOString() })
        .eq("id", tokenRow.admin_profile_id);

      if (updateErr) {
        console.error("[liff-identity] update error:", updateErr);
        return new Response(
          JSON.stringify({ bound: false, error: "綁定失敗，請稍後再試" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      // 標記 token 為已使用
      await supabase
        .from("line_binding_tokens")
        .update({ used_at: new Date().toISOString() })
        .eq("id", tokenRow.id);

      // 取得員工資料 + 門市名稱
      const { data: profile } = await supabase
        .from("admin_profiles")
        .select("id, name, role, assigned_location_id, locations!assigned_location_id(name_zh, name_ja)")
        .eq("id", tokenRow.admin_profile_id)
        .maybeSingle();

      const loc = profile?.locations as { name_zh?: string; name_ja?: string } | null;
      const locationName = loc?.name_zh || loc?.name_ja || null;

      return new Response(
        JSON.stringify({
          bound: true,
          admin_profile_id: profile?.id,
          name: profile?.name,
          role: profile?.role,
          location_name: locationName,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Case A: Identity lookup ──────────────────────────────────────────────
    const { data: profile, error: profileErr } = await supabase
      .from("admin_profiles")
      .select("id, name, role, assigned_location_id, locations!assigned_location_id(name_zh, name_ja)")
      .eq("line_user_id", line_uid)
      .eq("is_active", true)
      .maybeSingle();

    if (profileErr || !profile) {
      return new Response(
        JSON.stringify({ bound: false }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const loc = profile.locations as { name_zh?: string; name_ja?: string } | null;
    const locationName = loc?.name_zh || loc?.name_ja || null;

    return new Response(
      JSON.stringify({
        bound: true,
        admin_profile_id: profile.id,
        name: profile.name,
        role: profile.role,
        location_name: locationName,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("[liff-identity] unexpected error:", e);
    return new Response(
      JSON.stringify({ error: "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
