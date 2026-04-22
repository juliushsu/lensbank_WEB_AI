# LensBank Bilingual Schema Proposal v1 (Proposal Only)

Date: 2026-04-22  
Status: Draft proposal only (no migration execution)

## Scope
- products bilingual fields
- brands bilingual fields
- categories bilingual fields
- locations bilingual fields
- milestones bilingual table
- fallback/read contract

## 1) Products Bilingual Fields

Goal: Keep current naming style (`*_zh`, `*_ja`) and add English columns in the same pattern.

### Existing baseline (confirmed in current artifacts)
- `products.name_zh`
- `products.name_ja` (used in current function reads)
- core fields: `daily_price`, `deposit`, `category`, `brand`

### Proposed additions
- `name_en`
- `summary_zh`, `summary_ja`, `summary_en`
- `description_zh`, `description_ja`, `description_en`
- `notes_zh`, `notes_ja`, `notes_en`
- `requirements_zh`, `requirements_ja`, `requirements_en`
- `notices_zh`, `notices_ja`, `notices_en`

### Notes
- `display_tags` should remain machine keys (e.g. `hot`, `new`, `incoming`) and map labels via UI i18n dictionary.

## 2) Brands Bilingual Fields

Current `products.brand` appears to be code-based.  
Proposal: maintain code-based relation and introduce/normalize a brand master table.

### Proposed `brands` table (or align existing one to this shape)
- `id uuid primary key`
- `code text unique not null` (machine key)
- `name_zh text not null`
- `name_ja text`
- `name_en text`
- `is_active boolean not null default true`
- `sort_order integer not null default 0`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

## 3) Categories Bilingual Fields

Category specs already define `name_zh`, `name_ja`.

### Proposed additions on `equipment_categories`
- `name_en text`
- `description_zh text`
- `description_ja text`
- `description_en text`

### Keep existing rules unchanged
- `parent_id` stores parent category code (not id)
- category-brand mapping contract remains as-is (`category_brands.category_id` uses category id)

## 4) Locations Bilingual Fields

Current baseline includes `name_zh`, `name_ja`.  
Proposal: expand for public storefront use.

### Proposed additions on `locations`
- `name_en text`
- `address_zh text`, `address_ja text`, `address_en text`
- `business_hours_zh text`, `business_hours_ja text`, `business_hours_en text`
- `contact_notes_zh text`, `contact_notes_ja text`, `contact_notes_en text`
- `service_description_zh text`, `service_description_ja text`, `service_description_en text`

## 5) Milestones Bilingual Table

No confirmed milestone schema exists in current artifacts.  
Proposal: introduce a dedicated table.

### Proposed `about_milestones`
- `id uuid primary key default gen_random_uuid()`
- `event_date date null`
- `title_zh text not null`
- `title_ja text`
- `title_en text`
- `description_zh text`
- `description_ja text`
- `description_en text`
- `sort_order integer not null default 0`
- `is_published boolean not null default false`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

## 6) Fallback / Read Contract

## Locale input
- supported: `zh-TW`, `ja`, `en`

## Output contract (recommended)
For each content entity, return:
- `display`: locale-resolved strings (already fallback-resolved)
- `i18n`: raw multilingual fields (`*_zh`, `*_ja`, `*_en`) for admin/debug use

## Fallback order
1. Requested locale field (`*_en` / `*_zh` / `*_ja`)
2. `*_zh`
3. `*_ja`
4. machine key / code (labels only; avoid this for long-form content)

## Example (product card title)
- request `locale=en`
- choose `name_en`
- if empty -> `name_zh`
- if empty -> `name_ja`
- if empty -> product code/id

## Guidance: UI i18n vs manual translation

### Suitable for UI i18n dictionary
- fixed navigation labels
- status labels
- tag labels from machine keys
- generic button/form text

### Prefer human-maintained content
- legal notices and requirements
- service and booking policy text
- company/about storytelling
- milestone narratives
- store-specific contact/operation notes

## Implementation Note
- This file is a proposal only.
- Do not run migration until schema naming is confirmed by CTO/Readdy/backend owner.
