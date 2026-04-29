begin;

-- STAGING ONLY
-- Purpose:
-- 1. Preserve existing brand code values in legacy_code
-- 2. Prepare a reviewed remap table
-- 3. Apply approved canonical codes only in staging
-- 4. Add constraints only after verification
--
-- DO NOT APPLY TO PRODUCTION WITHOUT:
-- - read-only audit results
-- - approved remap list
-- - smoke test on admin/frontend flows

alter table public.brands
  add column if not exists legacy_code text;

create table if not exists public.brand_code_remap_staging (
  brand_id uuid primary key,
  old_code text,
  new_code text not null,
  canonical_name text,
  notes text,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.brand_code_remap_staging is
  'Staging-only review table for brand code normalization.';

update public.brands b
set legacy_code = coalesce(b.legacy_code, b.code)
where nullif(trim(coalesce(b.code, '')), '') is not null;

-- Example review query before applying changes:
-- select b.id, b.code as current_code, b.legacy_code, r.new_code, r.approved
-- from public.brands b
-- left join public.brand_code_remap_staging r on r.brand_id = b.id
-- order by b.code nulls last, b.id;

update public.brands b
set
  code = r.new_code,
  updated_at = now()
from public.brand_code_remap_staging r
where r.brand_id = b.id
  and r.approved = true
  and nullif(trim(r.new_code), '') is not null
  and b.code is distinct from r.new_code;

-- Enable only after staging validation:
-- alter table public.brands
--   add constraint brands_code_format_ck
--   check (code ~ '^[A-Z][0-9]{3}$');
--
-- create unique index if not exists brands_code_uk
--   on public.brands (code);

commit;
