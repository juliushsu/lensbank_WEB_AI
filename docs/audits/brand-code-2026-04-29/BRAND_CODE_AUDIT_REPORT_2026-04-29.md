# LensBank brands / categories / products 品牌代碼一致性 Audit Report

Date: 2026-04-29
Scope: `brands`, `categories`, `products`
Method: read-only repo audit of current workspace artifacts plus SQL drafts for later staging verification
Status: partial completion from repo only; live row-level anomalies still require read-only DB access

## Executive Summary

This workspace does not currently contain the DDL or seeded data for `brands` / `categories`, and it does not contain a generated database type snapshot for those tables either.

What can be confirmed from the repo today:

- `products` exists and is queried by current Supabase Edge Functions.
- Existing repo audit artifacts already reference `products.brand` and `products.category` as machine-code-like fields.
- No repo artifact confirms a current `products.brand_id -> brands.id` foreign key.
- No repo artifact confirms the exact `brands` schema fields (`code`, `brand_code`, `slug`, multilingual names, category relation, timestamps).
- Therefore the real anomaly list for duplicated / null / malformed brand code values cannot be proven from repo alone and must be verified against staging or production data in read-only mode.

Because the request explicitly says not to modify production data, the recommended path is:

1. Run the read-only audit SQL in staging or production-readonly.
2. Export the anomaly list.
3. Review canonical brand-code mapping.
4. Apply repair only in staging first.
5. Validate frontend / admin impact before any production rollout.

## A. brands schema

### Repo-confirmed status

Not confirmed in this workspace.

Checked sources:

- [docs/EN_DATA_MODEL_AUDIT_2026-04-22.md](../../EN_DATA_MODEL_AUDIT_2026-04-22.md)
- [src/lib/types.ts](../../../src/lib/types.ts)
- [supabase/migrations/20260323_0001_line_attendance_mvp_v1_1.sql](../../../supabase/migrations/20260323_0001_line_attendance_mvp_v1_1.sql)
- [supabase/migrations/20260323_0002_attendance_admin_actor_mapping.sql](../../../supabase/migrations/20260323_0002_attendance_admin_actor_mapping.sql)

### What still needs DB verification

The following fields must be verified from `information_schema.columns`:

- `brands.id`
- `brands.code`
- `brands.brand_code`
- `brands.slug`
- `brands.name_zh`
- `brands.name_ja`
- `brands.name_en`
- brand-to-category relation fields
- `brands.created_at`
- `brands.updated_at`

### Read-only schema SQL

```sql
select
  c.table_schema,
  c.table_name,
  c.column_name,
  c.data_type,
  c.is_nullable,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name in ('brands', 'categories', 'products')
order by c.table_name, c.ordinal_position;
```

```sql
select
  tc.table_name,
  tc.constraint_name,
  tc.constraint_type,
  kcu.column_name,
  ccu.table_name as foreign_table_name,
  ccu.column_name as foreign_column_name
from information_schema.table_constraints tc
left join information_schema.key_column_usage kcu
  on tc.constraint_name = kcu.constraint_name
 and tc.table_schema = kcu.table_schema
left join information_schema.constraint_column_usage ccu
  on tc.constraint_name = ccu.constraint_name
 and tc.table_schema = ccu.table_schema
where tc.table_schema = 'public'
  and tc.table_name in ('brands', 'categories', 'products')
order by tc.table_name, tc.constraint_type, tc.constraint_name, kcu.ordinal_position;
```

## B. products-brand relation 現況

### Repo-confirmed status

Current repo evidence points to `products.brand` and `products.category` being directly stored on `products`.

Evidence:

- [docs/EN_DATA_MODEL_AUDIT_2026-04-22.md](../../EN_DATA_MODEL_AUDIT_2026-04-22.md)
  confirms prior read-only audit findings for `products.category` and `products.brand`.
- [supabase/functions/create-order/index.ts](../../../supabase/functions/create-order/index.ts)
  queries `products` only for `id`, `daily_price`, `deposit`, with no brand join.
