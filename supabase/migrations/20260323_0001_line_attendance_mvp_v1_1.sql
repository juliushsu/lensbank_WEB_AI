begin;

create extension if not exists pgcrypto;

-- =====================================================
-- locations
-- =====================================================
alter table public.locations
  add column if not exists latitude numeric(9,6),
  add column if not exists longitude numeric(9,6),
  add column if not exists checkin_radius_m integer default 50,
  add column if not exists is_attendance_enabled boolean default true;

alter table public.locations
  alter column checkin_radius_m set default 50,
  alter column is_attendance_enabled set default true;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_checkin_radius_m_ck') then
    alter table public.locations
      add constraint locations_checkin_radius_m_ck
      check (checkin_radius_m > 0 and checkin_radius_m <= 1000);
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_latitude_ck') then
    alter table public.locations
      add constraint locations_latitude_ck
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'locations_longitude_ck') then
    alter table public.locations
      add constraint locations_longitude_ck
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;
end $$;


-- =====================================================
-- admin_profiles (attendance 主體)
-- =====================================================
alter table public.admin_profiles
  add column if not exists line_user_id text,
  add column if not exists is_active boolean not null default true,
  add column if not exists attendance_tracking_enabled boolean not null default true,
  add column if not exists attendance_visibility_scope text not null default 'store';

create unique index if not exists admin_profiles_line_user_id_uk
  on public.admin_profiles(line_user_id)
  where line_user_id is not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'admin_profiles_attendance_visibility_scope_ck') then
    alter table public.admin_profiles
      add constraint admin_profiles_attendance_visibility_scope_ck
      check (attendance_visibility_scope in ('store','global','hidden'));
  end if;
end $$;

create index if not exists admin_profiles_attendance_visibility_idx
  on public.admin_profiles(attendance_tracking_enabled, attendance_visibility_scope, assigned_location_id);


-- =====================================================
-- attendance_logs
-- =====================================================
create table if not exists public.attendance_logs (
  id uuid primary key default gen_random_uuid(),

  admin_profile_id uuid not null
    references public.admin_profiles(id)
    on update cascade
    on delete restrict,

  location_id uuid not null
    references public.locations(id)
    on update cascade
    on delete restrict,

  check_type text not null,
  checked_at timestamptz not null default now(),

  gps_lat numeric(9,6),
  gps_lng numeric(9,6),
  distance_m integer,

  is_within_range boolean,
  is_valid boolean not null default true,

  record_source text not null default 'line_liff',

  is_adjusted boolean not null default false,
  adjustment_count integer not null default 0,

  status_color text not null default 'green',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint attendance_logs_check_type_ck
    check (check_type in ('check_in','check_out')),

  constraint attendance_logs_record_source_ck
    check (record_source in ('line_liff','manual')),

  constraint attendance_logs_status_color_ck
    check (status_color in ('green','yellow','orange','red','purple')),

  constraint attendance_logs_gps_pair_ck
    check ((gps_lat is null and gps_lng is null) or (gps_lat is not null and gps_lng is not null)),

  constraint attendance_logs_lat_ck
    check (gps_lat is null or (gps_lat >= -90 and gps_lat <= 90)),

  constraint attendance_logs_lng_ck
    check (gps_lng is null or (gps_lng >= -180 and gps_lng <= 180)),

  constraint attendance_logs_distance_ck
    check (distance_m is null or distance_m >= 0),

  constraint attendance_logs_adjustment_count_ck
    check (adjustment_count >= 0)
);

create index if not exists attendance_logs_admin_profile_checked_at_idx
  on public.attendance_logs(admin_profile_id, checked_at desc);

create index if not exists attendance_logs_location_checked_at_idx
  on public.attendance_logs(location_id, checked_at desc);

create index if not exists attendance_logs_status_color_idx
  on public.attendance_logs(status_color);


