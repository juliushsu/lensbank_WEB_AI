import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ── CORS ──────────────────────────────────────────────────────────────────────
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonResp(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── 型別 ─────────────────────────────────────────────────────────────────────

type StatusColor =
  | "green"
  | "yellow"
  | "orange"
  | "red"
  | "purple";

type AttendanceState =
  | "absent"
  | "completed"
  | "checked_in_only"
  | "missing_checkin"
  | "missing_checkout";

/**
 * RiskFlag — 風險原因（可多選陣列）
 *
 * 三欄位語意分層：
 *   attendance_state → 業務狀態（流程）
 *   status_color     → 風險層級（稽核，單一最嚴重值）
 *   risk_flags       → 風險原因（稽核，可同時成立多個）
 *
 * 規則：
 *   missing_checkin  ← is_missing_checkin = true
 *   missing_checkout ← is_missing_checkout = true
 *   out_of_range     ← is_out_of_range = true
 *   cross_location   ← is_cross_location = true
 *   late             ← is_late = true
 *   early_leave      ← is_early_leave = true
 *   has_adjustment   ← adjustment_count > 0（任意補卡）
 *   self_adjustment  ← has_self_adjustment = true（主管自補，在 has_adjustment 之上疊加）
 */
type RiskFlag =
  | "missing_checkin"
  | "missing_checkout"
  | "out_of_range"
  | "cross_location"
  | "late"
  | "early_leave"
  | "has_adjustment"
  | "self_adjustment";

// ── 出勤規則 ──────────────────────────────────────────────────────────────────
const LATE_THRESHOLD        = "09:10";
const EARLY_LEAVE_THRESHOLD = "17:50";

// ── UTC ISO → 台灣 YYYY-MM-DD ─────────────────────────────────────────────────
function toTWDate(iso: string): string {
  return new Date(iso).toLocaleDateString("zh-TW", {
    timeZone: "Asia/Taipei",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).replace(/\//g, "-");
}

// ── UTC ISO → 台灣 HH:MM ─────────────────────────────────────────────────────
function toTWTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("zh-TW", {
    timeZone: "Asia/Taipei",
    hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

// ── attendance_state ─────────────────────────────────────────────────────────
function resolveAttendanceState(
  check_in_at: string | null,
  check_out_at: string | null,
  itemDate: string,
  today: string,
): AttendanceState {
  const hasIn  = check_in_at  !== null;
  const hasOut = check_out_at !== null;
  const isToday = itemDate === today;

  if (!hasIn && !hasOut) return "absent";
  if ( hasIn &&  hasOut) return "completed";
  if (!hasIn &&  hasOut) return "missing_checkin";
  return isToday ? "checked_in_only" : "missing_checkout";
}

// ── status_color（優先序：purple > red > orange > yellow > green）─────────────
function resolveStatusColor(opts: {
  has_self_adjustment: boolean;
  is_missing_checkin:  boolean;
  is_missing_checkout: boolean;
  is_out_of_range:     boolean;
  is_cross_location:   boolean;
  adjustment_count:    number;
}): StatusColor {
  if (opts.has_self_adjustment)                             return "purple";
  if (opts.is_missing_checkin || opts.is_missing_checkout)  return "red";
  if (opts.is_out_of_range    || opts.is_cross_location)    return "orange";
  if (opts.adjustment_count   >  0)                        return "yellow";
  return "green";
}

// ── risk_flags（風險原因，可多選）────────────────────────────────────────────
// 規則：各 flag 彼此獨立，同時成立時全部列出
// has_adjustment = adjustment_count > 0（含 self_adjustment）
// self_adjustment = has_self_adjustment = true（疊加在 has_adjustment 之上）
function resolveRiskFlags(opts: {
  is_missing_checkin:  boolean;
  is_missing_checkout: boolean;
  is_out_of_range:     boolean;
  is_cross_location:   boolean;
  is_late:             boolean;
  is_early_leave:      boolean;
  adjustment_count:    number;
  has_self_adjustment: boolean;
}): RiskFlag[] {
  const flags: RiskFlag[] = [];
  if (opts.is_missing_checkin)  flags.push("missing_checkin");
  if (opts.is_missing_checkout) flags.push("missing_checkout");
  if (opts.is_out_of_range)     flags.push("out_of_range");
  if (opts.is_cross_location)   flags.push("cross_location");
  if (opts.is_late)             flags.push("late");
  if (opts.is_early_leave)      flags.push("early_leave");
  if (opts.adjustment_count > 0) {
    flags.push("has_adjustment");
    if (opts.has_self_adjustment) flags.push("self_adjustment");
  }
  return flags;
}

// ── 日期範圍 ──────────────────────────────────────────────────────────────────
function getDatesInRange(fromDate: string, toDate: string): string[] {
  const dates: string[] = [];
  const cur = new Date(`${fromDate}T00:00:00+08:00`);
  const end = new Date(`${toDate}T00:00:00+08:00`);
  while (cur <= end) {
    dates.push(toTWDate(cur.toISOString()));
    cur.setDate(cur.getDate() + 1);
  }
  return dates;
}

// ── 角色白名單 ────────────────────────────────────────────────────────────────
const ALLOWED_ROLES = new Set(["owner", "super_admin", "store_manager"]);
const GLOBAL_ROLES  = new Set(["owner", "super_admin"]);

// ── DailyItem 型別 ────────────────────────────────────────────────────────────
interface DailyItem {
  id: string;
  date: string;

  employee_id: string;
  employee_name: string;
  employee_role: string;
  employee_attendance_tracking_enabled: boolean;
  employee_visibility_scope: string;

  home_location_id: string | null;
  home_location_name: string | null;
  location_id: string | null;
  location_name: string | null;

  check_in_at: string | null;
  check_out_at: string | null;
  check_in_log_id: string | null;
  check_out_log_id: string | null;

  distance_m: number | null;
  is_within_range: boolean | null;
  record_source: string;

  // ── 稽核 boolean ──
  is_late: boolean;
  is_early_leave: boolean;
  is_missing_checkin: boolean;
  is_missing_checkout: boolean;
  is_cross_location: boolean;
  is_out_of_range: boolean;

  // ── 補卡 ──
  adjustment_count: number;
  has_self_adjustment: boolean;

  // ── 三欄位核心語意 ──
  attendance_state: AttendanceState; // 業務狀態（流程）
  status_color: StatusColor;         // 風險層級（稽核，單一最嚴重值）
  risk_flags: RiskFlag[];            // 風險原因（稽核，可多選）
}

// =============================================================================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const supabaseUrl    = Deno.env.get("SUPABASE_URL")             ?? "";
  const anonKey        = Deno.env.get("SUPABASE_ANON_KEY")        ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  // ── STEP 1: 驗 JWT ─────────────────────────────────────────────────────────
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

  const db = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ── STEP 2: actor ──────────────────────────────────────────────────────────
  const { data: actor, error: actorErr } = await db
    .from("admin_profiles")
    .select("id, role, assigned_location_id, is_active")
    .eq("auth_user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();

  if (actorErr || !actor) {
    return jsonResp({ success: false, error: "actor_not_found", message: "找不到操作者的管理員資料" }, 403);
  }

  // ── STEP 3: 角色驗證 ───────────────────────────────────────────────────────
  if (!ALLOWED_ROLES.has(actor.role)) {
    return jsonResp({
      success: false, error: "forbidden",
      message: `角色 "${actor.role}" 無查看出勤列表權限`,
    }, 403);
  }
  const isGlobal = GLOBAL_ROLES.has(actor.role);

  // ── STEP 4: params ─────────────────────────────────────────────────────────
  const url        = new URL(req.url);
  const dateSingle = url.searchParams.get("date");
  const dateFrom   = url.searchParams.get("date_from") ?? dateSingle;
  const dateTo     = url.searchParams.get("date_to")   ?? dateSingle;
  const empFilter  = url.searchParams.get("employee_id") ?? null;
  const locFilter  = url.searchParams.get("location_id") ?? null;

  const dateRe = /^\d{4}-\d{2}-\d{2}$/;
  if (!dateFrom || !dateTo || !dateRe.test(dateFrom) || !dateRe.test(dateTo)) {
    return jsonResp({
      success: false, error: "invalid_params",
      message: "需提供 date (YYYY-MM-DD) 或 date_from + date_to",
    }, 400);
  }
  if (dateFrom > dateTo) {
    return jsonResp({ success: false, error: "invalid_params", message: "date_from 不可晚於 date_to" }, 400);
  }

  const taiwanToday = toTWDate(new Date().toISOString());
  const tzFrom = `${dateFrom}T00:00:00+08:00`;
  const tzTo   = `${dateTo}T23:59:59+08:00`;
  const allDates = getDatesInRange(dateFrom, dateTo);

  // ── STEP 5: 員工清單 ───────────────────────────────────────────────────────
  let profilesQuery = db
    .from("admin_profiles")
    .select(`
      id, name, role,
      assigned_location_id,
      attendance_tracking_enabled,
      attendance_visibility_scope,
      loc:locations!admin_profiles_assigned_location_id_fkey(id, name_zh)
    `)
    .eq("is_active", true)
    .eq("attendance_tracking_enabled", true);

  if (!isGlobal) {
    profilesQuery = profilesQuery.eq("assigned_location_id", actor.assigned_location_id);
  }
  if (empFilter) profilesQuery = profilesQuery.eq("id", empFilter);

  const { data: profiles, error: profilesErr } = await profilesQuery;
  if (profilesErr) {
    return jsonResp({ success: false, error: "db_error", message: "查詢員工資料失敗" }, 500);
  }
  if (!profiles || profiles.length === 0) {
    return jsonResp({ success: true, data: { items: [] } });
  }

  const profileMap = new Map<string, any>();
  for (const p of profiles) profileMap.set(p.id, p);
  const profileIds = Array.from(profileMap.keys());

  // ── STEP 6: 並行撈 logs + adjustments ────────────────────────────────────
  const [logsResult, adjResult] = await Promise.all([
    db
      .from("attendance_logs")
      .select(`
        id, admin_profile_id, location_id, check_type, checked_at,
        distance_m, is_within_range, is_valid,
        record_source, is_adjusted,
        loc:locations!attendance_logs_location_id_fkey(id, name_zh)
      `)
      .gte("checked_at", tzFrom)
      .lte("checked_at", tzTo)
      .in("admin_profile_id", profileIds)
      .then((r) => {
        if (locFilter && r.data) {
          r.data = r.data.filter((row: any) => row.location_id === locFilter);
        }
        return r;
      }),

    db
      .from("attendance_adjustments")
      .select(`
        id, is_self_adjustment, adjusted_checked_at,
        log:attendance_logs!attendance_adjustments_attendance_log_id_fkey(admin_profile_id)
      `)
      .gte("adjusted_checked_at", tzFrom)
      .lte("adjusted_checked_at", tzTo),
  ]);

  const { data: logs, error: logsErr } = logsResult;
  if (logsErr) {
    return jsonResp({ success: false, error: "db_error", message: "查詢打卡記錄失敗" }, 500);
  }

  // ── STEP 7: adjustment stats ──────────────────────────────────────────────
  interface AdjStat { count: number; has_self: boolean; }
  const adjStatMap = new Map<string, AdjStat>();

  for (const adj of ((adjResult.data ?? []) as any[])) {
    const logOwner: string | null = adj.log?.admin_profile_id ?? null;
    if (!logOwner || !profileIds.includes(logOwner)) continue;
    const adjDate = toTWDate(adj.adjusted_checked_at);
    const key = `${logOwner}::${adjDate}`;
    const ex = adjStatMap.get(key) ?? { count: 0, has_self: false };
    adjStatMap.set(key, {
      count:    ex.count + 1,
      has_self: ex.has_self || (adj.is_self_adjustment === true),
    });
  }

  // ── STEP 8: 初始化每人每日（absent 底稿）────────────────────────────────
  const dailyMap = new Map<string, DailyItem>();

  for (const [profileId, profile] of profileMap) {
    for (const d of allDates) {
      const key = `${profileId}::${d}`;
      dailyMap.set(key, {
        id: key,
        date: d,
        employee_id: profileId,
        employee_name: profile.name ?? "—",
        employee_role: profile.role,
        employee_attendance_tracking_enabled: profile.attendance_tracking_enabled ?? false,
        employee_visibility_scope: profile.attendance_visibility_scope ?? "store",
        home_location_id:   profile.assigned_location_id ?? null,
        home_location_name: (profile as any).loc?.name_zh ?? null,
        location_id:   null,
        location_name: null,
        check_in_at:      null,
        check_out_at:     null,
        check_in_log_id:  null,
        check_out_log_id: null,
        distance_m:      null,
        is_within_range: null,
        record_source: "line_liff",
        is_late:            false,
        is_early_leave:     false,
        is_missing_checkin:  true,
        is_missing_checkout: true,
        is_cross_location:  false,
        is_out_of_range:    false,
        adjustment_count:    0,
        has_self_adjustment: false,
        attendance_state: "absent",
        status_color:     "green",
        risk_flags:       [],
      });
    }
  }

  // ── STEP 9: 填入 log 資料 ─────────────────────────────────────────────────
  for (const row of ((logs ?? []) as any[])) {
    const rowDate = toTWDate(row.checked_at);
    const key = `${row.admin_profile_id}::${rowDate}`;
    const entry = dailyMap.get(key);
    if (!entry) continue;

    if (!entry.location_id || row.check_type === "check_in") {
      entry.location_id   = row.location_id;
      entry.location_name = (row as any).loc?.name_zh ?? null;
    }
    if (row.check_type === "check_in") {
      entry.check_in_at        = row.checked_at;
      entry.check_in_log_id    = row.id;
      entry.distance_m         = row.distance_m;
      entry.is_within_range    = row.is_within_range;
      entry.is_missing_checkin = false;
    }
    if (row.check_type === "check_out") {
      entry.check_out_at        = row.checked_at;
      entry.check_out_log_id    = row.id;
      entry.is_missing_checkout = false;
    }
    if (row.record_source === "line_liff") {
      entry.record_source = "line_liff";
    } else if (entry.record_source !== "line_liff") {
      entry.record_source = row.record_source ?? "manual";
    }
  }

  // ── STEP 10: 後端計算所有稽核欄位 + 三欄位語意 ───────────────────────────
  for (const [key, entry] of dailyMap) {
    // adjustment stats
    const adjStat = adjStatMap.get(key);
    entry.adjustment_count   = adjStat?.count    ?? 0;
    entry.has_self_adjustment = adjStat?.has_self ?? false;

    // 稽核 boolean
    if (entry.check_in_at)  entry.is_late        = toTWTime(entry.check_in_at)  > LATE_THRESHOLD;
    if (entry.check_out_at) entry.is_early_leave  = toTWTime(entry.check_out_at) < EARLY_LEAVE_THRESHOLD;
    if (entry.location_id && entry.home_location_id) {
      entry.is_cross_location = entry.location_id !== entry.home_location_id;
    }
    entry.is_out_of_range = entry.is_within_range === false;

    // ── 三欄位語意（後端唯一計算點）──────────────────────────────────────────

    // 1. attendance_state — 業務狀態（流程）
    entry.attendance_state = resolveAttendanceState(
      entry.check_in_at, entry.check_out_at, entry.date, taiwanToday,
    );

    // 2. status_color — 風險層級（稽核，單一最嚴重值）
    entry.status_color = resolveStatusColor({
      has_self_adjustment:  entry.has_self_adjustment,
      is_missing_checkin:   entry.is_missing_checkin,
      is_missing_checkout:  entry.is_missing_checkout,
      is_out_of_range:      entry.is_out_of_range,
      is_cross_location:    entry.is_cross_location,
      adjustment_count:     entry.adjustment_count,
    });

    // 3. risk_flags — 風險原因（稽核，可同時多個）
    entry.risk_flags = resolveRiskFlags({
      is_missing_checkin:  entry.is_missing_checkin,
      is_missing_checkout: entry.is_missing_checkout,
      is_out_of_range:     entry.is_out_of_range,
      is_cross_location:   entry.is_cross_location,
      is_late:             entry.is_late,
      is_early_leave:      entry.is_early_leave,
      adjustment_count:    entry.adjustment_count,
      has_self_adjustment: entry.has_self_adjustment,
    });
  }

  // ── 排序：日期降序 → 員工名稱 ────────────────────────────────────────────
  const items: DailyItem[] = Array.from(dailyMap.values()).sort((a, b) => {
    if (b.date !== a.date) return b.date.localeCompare(a.date);
    return a.employee_name.localeCompare(b.employee_name, "zh-TW");
  });

  console.log(
    `[attendance-list] ✅ ${dateFrom}~${dateTo}` +
    ` actor=${actor.id} role=${actor.role}` +
    ` employees=${profileMap.size} days=${allDates.length} items=${items.length}`,
  );

  return jsonResp({ success: true, data: { items } });
});
