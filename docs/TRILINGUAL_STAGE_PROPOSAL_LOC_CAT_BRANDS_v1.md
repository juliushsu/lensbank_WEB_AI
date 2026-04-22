# LensBank Tri-lingual Staging Proposal v1 (locations / equipment_categories / brands)

Date: 2026-04-22  
Mode: Staging-only proposal (read/proposal only, no migration execution)

## Scope
1. `locations`  
2. `equipment_categories`  
3. `brands`

## Goal
- Add/complete `*_en` fields
- Clarify current vs new columns
- Define backfill / fallback / smoke tests
- Provide admin debug drawer meta proposal:
  - locale source
  - fallback source
  - missing translation flags

## 0) Baseline Notes (from current artifacts)

- `locations` confirmed baseline in current repo/spec: `name_zh`, `name_ja`.
- `equipment_categories` confirmed in category spec:
  - `id`, `code`, `name_zh`, `name_ja`, `parent_id`, `icon_url`, `display_order`, `is_active`.
- `brands` appears as product code relation (`products.brand`) in current specs.
  - A normalized `brands` master table is proposed and should be treated as schema-alignment work if missing.

---

## 1) Entity: locations

## A. Existing fields (confirmed baseline)
- `id`
- `name_zh`
- `name_ja`
- existing operational fields in current system may include attendance-specific fields (not the focus here)

## B. Proposed tri-lingual additions
- `name_en`
- `address_zh`, `address_ja`, `address_en`
- `description_zh`, `description_ja`, `description_en`
- `business_hours_zh`, `business_hours_ja`, `business_hours_en`
- `contact_notes_zh`, `contact_notes_ja`, `contact_notes_en`
- optional ops fields for ordering/state:
  - `is_active`
  - `sort_order`

## C. Backfill proposal
- Keep current `name_zh/name_ja` untouched.
- `name_en` can be nullable at first.
- For new long-text fields, initial null is allowed; public API must fallback correctly.

---

## 2) Entity: equipment_categories

## A. Existing fields (confirmed from category spec)
- `id`
- `code`
- `name_zh`
- `name_ja`
- `parent_id` (stores parent category code, not id)
- `icon_url`
- `display_order`
- `is_active`

## B. Proposed tri-lingual additions
- `name_en`
- `description_zh`, `description_ja`, `description_en` (optional but recommended)

## C. Backfill proposal
- Existing `name_zh/name_ja` remain source baseline.
- `name_en` can be null initially.
- Keep category hierarchy contracts unchanged:
  - `parent_id` semantics unchanged
  - `category_brands.category_id` contract unchanged

---

## 3) Entity: brands

## A. Existing status
- Current product model uses `products.brand` as a brand code.
- Existing `brands` table availability is not fully confirmed in this repo snapshot.

## B. Proposed target model (if table exists, align to this shape)
`brands`
- `id`
- `code`
- `name_zh`
- `name_ja`
- `name_en`
- `sort_order`
- `is_active`
- `created_at`
- `updated_at`

## C. Backfill proposal
- If `brands` table already exists:
  - preserve existing `code` and zh/ja labels
  - add/fill `name_en` gradually
- If `brands` table does not exist:
  - create as part of dedicated migration stage before frontend brand i18n rollout

---

## 4) Locale Fallback Contract (for these 3 entities)

## Locale chain
- `zh-TW`: `zh -> ja -> en`
- `ja`: `ja -> zh -> en`
- `en`: `en -> zh -> ja`

## Field resolution rule
For each text group (e.g. `name_*`, `description_*`):
1. use requested locale
2. fallback via locale chain
3. final fallback to machine code/key (labels only)

## Public read response pattern (recommended)
```json
{
  "id": "uuid-or-code",
  "display": {
    "name": "resolved text",
    "description": "resolved text"
  },
  "i18n": {
    "name": { "zh": "...", "ja": "...", "en": "..." },
    "description": { "zh": "...", "ja": "...", "en": "..." }
  },
  "debug_meta": {
    "locale_requested": "en",
    "locale_served": "zh",
    "fallback_used": true,
    "fallback_chain_checked": ["en", "zh", "ja"],
    "fallback_source_field": "name_zh",
    "missing_translations": {
      "name_en": true,
      "description_en": true
    }
  }
}
```

---

## 5) Admin Debug Drawer Meta Proposal

To support tri-lingual QA/debug in admin:

## Required debug meta fields
- `locale_requested`: requested locale
- `locale_served`: locale actually used for display
- `fallback_used`: boolean
- `fallback_chain_checked`: array of locale keys in evaluated order
- `fallback_source_field`: the concrete resolved DB field name
- `missing_translation_flags`: key-value map of missing locale fields

## Example (locations.name in en mode)
- requested: `en`
- `name_en` missing -> served from `name_zh`
- flags:
  - `name_en_missing = true`
  - `name_ja_missing = false`

---

## 6) Staging Smoke Test Checklist

## A. Schema presence checks
- `locations` has `name_en` (+ planned long-text tri-lingual columns)
- `equipment_categories` has `name_en` (and optional description tri-lingual columns)
- `brands` has `name_en` (or table creation planned/confirmed)

## B. API/display fallback checks
- `en` request with missing `*_en` returns zh fallback (not blank)
- `ja` request with missing `*_ja` returns zh fallback
- `zh` request with missing `*_zh` returns ja/en fallback
- no empty primary display name on list/detail pages

## C. Admin debug checks
- debug drawer shows `locale_requested`, `locale_served`
- fallback source field is visible
- missing translation flags correctly reflect absent fields

## D. Cross-page checks
- equipment filters using category/brand labels remain consistent in zh/ja/en
- list/detail labels match for same entity and locale

---

## 7) Rollout / Dependency Notes

- This proposal is staging-first and non-destructive.
- Execute schema alignment before forcing frontend to require `*_en`.
- Readdy can proceed with UI i18n in parallel while DB `*_en` is being added.
- Final production rollout should require:
  - staging smoke pass
  - fallback pass
  - debug drawer visibility pass