- [supabase/functions/track-equipment-view/index.ts](../../../supabase/functions/track-equipment-view/index.ts)
  queries `products` directly by `id`, again with no brand join.

### Repo findings

- No repo evidence of `products.brand_id`.
- No repo evidence of `products -> brands` foreign key.
- No repo evidence of legacy columns such as `brand_name`, `producer`, or `manufacturer`.

### What still needs DB verification

Run this to detect actual relation shape and legacy columns:

```sql
select
  column_name,
  data_type,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'products'
  and column_name in (
    'brand_id',
    'brand',
    'brand_name',
    'producer',
    'manufacturer',
    'maker',
    'category',
    'category_id'
  )
order by column_name;
```

## C. 異常品牌清單

### Repo-confirmed status

The repo does not contain live `brands` rows, so the actual anomaly list cannot be enumerated locally.

### UI rule to audit against

Requested rule from this task:

- Format: first letter + 3 digits
- Example: `Sony -> S001`

Normalized regex:

```text
^[A-Z][0-9]{3}$
```

### Read-only anomaly SQL

This query assumes `brands.code` is the active field. If the real field is `brand_code`, replace it accordingly.

```sql
with normalized as (
  select
    b.id,
    b.code,
    b.brand_code,
    b.slug,
    b.name_zh,
    b.name_ja,
    b.name_en,
    b.created_at,
    b.updated_at,
    upper(coalesce(b.code, b.brand_code, '')) as effective_code
  from public.brands b
)
select
  n.*,
  case
    when nullif(trim(coalesce(code, brand_code)), '') is null then 'EMPTY_CODE'
    when effective_code !~ '^[A-Z][0-9]{3}$' then 'FORMAT_MISMATCH'
    when coalesce(code, brand_code) <> effective_code then 'CASE_INCONSISTENT'
    else null
  end as anomaly_type
from normalized n
where
  nullif(trim(coalesce(code, brand_code)), '') is null
  or effective_code !~ '^[A-Z][0-9]{3}$'
  or coalesce(code, brand_code) <> effective_code
order by anomaly_type, effective_code, id;
```

### Duplicate code / duplicate brand name / likely same-brand multi-row

```sql
with base as (
  select
    id,
    upper(trim(coalesce(code, brand_code, ''))) as effective_code,
    lower(trim(coalesce(name_en, name_ja, name_zh, ''))) as normalized_name,
    name_zh,
    name_ja,
    name_en,
    slug,
    created_at,
    updated_at
  from public.brands
)
select
  'DUPLICATE_CODE' as issue_type,
  effective_code as issue_key,
  count(*) as row_count,
  array_agg(id order by created_at nulls last, id) as brand_ids
from base
where effective_code <> ''
group by effective_code
having count(*) > 1

union all

select
  'DUPLICATE_NAME' as issue_type,
  normalized_name as issue_key,
  count(*) as row_count,
  array_agg(id order by created_at nulls last, id) as brand_ids
from base
where normalized_name <> ''
group by normalized_name
having count(*) > 1
order by issue_type, row_count desc, issue_key;
```

### Suggested report columns for final anomaly export

- `brand_id`
- `current_code`
- `legacy_code`
- `slug`
- `name_zh`
- `name_ja`
- `name_en`
- `anomaly_type`
- `suggested_canonical_code`
- `merge_target_brand_id`

## D. 可能修復策略

### Strategy 1: 保留現有 code

Use when:

- Existing code is already used in frontend routing, import/export, ERP sync, or external references.
- Current code is not pretty but is stable and already widely referenced.

Pros:

- Lowest short-term regression risk.
- No immediate backfill needed for downstream integrations.

Cons:

- Inconsistent admin UX remains.
- Harder to enforce future data quality.

### Strategy 2: 重新產生規範 code

Target format:

- `^[A-Z][0-9]{3}$`

Pros:

- Clean, predictable, and easy to validate in UI.
- Easier to search and reason about.

Cons:

- Highest compatibility risk if any system already consumes old codes.
- Requires deterministic remapping and downstream verification.

