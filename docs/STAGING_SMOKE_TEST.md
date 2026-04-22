# Staging Smoke Test (No Production)

## 1) Preconditions
- Migrations are applied on staging only.
- Auth middleware injects authenticated user context for handlers.
- Test accounts prepared:
  - owner or super_admin
  - store_manager
  - staff profile with LINE binding target

## 2) Read-only schema verification SQL
```sql
select column_name from information_schema.columns where table_schema='public' and table_name='admin_profiles'
  and column_name in ('line_user_id','assigned_location_id','attendance_tracking_enabled','attendance_visibility_scope','is_active');

select column_name from information_schema.columns where table_schema='public' and table_name='locations'
  and column_name in ('name_zh','name_ja','latitude','longitude','checkin_radius_m','is_attendance_enabled');

select table_name from information_schema.tables where table_schema='public'
  and table_name in ('attendance_logs','attendance_adjustments','line_binding_tokens');
```

## 3) API smoke flow
1. `POST /api/admin/line/binding-token` with `admin_profile_id`.
2. `POST /api/line/bind` bind LINE ID token with one-time token.
3. `POST /api/attendance/check` check-in success.
4. Repeat step 3 quickly and expect `CHECK_COOLDOWN_ACTIVE`.
5. Use out-of-range GPS and expect `OUT_OF_RANGE`.
6. `POST /api/attendance/adjust` with `adjust_mode=create_missing` and non-null `target_location_id`.
7. `GET /api/admin/attendance/list` and assert `data.items` + meta has basis fields.
8. `GET /api/admin/attendance/stats?date=YYYY-MM-DD` and assert 4 counters.
9. `GET /api/admin/attendance/stats?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD+1` and expect `STATS_SINGLE_DAY_ONLY`.

## 4) Post-check SQL (read-only)
```sql
select id, admin_profile_id, location_id, check_type, checked_at, record_source, status_color
from attendance_logs
order by created_at desc
limit 20;

select id, admin_profile_id, adjustment_mode, adjustment_type, adjusted_checked_at, reason_category, is_self_adjustment
from attendance_adjustments
order by created_at desc
limit 20;

select id, admin_profile_id, used_at, invalidated_at, created_by_auth_user_id, created_by_admin_profile_id, created_by_role
from line_binding_tokens
order by created_at desc
limit 20;
```
