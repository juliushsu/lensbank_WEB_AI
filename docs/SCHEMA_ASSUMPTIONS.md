# Schema Assumptions To Confirm Before Staging Apply

這版已停止依賴 `employees`。
attendance 主體改為 `admin_profiles`。

## 必要欄位（admin_profiles）
1. `id`
2. `auth_user_id`
3. `role`
4. `assigned_location_id`
5. `line_user_id`（migration 新增）
6. `is_active`（migration 新增）
7. `attendance_tracking_enabled`（migration 新增）
8. `attendance_visibility_scope`（migration 新增）

## 必要欄位（locations）
1. `id`
2. `name_zh`
3. `name_ja`
4. `latitude`（migration 新增）
5. `longitude`（migration 新增）
6. `checkin_radius_m`（migration 新增）
7. `is_attendance_enabled`（migration 新增）

## 新增資料表（migration 建立）
1. `attendance_logs`
2. `attendance_adjustments`
3. `line_binding_tokens`

## 語意基準
- 人員母體：`admin_profiles.assigned_location_id`
- 打卡事件：`attendance_logs.location_id`
