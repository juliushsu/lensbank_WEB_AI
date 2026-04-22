# Staging Minimum Test Data Plan (admin_profiles-first)

目標：建立最小可驗證資料，覆蓋 `owner / super_admin / store_manager / staff` 與 1 個門市。

## 0) 前置確認
- migration `0001` 已成功執行（僅 staging）。
- `admin_profiles` 既有必要欄位至少包含：`id`, `auth_user_id`, `role`, `assigned_location_id`。
- `locations` 既有必要欄位至少包含：`id`, `name_zh`, `name_ja`。

## 1) 測試資料建議
- 1 筆 location（台中測試店）。
- 4 筆 admin_profiles（每種角色各一筆）。
- 其中 `store_manager`、`staff` 皆指向同一 `assigned_location_id`。
- `owner`、`super_admin` 可同樣掛同店，方便首輪 smoke。

## 2) 建議 SQL（手動在 staging 執行）
```sql
-- location
insert into public.locations (
  id, name_zh, name_ja, latitude, longitude, checkin_radius_m, is_attendance_enabled
) values (
  '11111111-1111-1111-1111-111111111111',
  '台中測試店',
  '台中テスト店',
  24.147736,
  120.673648,
  50,
  true
)
on conflict (id) do update set
  name_zh = excluded.name_zh,
  name_ja = excluded.name_ja,
  latitude = excluded.latitude,
  longitude = excluded.longitude,
  checkin_radius_m = excluded.checkin_radius_m,
  is_attendance_enabled = excluded.is_attendance_enabled;

-- admin_profiles (請替換 auth_user_id)
insert into public.admin_profiles (
  id, auth_user_id, role, assigned_location_id,
  is_active, attendance_tracking_enabled, attendance_visibility_scope
) values
('20000000-0000-0000-0000-000000000001', 'REPLACE_OWNER_AUTH_USER_ID',        'owner',         '11111111-1111-1111-1111-111111111111', true, true, 'store'),
('20000000-0000-0000-0000-000000000002', 'REPLACE_SUPER_ADMIN_AUTH_USER_ID',  'super_admin',   '11111111-1111-1111-1111-111111111111', true, true, 'global'),
('20000000-0000-0000-0000-000000000003', 'REPLACE_MANAGER_AUTH_USER_ID',      'store_manager', '11111111-1111-1111-1111-111111111111', true, true, 'store'),
('20000000-0000-0000-0000-000000000004', 'REPLACE_STAFF_AUTH_USER_ID',        'staff',         '11111111-1111-1111-1111-111111111111', true, true, 'store')
on conflict (id) do update set
  auth_user_id = excluded.auth_user_id,
  role = excluded.role,
  assigned_location_id = excluded.assigned_location_id,
  is_active = excluded.is_active,
  attendance_tracking_enabled = excluded.attendance_tracking_enabled,
  attendance_visibility_scope = excluded.attendance_visibility_scope;
```

## 3) 測資驗證（read-only）
```sql
select id, name_zh, name_ja, latitude, longitude, checkin_radius_m, is_attendance_enabled
from public.locations
where id = '11111111-1111-1111-1111-111111111111';

select id, auth_user_id, role, assigned_location_id, is_active, attendance_tracking_enabled, attendance_visibility_scope
from public.admin_profiles
where id in (
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000003',
  '20000000-0000-0000-0000-000000000004'
)
order by role;
```
