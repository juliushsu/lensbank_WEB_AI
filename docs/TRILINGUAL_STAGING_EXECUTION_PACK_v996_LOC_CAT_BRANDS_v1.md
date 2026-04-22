# LensBank Tri-lingual Staging Migration Execution Pack v1 (v996)

Date: 2026-04-22  
Mode: Execution pack for staging preparation only (do not execute migration in this document)  
Scope: `locations`, `equipment_categories`, `brands`

Related precheck:
- `docs/TRILINGUAL_STAGING_PRECHECK_v995_LOC_CAT_BRANDS_v1.md`

---

## A. Migration Execution Order

Recommended staging execution order:

1. `M_LOC_001_add_trilingual_content_fields.sql`
2. `M_CAT_001_add_trilingual_fields.sql`
3. `M_BRAND_001A_alter_brands_add_trilingual_fields.sql` **or** `M_BRAND_001B_create_brands_if_missing.sql`
4. `M_BRAND_001C_indexes_constraints.sql` (if needed)
5. Backfill scripts (idempotent, chunked)
6. Smoke test sequence (section D)
7. Capability flags progressive enable (section E)
8. Readdy page-level omitted -> enabled rollout (section G)

Execution rule:
- `001A` and `001B` are mutually exclusive.
- Always run `001C` after `001A/001B`.

---

## B. SQL File Breakdown (with naming)

### 1) `M_LOC_001_add_trilingual_content_fields.sql`
Target: `public.locations`

Draft content:
- add `name_en`
- add `address_zh`, `address_ja`, `address_en`
- add `description_zh`, `description_ja`, `description_en`
- add `business_hours_zh`, `business_hours_ja`, `business_hours_en`
- add `contact_notes_zh`, `contact_notes_ja`, `contact_notes_en`
- add optional `sort_order integer default 0`

### 2) `M_CAT_001_add_trilingual_fields.sql`
Target: `public.equipment_categories`

Draft content:
- add `name_en`
- add `description_zh`, `description_ja`, `description_en`

### 3A) `M_BRAND_001A_alter_brands_add_trilingual_fields.sql`
Use only if `public.brands` already exists.

Draft content:
- add `name_en`
- add `sort_order integer default 0` (if absent)
- add `is_active boolean default true` (if absent)
- add `updated_at timestamptz default now()` (if absent)

### 3B) `M_BRAND_001B_create_brands_if_missing.sql`
Use only if `public.brands` does not exist.

Draft content:
- create table with:
  - `id`, `code`, `name_zh`, `name_ja`, `name_en`
  - `sort_order`, `is_active`
  - `created_at`, `updated_at`

### 4) `M_BRAND_001C_indexes_constraints.sql`
Optional alignment file:
- unique constraint/index for `code`
- index on `(is_active, sort_order)`

---

## C. Backfill SQL / Mapping Notes

## C1. General policy
- No automatic translation write into production source-of-truth.
- Backfill in staging first.
- Keep zh/ja untouched; fill en progressively.

## C2. Suggested backfill order
1. `brands`
2. `equipment_categories`
3. `locations`

## C3. SQL-style backfill notes (draft patterns)

### brands
- if `name_en` null and canonical en dictionary exists, update by `code`.
- otherwise keep null and rely on fallback.

### equipment_categories
- set `name_en` per approved glossary by `code`.
- leave `description_en` null if no reviewed copy exists.

### locations
- set `name_en` first to stabilize list pages.
- fill `address_en`, `business_hours_en`, `contact_notes_en`, `description_en` in later content pass.

## C4. Mapping source notes
- Use approved content sheet/glossary as only source.
- Do not map from machine translation directly without review.

---

## D. Smoke Test Sequence (Readdy v996 DebugDrawer)

## D0. Pre-smoke checks
1. verify columns exist for all three entities
2. verify no SQL errors in migration logs
3. verify API payloads include expected tri-lingual/i18n branches

## D1. Locale resolution checks per entity
For each entity (`locations`, `equipment_categories`, `brands`):
1. request with `locale=en`
2. request with `locale=ja`
3. request with `locale=zh-TW`
4. verify display + fallback behavior

## D2. DebugDrawer checks (required keys)
For each response row in v996 DebugDrawer:
- `locale_requested`
- `locale_served`
- `fallback_used`
- `fallback_chain_checked`
- `fallback_source_field`
- `missing_translation_flags`

Expected behavior example:
- request: `en`
- `name_en` missing
- served: `name_zh`
- `fallback_used=true`
- `missing_translation_flags.name_en=true`

## D3. Cross-page consistency checks
- equipment list vs detail:
  - category/brand labels consistent in same locale
- locations list vs detail:
  - name/address/description consistent in same locale

## D4. Non-empty title guard
- no blank primary display title for public pages in any locale.

---

## E. Capability Flag Enable Order

Flags:
- `VITE_TRILINGUAL_LOC`
- `VITE_TRILINGUAL_CAT`
- `VITE_TRILINGUAL_BRAND`

Recommended enable order:
1. Enable `VITE_TRILINGUAL_BRAND`
2. Enable `VITE_TRILINGUAL_CAT`
3. Enable `VITE_TRILINGUAL_LOC`

Reason:
- brand/category stabilize equipment filters first.
- locations content fields are broader and usually have more nulls early.

Enable strategy:
- one flag at a time
- run D-section smoke after each flag
- proceed only when pass

---

## F. Rollback Notes

## F1. Fast rollback (frontend)
- disable flags in reverse order:
  1. `VITE_TRILINGUAL_LOC`
  2. `VITE_TRILINGUAL_CAT`
  3. `VITE_TRILINGUAL_BRAND`
- re-enable prior degrade paths in frontend payload mapper.

## F2. API rollback
- keep schema, rollback at resolver layer:
  - stop reading new `*_en` branches
  - keep fallback to previous stable fields

## F3. DB rollback posture
- avoid dropping columns for emergency rollback.
- schema can remain; behavior rollback is done in API/frontend toggles.

## F4. Backfill rollback
- preserve backfill logs/transaction batches for traceability.
- if needed, selectively revert batch updates from audit records.

---

## G. Readdy Omitted -> Enabled Page Plan

After migration + smoke pass, Readdy can switch omitted fields to enabled as follows:

## G1. After `M_BRAND_001A/001B` (+ optional `001C`)
Enable brand tri-lingual payload on:
- `/equipment` filter panel
- `/equipment/detail` brand section

Remove omitted logic for:
- `brands.name_en`

## G2. After `M_CAT_001`
Enable category tri-lingual payload on:
- `/equipment` category/subcategory filter labels
- `/equipment/detail` category labels

Remove omitted logic for:
- `equipment_categories.name_en`
- `equipment_categories.description_zh/ja/en` (if rendered)

## G3. After `M_LOC_001`
Enable location tri-lingual payload on:
- `/locations` list/detail
- pages/components that display store name/address/hours/contact/description

Remove omitted logic for:
- `locations.name_en`
- `locations.address_zh/ja/en`
- `locations.description_zh/ja/en`
- `locations.business_hours_zh/ja/en`
- `locations.contact_notes_zh/ja/en`

## G4. Final state
- omit/degrade logic remains only for true missing-content fallback, not for missing schema.
- DebugDrawer should expose missing translation flags rather than hiding fields.

---

## Appendix: Suggested staging checklist run command groups (conceptual)
- schema presence check
- payload locale matrix check
- debug drawer key check
- per-flag progressive rollout check

(Commands are environment-specific and should follow your staging runner conventions.)
