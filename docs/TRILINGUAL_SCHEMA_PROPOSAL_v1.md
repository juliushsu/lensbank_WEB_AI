# LensBank Tri-lingual Schema Proposal v1 (Proposal Only)

Date: 2026-04-22  
Status: Proposal only (read/proposal mode, no migration execution)

## Policy Update (Official)
- Existing multilingual baseline is **Chinese + Japanese** (`*_zh`, `*_ja`).
- This proposal adds **English** (`*_en`).
- From now on, content models should use **tri-lingual fields (zh / ja / en)** as the standard.
- Terminology should use **tri-lingual**, not bilingual.

## 1) Products (tri-lingual)

### Existing baseline (confirmed)
- `products.name_zh`
- `products.name_ja` (used in existing functions)
- `products.brand`, `products.category` (machine code fields)

### Proposed tri-lingual content fields
- `name_zh`, `name_ja`, `name_en`
- `summary_zh`, `summary_ja`, `summary_en`
- `description_zh`, `description_ja`, `description_en`
- `notes_zh`, `notes_ja`, `notes_en`
- `requirements_zh`, `requirements_ja`, `requirements_en`
- `notices_zh`, `notices_ja`, `notices_en`

## 2) Brands (tri-lingual)

If `products.brand` remains code-based, use a brand master table for labels:

`brands`
- `id uuid primary key`
- `code text unique not null`
- `name_zh text not null`
- `name_ja text`
- `name_en text`
- `is_active boolean not null default true`
- `sort_order integer not null default 0`
- `created_at timestamptz not null default now()`
- `updated_at timestamptz not null default now()`

## 3) Categories (tri-lingual)

For `equipment_categories`, keep current contracts and add English:
- `name_zh`, `name_ja`, `name_en`
- optional `description_zh`, `description_ja`, `description_en`

Keep existing rules unchanged:
- `parent_id` uses parent category code (not id)
- `category_brands.category_id` uses category id

## 4) Locations (tri-lingual)

Current baseline has `name_zh`, `name_ja`. Extend to tri-lingual operational content:
- `name_zh`, `name_ja`, `name_en`
- `address_zh`, `address_ja`, `address_en`
- `business_hours_zh`, `business_hours_ja`, `business_hours_en`
- `contact_notes_zh`, `contact_notes_ja`, `contact_notes_en`
- `service_description_zh`, `service_description_ja`, `service_description_en`

## 5) Milestones (tri-lingual table)

Proposed `about_milestones`:
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

## 6) Locale Fallback / Read Contract

### Supported locale input
- `zh-TW`, `ja`, `en`

### Response contract (recommended)
Each content API should return:
- `display`: resolved content after fallback
- `i18n`: raw tri-lingual fields (`*_zh`, `*_ja`, `*_en`)

### Fallback order
1. Requested locale field (e.g. `*_en`)
2. `*_zh`
3. `*_ja`
4. machine key / code (labels only, avoid for long-form content)

### Example
Requested locale `en`, field group `title_*`:
- use `title_en`
- if empty -> `title_zh`
- if empty -> `title_ja`
- if empty -> fallback key (only for short labels)

## 7) UI i18n vs Human-authored Content

Suitable for UI i18n dictionary:
- navigation labels
- status labels
- fixed form text
- machine-key tag labels

Prefer human-authored tri-lingual content:
- legal notices / requirements
- service and booking policies
- company/about narratives
- milestone descriptions
- store-specific operational notes

## Implementation Note
- This document is proposal-only and does not execute migration.
- API contract should follow actual deployed Supabase Edge Functions after schema alignment.
