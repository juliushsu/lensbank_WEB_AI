import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResp(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── Status color 計算（後端唯一真相來源）────────────────────────────────────
type StatusColor = "green" | "yellow" | "orange" | "red" | "purple";

function resolveColor(newCount: number, isSelf: boolean): StatusColor {
  if (isSelf)         return "purple";
  if (newCount >= 6)  return "red";
  if (newCount >= 3)  return "orange";
  return "yellow";
}

// ── Payload 型別 ─────────────────────────────────────────────────────────────
interface AdjustPayload {
  mode: "fix" | "new";
  attendance_log_id: string | null;  // fix 必填
  employee_id: string;               // new 必填
  location_id?: string;              // new 必填
  adjustment_type: "check_in" | "check_out";
  adjusted_checked_at: string;       // ISO 8601
  reason_category: string;
  reason: string;
  is_self_adjustment: boolean;
}

// ── 允許執行補卡的角色 ────────────────────────────────────────────────────────
// 對應 admin_profiles.role 的實際 DB enum 值：
//   owner / super_admin / store_manager / staff / part_time
// ⚠️  修正前錯誤地寫成 "manager"，現已改為正確的 "store_manager"
const ALLOWED_ROLES = new Set(["store_manager", "owner", "super_admin"]);

// store_manager 有 scope 限制（只能操作自己 assigned_location_id 的紀錄）
// owner / super_admin 為全域，不受 scope 限制
const GLOBAL_ROLES = new Set(["owner", "super_admin"]);

// =============================================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl    = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey        = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // ── STEP 1: 驗 JWT → 取得 auth_user_id ───────────────────────────────────
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return jsonResp({ success: false, error: "unauthorized", message: "缺少 Authorization header" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");
  const supabaseAnon = createClient(supabaseUrl, anonKey);
  const { data: { user }, error: authError } = await supabaseAnon.auth.getUser(token);

  if (authError || !user) {
    return jsonResp({ success: false, error: "unauthorized", message: "JWT 驗證失敗，請重新登入" }, 401);
  }

  // 後續所有 DB 操作使用 service_role（bypass RLS，後端自行驗權限）
  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── STEP 2: 解析 body ────────────────────────────────────────────────────
  let payload: AdjustPayload;
  try {
    payload = await req.json();
  } catch {
    return jsonResp({ success: false, error: "invalid_body", message: "請求格式錯誤" }, 400);
  }

  const {
    mode,
    attendance_log_id,
    employee_id,
    location_id,
    adjustment_type,
    adjusted_checked_at,
    reason_category,
    reason,
    is_self_adjustment,
  } = payload;

  // ── STEP 3: 基本欄位驗證 ────────────────────────────────────────────────
  if (!mode || !["fix", "new"].includes(mode)) {
    return jsonResp({ success: false, error: "invalid_payload", message: "mode 必須為 fix 或 new" }, 400);
  }
  if (mode === "fix" && !attendance_log_id) {
    return jsonResp({ success: false, error: "invalid_payload", message: "fix 模式需提供 attendance_log_id" }, 400);
  }
  if (mode === "new" && (!employee_id || !location_id)) {
    return jsonResp({ success: false, error: "invalid_payload", message: "new 模式需提供 employee_id 與 location_id" }, 400);
  }
  if (!adjustment_type || !["check_in", "check_out"].includes(adjustment_type)) {
    return jsonResp({ success: false, error: "invalid_payload", message: "adjustment_type 必須為 check_in 或 check_out" }, 400);
  }
  if (!adjusted_checked_at || isNaN(Date.parse(adjusted_checked_at))) {
    return jsonResp({ success: false, error: "invalid_payload", message: "adjusted_checked_at 格式不正確" }, 400);
  }
  if (!reason_category || !reason?.trim()) {
    return jsonResp({ success: false, error: "invalid_payload", message: "reason_category 與 reason 為必填" }, 400);
  }

  // ── STEP 4: 查 admin_profiles 取得 actor ─────────────────────────────────
  // auth_user_id = auth.users.id（JWT sub），為系統唯一身份來源
  const { data: actor, error: actorErr } = await db
    .from("admin_profiles")
    .select("id, role, assigned_location_id, is_active")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (actorErr || !actor) {
    console.error("[attendance-adjust] actor 查詢失敗:", actorErr);
    return jsonResp({ success: false, error: "actor_not_found", message: "找不到操作者的管理員資料" }, 403);
  }

  // ── STEP 5: 角色權限驗證 ─────────────────────────────────────────────────
  // 允許角色（對應 DB 實際 enum 值）：store_manager / owner / super_admin
  if (!ALLOWED_ROLES.has(actor.role)) {
    return jsonResp({
      success: false,
      error: "forbidden",
      message: `角色 "${actor.role}" 無補卡權限，需要 store_manager / owner / super_admin`,
    }, 403);
  }

  // isGlobal = true → owner / super_admin，不受門市 scope 限制
  // isGlobal = false → store_manager，只能操作 assigned_location_id 範圍
  const isGlobal = GLOBAL_ROLES.has(actor.role);

  // ── STEP 6: 依 mode 執行操作 ────────────────────────────────────────────
  if (mode === "fix") {
    // ── FIX：修正既有打卡時間 ───────────────────────────────────────────

    // 6a. 取出原始 log（確認存在 + location / 原始時間 / 目前 count）
    const { data: existingLog, error: logFetchErr } = await db
      .from("attendance_logs")
      .select("id, location_id, checked_at, adjustment_count, check_type")
      .eq("id", attendance_log_id!)
      .maybeSingle();

    if (logFetchErr || !existingLog) {
      return jsonResp({ success: false, error: "log_not_found", message: "找不到指定的打卡紀錄" }, 404);
    }

    // 6b. store_manager scope 驗證：只能修自己門市的紀錄
    if (!isGlobal && existingLog.location_id !== actor.assigned_location_id) {
      return jsonResp({
        success: false,
        error: "scope_violation",
        message: `store_manager 只能修改 assigned_location（${actor.assigned_location_id}）的打卡紀錄`,
      }, 403);
    }

    // 6c. adjustment_type 必須與原 log 的 check_type 一致
    if (existingLog.check_type !== adjustment_type) {
      return jsonResp({
        success: false,
        error: "type_mismatch",
        message: `此紀錄為 ${existingLog.check_type}，不可用 ${adjustment_type} 修正`,
      }, 400);
    }

    // 6d. 更新 attendance_logs
    const newCount = existingLog.adjustment_count + 1;
    const newColor = resolveColor(newCount, is_self_adjustment);

    const { error: updateErr } = await db
      .from("attendance_logs")
      .update({
        checked_at:       adjusted_checked_at,
        record_source:    "manual",
        is_adjusted:      true,
        adjustment_count: newCount,
        status_color:     newColor,
        updated_at:       new Date().toISOString(),
      })
      .eq("id", attendance_log_id!);

    if (updateErr) {
      console.error("[attendance-adjust] update log 失敗:", updateErr);
      return jsonResp({ success: false, error: "db_error", message: "打卡紀錄更新失敗" }, 500);
    }

    // 6e. Insert attendance_adjustments（稽核記錄，永不覆蓋原始 log）
    const { error: adjInsertErr } = await db
      .from("attendance_adjustments")
      .insert({
        attendance_log_id:             attendance_log_id,
        admin_profile_id:              actor.id,
        adjustment_mode:               "fix",
        adjustment_type:               adjustment_type,
        original_checked_at:           existingLog.checked_at,
        adjusted_checked_at:           adjusted_checked_at,
        reason_category:               reason_category,
        reason:                        reason.trim(),
        is_self_adjustment:            is_self_adjustment,
        requested_by_admin_profile_id: actor.id,
      });

    if (adjInsertErr) {
      // 主操作（log update）已成功，稽核記錄失敗不 rollback，回傳 warning
      console.error("[attendance-adjust] insert adjustment 失敗:", adjInsertErr);
      return jsonResp({
        success: true,
        warning: "稽核記錄寫入失敗，打卡已更新，請通知系統管理員",
        new_status_color: newColor,
      }, 200);
    }

    console.log(
      `[attendance-adjust] ✅ fix logId=${attendance_log_id}` +
      ` actor=${actor.id} role=${actor.role} newColor=${newColor} count=${newCount}`
    );
    return jsonResp({ success: true, mode: "fix", new_status_color: newColor }, 200);

  } else {
    // ── NEW：補建缺失打卡紀錄 ────────────────────────────────────────────

    // 6a. store_manager scope 驗證
    if (!isGlobal && location_id !== actor.assigned_location_id) {
      return jsonResp({
        success: false,
        error: "scope_violation",
        message: `store_manager 只能在 assigned_location（${actor.assigned_location_id}）補建打卡`,
      }, 403);
    }

    // 6b. 確認目標員工存在
    const { data: targetEmp, error: empErr } = await db
      .from("admin_profiles")
      .select("id, assigned_location_id")
      .eq("id", employee_id)
      .maybeSingle();

    if (empErr || !targetEmp) {
      return jsonResp({ success: false, error: "employee_not_found", message: "找不到員工資料" }, 404);
    }

    // 6c. Insert 新 attendance_log（標記為補建）
    const newColor = resolveColor(1, is_self_adjustment);

    const { data: newLog, error: logInsertErr } = await db
      .from("attendance_logs")
      .insert({
        admin_profile_id: employee_id,
        location_id:      location_id,
        check_type:       adjustment_type,
        checked_at:       adjusted_checked_at,
        is_valid:         true,
        record_source:    "manual",
        is_adjusted:      true,
        adjustment_count: 1,
        status_color:     newColor,
      })
      .select("id")
      .maybeSingle();

    if (logInsertErr || !newLog) {
      console.error("[attendance-adjust] insert new log 失敗:", logInsertErr);
      return jsonResp({ success: false, error: "db_error", message: "補建打卡紀錄失敗" }, 500);
    }

    // 6d. Insert attendance_adjustments
    const { error: adjInsertErr } = await db
      .from("attendance_adjustments")
      .insert({
        attendance_log_id:             newLog.id,
        admin_profile_id:              actor.id,
        adjustment_mode:               "new",
        adjustment_type:               adjustment_type,
        original_checked_at:           null,
        adjusted_checked_at:           adjusted_checked_at,
        target_location_id:            location_id,
        reason_category:               reason_category,
        reason:                        reason.trim(),
        is_self_adjustment:            is_self_adjustment,
        created_manual_log_id:         newLog.id,
        requested_by_admin_profile_id: actor.id,
      });

    if (adjInsertErr) {
      console.error("[attendance-adjust] insert adjustment 失敗:", adjInsertErr);
      return jsonResp({
        success: true,
        warning: "稽核記錄寫入失敗，補建記錄已建立，請通知系統管理員",
        new_log_id:       newLog.id,
        new_status_color: newColor,
      }, 200);
    }

    console.log(
      `[attendance-adjust] ✅ new newLogId=${newLog.id}` +
      ` actor=${actor.id} role=${actor.role} newColor=${newColor}`
    );
    return jsonResp({ success: true, mode: "new", new_log_id: newLog.id, new_status_color: newColor }, 200);
  }
});
