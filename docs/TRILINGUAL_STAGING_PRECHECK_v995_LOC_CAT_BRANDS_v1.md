# LensBank Tri-lingual Staging Precheck v1 (v995, locations/categories/brands)

Date: 2026-04-22  
Mode: Pre-execution checklist only (do not execute migration in this document)

## Scope
1. `locations`
2. `equipment_categories`
3. `brands`

## A. Staging Migration Execution Checklist

## A1. Preconditions
- Confirm staging project/ref and branch are correct.
- Confirm no production credentials are used.
- Confirm latest schema snapshot exported for comparison.
- Confirm current frontend is v995 build.

## A2. Schema existence checks (before SQL)
- `locations` has baseline: `id`, `name_zh`, `name_ja`.
- `equipment_categories` has baseline: `id`, `code`, `name_zh`, `name_ja`, `parent_id`, `display_order`, `is_active`.
- `brands` table:
  - either already exists (use alter path),
  - or missing (use create path).

## A3. Data safety checks
- Count rows per table before migration.
- Ensure no destructive drop/rename included.
- Confirm nullable strategy:
  - new `*_en` columns nullable in phase 1.
- Prepare rollback runbook and owner approvals.

## A4. Deployment gating
- Apply migrations in numbered order (B section).
- Run smoke test matrix (D section) before app rollout.
- Only after pass: enable Readdy capability flags (E section).

---

## B. SQL File Split Recommendation

Recommended files (staging-only):

1. `M_LOC_001_add_trilingual_content_fields.sql`
- `alter table public.locations add column if not exists ...`
- includes:
  - `name_en`
  - `address_zh/ja/en`
  - `description_zh/ja/en`
  - `business_hours_zh/ja/en`
  - `contact_notes_zh/ja/en`
  - optional `sort_order` default 0

2. `M_CAT_001_add_trilingual_fields.sql`
- `alter table public.equipment_categories add column if not exists ...`
- includes:
  - `name_en`
  - `description_zh/ja/en`

3. `M_BRAND_001A_alter_brands_add_trilingual_fields.sql`
- use when `public.brands` exists
- includes:
  - `name_en`
  - `sort_order` default 0 (if absent)
  - `is_active` default true (if absent)
  - `updated_at` default now() (if absent)

4. `M_BRAND_001B_create_brands_if_missing.sql`
- use when `public.brands` does not exist
- create table:
  - `id`, `code`, `name_zh`, `name_ja`, `name_en`
  - `sort_order`, `is_active`, `created_at`, `updated_at`

5. `M_BRAND_001C_indexes_constraints.sql` (optional)
- add index/constraints if needed:
  - unique on `code`
  - index on `is_active, sort_order`

Execution rule:
- run `001A` or `001B` (mutually exclusive), then `001C`.

---

## C. Backfill Order

1. `brands` labels
- ensure brand master exists and `code` set is complete.
- fill `name_zh/name_ja` baseline if missing.
- populate `name_en` incrementally.

2. `equipment_categories`
- keep hierarchy untouched.
- fill `name_en` first.
- then `description_zh/ja/en` as content is ready.

3. `locations`
- fill `name_en` first for list pages.
- then address/hours/contact/description tri-lingual fields.

Backfill principle:
- no auto-translate direct write to production.
- preserve existing zh/ja as source baseline.
- allow null `*_en` while fallback contract is active.

---

## D. Smoke Test Checklist (v995 Debug Drawer Aligned)

## D1. Schema checks
- `locations` new columns present.
- `equipment_categories` new columns present.
- `brands` path applied correctly (alter/create).

## D2. API/read checks by locale
- `locale=en`: `*_en` missing -> fallback served (not blank).
- `locale=ja`: `*_ja` missing -> fallback `zh` then `en`.
- `locale=zh-TW`: `*_zh` missing -> fallback `ja` then `en`.

## D3. v995 debug drawer checks
For list/detail payloads verify `debug_meta`:
- `locale_requested`
- `locale_served`
- `fallback_used`
- `fallback_chain_checked`
- `fallback_source_field`
- `missing_translation_flags`

Expected example:
- requested `en`, missing `name_en`
- served `name_zh`
- flag `missing_translation_flags.name_en = true`

## D4. UI consistency checks
- same entity name should match between list/detail for same locale.
- category/brand labels consistent across desktop/mobile filters.
- no blank primary title on public pages.

---

## E. Post-migration Readdy Switch Plan (v995)

## E1. Capability flags to enable
- `cap.i18n.entity.locations.trilingual = true`
- `cap.i18n.entity.equipment_categories.trilingual = true`
- `cap.i18n.entity.brands.trilingual = true`
- `cap.i18n.debugDrawer.fallbackMeta = true`

## E2. Degrade/omit logic to remove
- remove payload omits for:
  - `locations.name_en`
  - `locations.address_* / business_hours_* / contact_notes_* / description_*`
  - `equipment_categories.name_en`
  - `equipment_categories.description_*`
  - `brands.name_en`
- remove code-only brand label bypass once brand master payload is available.
- remove hard fallback shortcuts that skip `i18n` object branches.

## E3. Keep temporarily
- keep locale fallback resolver enabled until en content completion passes QA.

---

## F. Rollback Notes

## F1. Schema rollback posture
- non-destructive rollback preferred:
  - disable read usage of new columns first
  - avoid dropping newly added columns in emergency rollback

## F2. App rollback posture
- revert capability flags in E1 to false.
- re-enable previous v995 degrade paths (if needed) via feature flags.

## F3. Data rollback posture
- no overwrite of zh/ja during backfill.
- keep import/backfill logs for traceability and selective revert.

## F4. Decision gate
- if any D-section smoke test fails:
  - stop rollout
  - keep schema as-is
  - rollback at API/frontend flag layer first

---

## Appendix: Recommended Execution Order
1. `M_LOC_001`
2. `M_CAT_001`
3. `M_BRAND_001A` or `M_BRAND_001B`
4. `M_BRAND_001C`
5. backfill (C)
6. smoke tests (D)
7. Readdy flag/capability switch (E)
