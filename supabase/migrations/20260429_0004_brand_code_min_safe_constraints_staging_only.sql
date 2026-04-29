begin;

-- STAGING ONLY
-- Purpose:
-- 1. Lock down brands.code as the canonical relation target used by products.brand
-- 2. Allow reviewed legacy brand codes temporarily
-- 3. Add a forward-safe FK on products.brand without breaking known staging data
--
-- Do not apply to production in this form.
-- Validate the FK only after orphan product codes are cleaned up in staging.

-- 0. Hard stop if assumptions are false.
do $$
declare
  v_null_or_blank_count integer;
  v_duplicate_code_count integer;
begin
  select count(*)
  into v_null_or_blank_count
  from public.brands
  where nullif(btrim(code), '') is null;

  if v_null_or_blank_count > 0 then
    raise exception
      'brands.code contains % null/blank rows; fix data before applying NOT NULL',
      v_null_or_blank_count;
  end if;

  select count(*)
  into v_duplicate_code_count
  from (
    select code
    from public.brands
    group by code
    having count(*) > 1
  ) d;

  if v_duplicate_code_count > 0 then
    raise exception
      'brands.code contains % duplicated values; fix data before applying UNIQUE',
      v_duplicate_code_count;
  end if;
end
$$;

-- 1. Temporary legacy flag for non-canonical codes already in staging.
alter table public.brands
  add column if not exists code_is_legacy boolean not null default false;

comment on column public.brands.code_is_legacy is
  'Staging-only temporary flag. true allows a non-canonical code to remain usable during cleanup.';

update public.brands
set code_is_legacy = true
where code !~ '^[A-Z][0-9]{3}$';

-- 2. Lock brands.code as a non-null unique relation key.
alter table public.brands
  alter column code set not null;

alter table public.brands
  add constraint brands_code_uk unique (code);

-- 3. Canonical-format check with an explicit legacy escape hatch.
alter table public.brands
  add constraint brands_code_format_or_legacy_ck
  check (
    code_is_legacy = true
    or code ~ '^[A-Z][0-9]{3}$'
  );

-- 4. Forward-safe FK.
-- NOT VALID keeps existing orphan products from blocking the migration,
-- while still enforcing the FK for new or updated rows after this point.
alter table public.products
  add constraint products_brand_fk_to_brands_code
  foreign key (brand)
  references public.brands (code)
  on update cascade
  on delete restrict
  not valid;

comment on constraint products_brand_fk_to_brands_code on public.products is
  'Staging-only FK to brands.code. Validate after ZOOM/L005 and other orphan product codes are remapped.';

commit;
