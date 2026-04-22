# Attendance API Contract (MVP v1.2, admin_profiles-first)

正式主體欄位：`admin_profile_id` / `admin_name`。
相容別名欄位：`employee_id` / `employee_name`（僅為前端過渡）。

## Baseline Semantics
- 人員母體：`admin_profiles.assigned_location_id`
- 打卡事件：`attendance_logs.location_id`

## 0) GET /api/attendance/me
`/liff/attendance` 應優先使用此 API 作為單一真實來源。

回傳包含：
- 目前登入 admin profile（含 `assigned_location_id`）
- 指派 location 的顯示名稱（`name_zh -> name_ja`）
- 當日最新有效打卡（`today_latest_valid_log`）
- UI 下一步預期打卡類型（`next_expected_check_type`）

## 1) POST /api/admin/line/binding-token

### Request
```json
{
  "admin_profile_id": "uuid",
  "expires_in_minutes": 15
}
```

### Backward-compatible alias
- `employee_id` 可暫時作為 `admin_profile_id` 別名輸入。

### Response
```json
{
  "ok": true,
  "data": {
    "id": "uuid",
    "admin_profile_id": "uuid",
    "employee_id": "uuid",
    "binding_token": "raw-token-for-once",
    "expires_at": "ISO"
  }
}
```

## 2) POST /api/line/bind

### Request
```json
{
  "binding_token": "raw-token",
  "line_id_token": "LINE LIFF id_token"
}
```

### Response
```json
{
  "ok": true,
  "data": {
    "admin_profile_id": "uuid",
    "employee_id": "uuid",
    "line_user_id": "LINE-sub",
    "bound_at": "ISO"
  }
}
```

## 3) POST /api/attendance/check

### Request
```json
{
  "check_type": "check_in",
  "gps_lat": 24.123,
  "gps_lng": 120.123
}
```

### Response
```json
{
  "ok": true,
  "data": {
    "attendance_log": {
      "id": "uuid",
      "admin_profile_id": "uuid",
      "employee_id": "uuid",
      "location_id": "uuid",
      "check_type": "check_in",
      "checked_at": "ISO",
      "status_color": "green"
    }
  }
}
```

## 4) POST /api/attendance/adjust
正式欄位：`adjust_mode` 與 `target_location_id`。

### Request (modify_existing)
```json
{
  "adjust_mode": "modify_existing",
  "admin_profile_id": "uuid",
  "attendance_log_id": "uuid",
  "adjustment_type": "check_out",
  "adjusted_checked_at": "2026-03-24T10:30:00Z",
  "reason": "漏打卡",
  "reason_category": "missed_punch"
}
```

### Request (create_missing)
```json
{
  "adjust_mode": "create_missing",
  "admin_profile_id": "uuid",
  "target_location_id": "uuid",
  "adjustment_type": "check_in",
  "adjusted_checked_at": "2026-03-24T09:00:00Z",
  "reason": "裝置故障",
  "reason_category": "device_issue"
}
```

### Backward-compatible alias
- `employee_id` 可暫時作為 `admin_profile_id` 別名輸入。

### Response
```json
{
  "ok": true,
  "data": {
    "attendance_log": {
      "id": "uuid",
      "admin_profile_id": "uuid",
      "employee_id": "uuid",
      "location_id": "uuid",
      "record_source": "manual",
      "is_adjusted": true
    }
  }
}
```

## 5) GET /api/admin/attendance/list
正式 response shape：`data.items`。

### Query
- `date_from=YYYY-MM-DD`
- `date_to=YYYY-MM-DD`
- `location_id=uuid`
- `admin_profile_id=uuid`（可用 `employee_id` alias）
- `view_scope=store|global|hidden|all`
- `page=1`
- `page_size=20`