### Strategy 3: 新增 `legacy_code` 欄保存舊值

Recommended default.

Pros:

- Safest migration path.
- Preserves old import/export compatibility.
- Makes rollback and support investigation easier.

Cons:

- Slightly more schema complexity.
- Requires app logic to clearly define which field is canonical.

### Recommended approach

1. Add `legacy_code` only if it does not already exist.
2. Pick one canonical active field: `code`.
3. Backfill `legacy_code = old code` before normalization.
4. Generate normalized canonical codes only for brands that do not already conform.
5. Freeze code-edit rules in admin UI and DB constraints after cleanup.

## E. 建議 SQL / migration 草案

### 1. Read-only orphan checks

If products use `brand_id`:

```sql
select
  p.id as product_id,
  p.brand_id
from public.products p
left join public.brands b on b.id = p.brand_id
where p.brand_id is not null
  and b.id is null
order by p.id;
```

If products use text-only brand columns:

```sql
select
  p.id as product_id,
  p.brand,
  p.brand_name,
  p.producer,
  p.manufacturer
from public.products p
where p.brand_id is null
  and nullif(trim(coalesce(p.brand, p.brand_name, p.producer, p.manufacturer)), '') is not null
order by p.id;
```

### 2. Canonical mapping draft

Before any repair, create a mapping table or temp CTE:

```sql
create table if not exists public.brand_code_remap_staging (
  brand_id uuid primary key,
  old_code text,
  new_code text not null,
  canonical_name text,
  notes text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);
```

### 3. Safe repair flow

```sql
begin;

alter table public.brands
  add column if not exists legacy_code text;

update public.brands b
set legacy_code = coalesce(b.legacy_code, b.code)
where nullif(trim(coalesce(b.code, '')), '') is not null;

update public.brands b
set code = r.new_code
from public.brand_code_remap_staging r
where r.brand_id = b.id
  and r.approved = true
  and b.id = r.brand_id
  and coalesce(b.code, '') <> r.new_code;

commit;
```

### 4. Post-cleanup constraints

Only after data is clean:

```sql
alter table public.brands
  add constraint brands_code_format_ck
  check (code ~ '^[A-Z][0-9]{3}$');

create unique index if not exists brands_code_uk
  on public.brands (code);
```

### 5. Staging-only migration draft

See:

- [supabase/migrations/20260429_0003_brand_code_staging_only.sql](../../../supabase/migrations/20260429_0003_brand_code_staging_only.sql)

## F. 是否會影響現有商品與前台顯示

### If frontend / backend uses only `products.brand` text

- Renaming `brands.code` alone may have no visible effect.
- But admin lists, filters, exports, or future joins may change.

### If any UI/API/filter/import uses brand code directly

- Replacing old code values can break filters, cached URLs, joins, or admin forms.
- Any downstream script that expects values like `GOPRO` will fail if code becomes `G001` without compatibility handling.

### If `products.brand_id` exists in live DB

- Code normalization is usually safe for relational integrity.
- Brand deduplication or row merge is the risky part, not code formatting itself.

### Recommended rollout order

1. Read-only data audit.
2. Confirm whether code is display-only or integration-critical.
3. Normalize in staging.
4. Run admin CRUD and frontend filter smoke tests.
5. Roll to production only after approved mapping is frozen.

## Current Confidence

High confidence:

- Repo currently proves `products.brand` and `products.category` exist as referenced fields.
- Repo does not prove `brands` schema or `products.brand_id`.

Low confidence until DB access:

- Exact `brands` columns.
- Exact list of malformed / duplicate brand codes.
- Whether orphan references currently exist.
- Whether `brand_id` is present in live DB but simply unused by the checked repo files.

## Next Step Needed To Finish The Audit

Run the read-only SQL against staging or production-readonly and paste the results into this report, especially for:

- `information_schema.columns`
- `information_schema.table_constraints`
- `brands` anomaly queries
- orphan product queries

Without that DB read, section C can only provide detection logic, not the actual anomaly list.
