# API Smoke Test Sequence (Round 1)

## 基準
- 人員母體：`admin_profiles.assigned_location_id`
- 打卡事件：`attendance_logs.location_id`
- 正式主體欄位：`admin_profile_id`
- 相容 alias：`employee_id`（僅過渡）

## 建議角色執行順序
1. `owner`（全域，先驗證）
2. `store_manager`（門市範圍限制）
3. `staff`（若有開放 manager 代補卡）

## 0) 共用變數（範例）
```bash
BASE_URL="https://YOUR-STAGING-API"
OWNER_TOKEN="REPLACE_OWNER_JWT"
MANAGER_TOKEN="REPLACE_MANAGER_JWT"
STAFF_ADMIN_PROFILE_ID="20000000-0000-0000-0000-000000000004"
STORE_LOCATION_ID="11111111-1111-1111-1111-111111111111"
```

## 1) 先讀 LIFF context（官方畫面來源）
```bash
curl "$BASE_URL/api/attendance/me?date=2026-03-24" \
  -H "Authorization: Bearer $OWNER_TOKEN"
```
預期：回傳 `admin_profile.assigned_location_id`、`location.display_name`、`today_latest_valid_log`、`next_expected_check_type`。

## 2) issue line binding token（owner）
```bash
curl -X POST "$BASE_URL/api/admin/line/binding-token" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "admin_profile_id": "'"$STAFF_ADMIN_PROFILE_ID"'",
    "expires_in_minutes": 15
  }'
```
預期：`ok=true` 且回傳 `data.binding_token`。

## 3) line bind（需要有效 LIFF id_token）
```bash
curl -X POST "$BASE_URL/api/line/bind" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "binding_token": "REPLACE_FROM_STEP1",
    "line_id_token": "REPLACE_REAL_LIFF_ID_TOKEN"
  }'
```
預期：`ok=true`，回傳 `admin_profile_id` 與 `line_user_id`。

## 4) attendance check-in
```bash
curl -X POST "$BASE_URL/api/attendance/check" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "check_type": "check_in",
    "gps_lat": 24.147736,
    "gps_lng": 120.673648
  }'
```
預期：`ok=true`，`data.attendance_log.check_type=check_in`。

## 5) 冷卻時間驗證（立即重打）
重送 Step 4。
預期：`CHECK_COOLDOWN_ACTIVE`。

## 6) out-of-range 驗證
```bash
curl -X POST "$BASE_URL/api/attendance/check" \
  -H "Authorization: Bearer $OWNER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "check_type": "check_in",
    "gps_lat": 25.0330,
    "gps_lng": 121.5654
  }'
```
預期：`OUT_OF_RANGE`。

## 7) attendance adjust（create_missing）
```bash
curl -X POST "$BASE_URL/api/attendance/adjust" \
  -H "Authorization: Bearer $MANAGER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "adjust_mode": "create_missing",
    "admin_profile_id": "'"$STAFF_ADMIN_PROFILE_ID"'",
    "target_location_id": "'"$STORE_LOCATION_ID"'",
    "adjustment_type": "check_out",
    "adjusted_checked_at": "2026-03-24T10:00:00Z",
    "reason": "補下班卡",
    "reason_category": "missed_punch"
  }'
```
預期：`ok=true` 且回傳 `data.attendance_log`。

## 8) admin attendance list
```bash
curl "$BASE_URL/api/admin/attendance/list?date_from=2026-03-24&date_to=2026-03-24&view_scope=store" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```
預期：`data.items` 存在，且 `meta.population_basis` / `meta.event_basis` 正確。

## 9) admin attendance detail（稽核追查）
```bash
curl "$BASE_URL/api/admin/attendance/detail/REPLACE_ATTENDANCE_LOG_ID" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```
預期：回傳 `data.attendance_log` 與 `data.adjustments`，可看到補卡軌跡。

## 10) admin attendance stats（單日）
```bash
curl "$BASE_URL/api/admin/attendance/stats?date=2026-03-24&location_id=$STORE_LOCATION_ID" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```
預期：回傳 `absent_count/late_count/on_duty_count/high_risk_count`。

## 11) stats 多日錯誤碼驗證
```bash
curl "$BASE_URL/api/admin/attendance/stats?date_from=2026-03-24&date_to=2026-03-25" \
  -H "Authorization: Bearer $MANAGER_TOKEN"
```
預期：`STATS_SINGLE_DAY_ONLY`。
