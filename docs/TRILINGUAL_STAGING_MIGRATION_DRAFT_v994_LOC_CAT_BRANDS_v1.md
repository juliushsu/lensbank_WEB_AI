# LensBank Staging Migration Draft v1 (Readdy v994 Alignment)

Date: 2026-04-22  
Mode: Staging-only draft, proposal only (do not execute in this doc)  
Scope: `locations`, `equipment_categories`, `brands`

## 0) Context

- Target language model: **tri-lingual (`zh / ja / en`)**
- Existing baseline: `zh + ja` partially available
- This draft focuses on schema readiness for Readdy v994 frontend reserved fields
- No migration execution here (SQL is draft only)

## 0.1 Field-source note for v994

The v994 frontend reserved fields are aligned using current LensBank blueprint + existing docs in this repo.  
If a live v994 frontend repo has extra reserved keys, append them before execution.

---

## 1) Entity: `locations`

## 1.1 Existing fields (baseline)
- `id`
- `name_zh`
- `name_ja`
- plus existing operational fields already in system

## 1.2 New tri-lingual fields for v994 alignment
- `name_en`
- `address_zh`, `address_ja`, `address_en`
- `description_zh`, `description_ja`, `description_en`
- `business_hours_zh`, `business_hours_ja`, `business_hours_en`
- `contact_notes_zh`, `contact_notes_ja`, `contact_notes_en`
- optional ordering/state alignment:
  - `sort_order`
  - `is_active` (if not already present in this table)

## 1.3 Nullable strategy
- `name_en`: nullable (phase-in)
- all new long-text tri-lingual fields: nullable
- existing `name_zh/name_ja`: keep current constraints as-is

## 1.4 Draft SQL (proposal only)
```sql
-- M_LOC_001 (draft, staging-only)
alter table public.locations
  add column if not exists name_en text,
  add column if not exists address_zh text,
  add column if not exists address_ja text,
  add column if not exists address_en text,
  add column if not exists description_zh text,
  add column if not exists description_ja text,
  add column if not exists description_en text,
  add column if not exists business_hours_zh text,
  add column if not exists business_hours_ja text,
  add column if not exists business_hours_en text,
  add column if not exists contact_notes_zh text,
  add column if not exists contact_notes_ja text,
  add column if not exists contact_notes_en text,
  add column if not exists sort_order integer default 0;
```

---

## 2) Entity: `equipment_categories`

## 2.1 Existing fields (baseline)
- `id`
- `code`
- `name_zh`
- `name_ja`
- `parent_id`
- `icon_url`
- `display_order`
- `is_active`

## 2.2 New tri-lingual fields for v994 alignment
- `name_en`
- `description_zh`, `description_ja`, `description_en`

## 2.3 Nullable strategy
- `name_en`: nullable
- `description_*`: nullable
- existing hierarchy rules unchanged:
  - `parent_id` semantics unchanged (parent code)

## 2.4 Draft SQL (proposal only)
```sql
-- M_CAT_001 (draft, staging-only)
alter table public.equipment_categories
  add column if not exists name_en text,
  add column if not exists description_zh text,
  add column if not exists description_ja text,
  add column if not exists description_en text;
```

---

## 3) Entity: `brands`

## 3.1 Existing status
- `products.brand` is code-based in current specs.
- `brands` master table existence is environment-dependent.

## 3.2 Target fields for v994 alignment
- `id`
- `code`
- `name_zh`
- `name_ja`
- `name_en`
- `sort_order`
- `is_active`
- `created_at`
- `updated_at`

## 3.3 Nullable strategy
- `name_en`: nullable
- keep `code` as non-null unique
- keep `name_zh` non-null if already enforced

## 3.4 Draft SQL (proposal only)
```sql
-- M_BRAND_001A (draft, when brands table exists)
alter table public.brands
  add column if not exists name_en text,
  add column if not exists sort_order integer default 0,
  add column if not exists is_active boolean default true,
  add column if not exists updated_at timestamptz default now();

-- M_BRAND_001B (draft, when brands table does not exist)
create table if not exists public.brands (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name_zh text not null,
  name_ja text,
  name_en text,
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

---

## 4) Backfill Proposal

## 4.1 General
- Do not auto-translate directly into production content.
- Seed `en` in phases; rely on fallback during gap period.

## 4.2 locations
- Keep `name_zh/name_ja` unchanged.
- `name_en` initially null allowed.
- fill `address_*/description_*/business_hours_*/contact_notes_*` progressively.

## 4.3 equipment_categories
- preserve existing `name_zh/name_ja`.
- set `name_en` and `description_*` by content ops priority.

## 4.4 brands
- if table exists: populate `name_en` gradually.
- if table newly created: import existing distinct brand codes and map zh/ja labels first, then fill en.

---

## 5) Fallback Contract (for public read)

- `zh-TW`: `zh -> ja -> en`
- `ja`: `ja -> zh -> en`
- `en`: `en -> zh -> ja`

Display rule:
- no blank primary display label in list/detail
- for label-like entities, final fallback can be machine code

---

## 6) Smoke Test Checklist (Staging)

## 6.1 Schema checks
- `locations` has all planned `*_en` and tri-lingual long-text columns
- `equipment_categories` has `name_en`, `description_*`
- `brands` has `name_en` (or table exists with target shape)

## 6.2 API/payload checks
- locale `en` with missing `*_en` returns fallback display (not blank)
- locale `ja` with missing `*_ja` falls back correctly
- locale `zh` with missing `*_zh` falls back correctly

## 6.3 UI checks
- equipment brand/category labels consistent between list and detail
- locations page renders tri-lingual fields with expected fallback
- admin debug drawer shows fallback source and missing flags

---

## 7) Rollback Notes

## 7.1 Schema rollback posture
- prefer non-destructive rollback:
  - disable read path usage of new columns first
  - keep added columns to avoid data loss

## 7.2 API rollback posture
- switch fallback resolver to previous contract if needed
- keep payload backward-compatible during rollback window

## 7.3 Content rollback posture
- never overwrite existing zh/ja during en backfill
- maintain change log for any batch import scripts

---

## 8) Readdy v994 Omit Payload Gaps (Current -> Post-migration)

## 8.1 Current likely omitted fields (schema not fully ready)

### locations payload currently omitted/partial
- `name_en`
- `address_zh`, `address_ja`, `address_en`
- `description_zh`, `description_ja`, `description_en`
- `business_hours_zh`, `business_hours_ja`, `business_hours_en`
- `contact_notes_zh`, `contact_notes_ja`, `contact_notes_en`

### equipment_categories payload currently omitted/partial
- `name_en`
- `description_zh`, `description_ja`, `description_en`

### brands payload currently omitted/partial
- `name_en`
- (if no brands table in runtime) entire brand master payload may be omitted and replaced by code-only value

## 8.2 Omit logic to remove after migration

After schema rollout + staging pass, Readdy should remove:
- conditional omission of `*_en` fields in serializer/mapper
- fallback-only code paths that skip missing i18n object branches
- code-only brand label bypass where `brands.name_*` becomes available

Recommended target payload shape after migration:
```json
{
  "id": "...",
  "display": { "name": "..." },
  "i18n": {
    "name": { "zh": "...", "ja": "...", "en": "..." }
  },
  "debug_meta": {
    "locale_requested": "en",
    "locale_served": "zh",
    "fallback_source_field": "name_zh",
    "missing_translation_flags": { "name_en": true }
  }
}
```

---

## 9) Execution Gate

Before any production rollout:
1. staging schema applied
2. fallback smoke pass completed
3. Readdy v994 omit logic removed in staging build
4. rollback checklist validated