-- =====================================================
-- attendance_adjustments
-- =====================================================
create table if not exists public.attendance_adjustments (
  id uuid primary key default gen_random_uuid(),

  attendance_log_id uuid
    references public.attendance_logs(id)
    on update cascade
    on delete restrict,

  admin_profile_id uuid not null
    references public.admin_profiles(id)
    on update cascade
    on delete restrict,

  adjustment_mode text not null default 'modify_existing',
  adjustment_type text not null,

  original_checked_at timestamptz,
  adjusted_checked_at timestamptz not null,

  reason text not null,
  reason_category text not null,

  target_location_id uuid
    references public.locations(id)
    on update cascade
    on delete restrict,

  created_manual_log_id uuid
    references public.attendance_logs(id)
    on update cascade
    on delete set null,

  requested_by_admin_profile_id uuid
    references public.admin_profiles(id)
    on update cascade
    on delete set null,

  approved_by_admin_profile_id uuid
    references public.admin_profiles(id)
    on update cascade
    on delete set null,

  is_self_adjustment boolean not null default false,

  created_at timestamptz not null default now(),
  approved_at timestamptz,

  constraint attendance_adjustments_adjustment_mode_ck
    check (adjustment_mode in ('modify_existing','create_missing')),

  constraint attendance_adjustments_adjustment_type_ck
    check (adjustment_type in ('check_in','check_out')),

  constraint attendance_adjustments_reason_not_blank_ck
    check (length(btrim(reason)) > 0),

  constraint attendance_adjustments_reason_category_ck
    check (reason_category in (
      'missed_punch','traffic','device_issue','system_issue',
      'personal','manager_override','other'
    )),

  constraint attendance_adjustments_approval_pair_ck
    check (
      (approved_by_admin_profile_id is null and approved_at is null)
      or
      (approved_by_admin_profile_id is not null and approved_at is not null)
    ),

  constraint attendance_adjustments_mode_shape_ck
    check (
      (adjustment_mode = 'modify_existing' and attendance_log_id is not null and target_location_id is null and created_manual_log_id is null)
      or
      (adjustment_mode = 'create_missing' and attendance_log_id is null and target_location_id is not null and created_manual_log_id is not null)
    )
);

create index if not exists attendance_adjustments_admin_profile_adjusted_at_idx
  on public.attendance_adjustments(admin_profile_id, adjusted_checked_at desc);

create index if not exists attendance_adjustments_log_id_idx
  on public.attendance_adjustments(attendance_log_id);

create index if not exists attendance_adjustments_mode_idx
  on public.attendance_adjustments(adjustment_mode, created_at desc);


-- =====================================================
-- line_binding_tokens
-- =====================================================
create table if not exists public.line_binding_tokens (
  id uuid primary key default gen_random_uuid(),
  admin_profile_id uuid not null
    references public.admin_profiles(id)
    on update cascade
    on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  invalidated_at timestamptz,
  created_at timestamptz not null default now(),

  created_by_auth_user_id uuid,
  created_by_admin_profile_id uuid
    references public.admin_profiles(id)
    on update cascade
    on delete set null,
  created_by_role text,

  constraint line_binding_tokens_created_by_role_ck
    check (created_by_role is null or created_by_role in ('owner','super_admin','store_manager','staff'))
);

create unique index if not exists line_binding_tokens_one_active_per_admin_profile_uk
  on public.line_binding_tokens(admin_profile_id)
  where used_at is null and invalidated_at is null;

create index if not exists line_binding_tokens_admin_profile_idx
  on public.line_binding_tokens(admin_profile_id, created_at desc);

create index if not exists line_binding_tokens_expires_idx
  on public.line_binding_tokens(expires_at);


-- =====================================================
-- audit guards
-- =====================================================
create or replace function public.touch_attendance_logs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_touch_attendance_logs_updated_at') then
    create trigger trg_touch_attendance_logs_updated_at
    before update on public.attendance_logs
    for each row
    execute function public.touch_attendance_logs_updated_at();
  end if;
end $$;

create or replace function public.guard_attendance_logs_immutable_fields()
returns trigger
language plpgsql
as $$
begin
  if (
    row(
      new.admin_profile_id, new.location_id, new.check_type, new.checked_at,
      new.gps_lat, new.gps_lng, new.distance_m, new.is_within_range,
      new.record_source, new.created_at
    )
    is distinct from
    row(
      old.admin_profile_id, old.location_id, old.check_type, old.checked_at,
      old.gps_lat, old.gps_lng, old.distance_m, old.is_within_range,
      old.record_source, old.created_at
    )
  ) then
    raise exception 'IMMUTABLE_ATTENDANCE_LOG_FIELDS';
  end if;

  if new.adjustment_count < old.adjustment_count then
    raise exception 'ATTENDANCE_ADJUSTMENT_COUNT_CANNOT_DECREASE';
  end if;

  if new.adjustment_count > old.adjustment_count and new.is_adjusted = false then
    raise exception 'IS_ADJUSTED_MUST_BE_TRUE_WHEN_ADJUSTMENT_COUNT_INCREASES';
  end if;

  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_guard_attendance_logs_immutable') then
    create trigger trg_guard_attendance_logs_immutable
    before update on public.attendance_logs
    for each row
    execute function public.guard_attendance_logs_immutable_fields();
  end if;
end $$;

create or replace function public.prevent_delete_attendance_audit()
returns trigger
language plpgsql
as $$
begin
  raise exception 'ATTENDANCE_AUDIT_DELETE_FORBIDDEN';
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_prevent_delete_attendance_logs') then
    create trigger trg_prevent_delete_attendance_logs
    before delete on public.attendance_logs
    for each row
    execute function public.prevent_delete_attendance_audit();
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'trg_prevent_delete_attendance_adjustments') then
    create trigger trg_prevent_delete_attendance_adjustments
    before delete on public.attendance_adjustments
    for each row
    execute function public.prevent_delete_attendance_audit();
  end if;
end $$;

commit;