### Response (excerpt)
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "admin_profile_id": "uuid",
        "admin_name": "王小明",
        "employee_id": "uuid",
        "employee_name": "王小明",
        "location_id": "uuid",
        "location_name": "台中店",
        "attendance_tracking_enabled": true,
        "attendance_visibility_scope": "store"
      }
    ]
  },
  "meta": {
    "population_basis": "admin_profiles.assigned_location_id",
    "event_basis": "attendance_logs.location_id"
  }
}
```

## 6) GET /api/admin/attendance/stats
stats v1 單日化，跨日回 `STATS_SINGLE_DAY_ONLY`。

### Response
```json
{
  "ok": true,
  "data": {
    "absent_count": 3,
    "late_count": 2,
    "on_duty_count": 8,
    "high_risk_count": 1
  },
  "meta": {
    "date": "2026-03-24",
    "mode": "single_day",
    "population_basis": "admin_profiles.assigned_location_id",
    "event_basis": "attendance_logs.location_id"
  }
}
```

## 7) GET /api/admin/attendance/detail/:id
單筆打卡稽核明細，回傳基本資料、GPS/距離/據點、調整狀態與完整補卡軌跡。

### Response (excerpt)
```json
{
  "ok": true,
  "data": {
    "attendance_log": {
      "id": "uuid",
      "admin_profile_id": "uuid",
      "admin_name": "王小明",
      "employee_id": "uuid",
      "employee_name": "王小明",
      "location_id": "uuid",
      "location_name": "台中店",
      "check_type": "check_in",
      "checked_at": "ISO",
      "gps_lat": 24.1,
      "gps_lng": 120.6,
      "distance_m": 12,
      "is_adjusted": true,
      "adjustment_count": 2,
      "status_color": "orange"
    },
    "adjustments": [
      {
        "id": "uuid",
        "adjustment_mode": "modify_existing",
        "adjustment_type": "check_in",
        "reason": "漏打卡",
        "reason_category": "missed_punch",
        "requested_by_admin_profile_id": "uuid",
        "requested_by_name": "店長A",
        "approved_by_admin_profile_id": "uuid",
        "approved_by_name": "店長A",
        "is_self_adjustment": false
      }
    ]
  }
}
```

## 8) GET /api/admin/attendance/employees
路由保留舊名，但語意是 admin attendance actors。

### Response (excerpt)
```json
{
  "ok": true,
  "data": {
    "items": [
      {
        "admin_profile_id": "uuid",
        "admin_name": "王小明",
        "employee_id": "uuid",
        "employee_name": "王小明",
        "role": "store_manager",
        "location_id": "uuid",
        "location_name": "台中店"
      }
    ]
  },
  "meta": {
    "population_basis": "admin_profiles.assigned_location_id",
    "event_basis": "attendance_logs.location_id"
  }
}
```

## Fixed Error Codes
- `UNAUTHORIZED`
- `FORBIDDEN`
- `INVALID_REQUEST`
- `ADMIN_PROFILE_NOT_FOUND`
- `ADMIN_PROFILE_INACTIVE`
- `PROFILE_SCOPE_FORBIDDEN`
- `LOCATION_NOT_FOUND`
- `LOCATION_DISABLED`
- `LOCATION_COORDINATES_NOT_SET`
- `OUT_OF_RANGE`
- `CHECK_SEQUENCE_INVALID`
- `CHECK_OUT_WITHOUT_CHECK_IN`
- `PREVIOUS_SHIFT_UNCLOSED`
- `CHECK_COOLDOWN_ACTIVE`
- `LINE_ID_TOKEN_INVALID`
- `LINE_BINDING_TOKEN_INVALID`
- `LINE_BINDING_TOKEN_EXPIRED`
- `LINE_BINDING_TOKEN_USED`
- `LINE_USER_ALREADY_BOUND`
- `ADJUSTMENT_REASON_REQUIRED`
- `ADJUSTMENT_MODE_REQUIRED`
- `ADJUSTMENT_TARGET_LOCATION_REQUIRED`
- `ATTENDANCE_LOG_NOT_FOUND`
- `ADJUSTMENT_SEQUENCE_INVALID`
- `STATS_SINGLE_DAY_ONLY`
- `INTERNAL_ERROR`
