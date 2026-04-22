# LensBank Data Source Audit (Read-Only)

Date: 2026-04-22  
Scope: Product filtering, contact source, about milestones source  
Method: Read-only scan of `supabase/functions/*`, `supabase/migrations/*`, and spec docs

## A. Reusable Existing Sources

### Product domain (confirmed)
- `products` table is actively used by existing Edge Functions.
- `track-equipment-view` updates `products.view_count`.
- `create-order` reads `products` pricing fields (`daily_price`, `deposit`).

### Product relation hints from specs
- `products.category` (category code)
- `products.brand` (brand code)
- `equipment_items.product_id` (inventory item -> product)
- Category specs mention `equipment_categories` and `category_brands`.

## B. Missing / Unclear Schema for Frontend Filtering & About

### Product visibility lifecycle (missing formal contract)
No stable, explicit field contract found in this repo for:
- published/unpublished
- frontend-visible
- soft-deleted/disabled

Examples not clearly defined in current artifacts:
- `is_published`
- `is_visible`
- `deleted_at`
- `is_deleted`

### Contact settings source (missing)
No confirmed table or function in this repo for:
- `company_profile`
- `site_settings`
- `public_settings`
- `contact_settings`

### About timeline source (missing)
No confirmed table/function for about milestones/timeline content.

## C. What Readdy Can Do Alone (No Migration)

- Switch frontend to consume a single backend source per page (avoid client-side multi-source derivation).
- Keep UI adapters ready for normalized response:
  - product list + filter options
  - contact payload
  - about milestones payload
- Stop hardcoding once backend source is confirmed.

## D. What Needs Migration / Schema First

1) Product visibility contract
- Define official lifecycle fields for frontend availability.

2) Public contact settings table
- Multi-language fields + publish control.

3) About milestones table
- Suggested minimum fields:
  - `id`
  - `event_date` (or `year`)
  - `title_zh`, `title_ja`
  - `description_zh`, `description_ja`
  - `sort_order`
  - `is_published`
  - `created_at`, `updated_at`

## Notes

- This audit is read-only and does not execute any migration.
- API contract should follow actual Supabase Edge Functions implementation.
