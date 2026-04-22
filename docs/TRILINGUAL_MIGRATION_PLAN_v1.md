# LensBank Tri-lingual Migration Plan v1 (Staging-Only, Proposal)

Date: 2026-04-22  
Mode: Proposal only (no migration execution in this document)

## Scope
- `display_tags` canonical cleanup
- products tri-lingual fields
- brands/categories/locations tri-lingual fields
- `about_milestones` table
- public read fallback contract alignment

## Principles
- Target locales: `zh / ja / en`
- UI fixed copy: i18n dictionaries
- Content data: tri-lingual DB fields
- `display_tags`: canonical machine keys only
- Rollout order: **staging -> validation -> production**

## Recommended Migration Order

1. `M1_display_tags_canonical_cleanup`
- Normalize legacy tag values to canonical keys:
  - `hot`, `new`, `incoming`, `staff_required`, `crew_only`
- Keep mapping/audit output for rollback traceability.

2. `M2_products_trilingual_fields`
- Add missing tri-lingual text fields:
  - `name_en`
  - `summary_zh/ja/en`
  - `description_zh/ja/en`
  - `notes_zh/ja/en`
  - `requirements_zh/ja/en`
  - `notices_zh/ja/en`
  - optional: `specs_zh/ja/en`

3. `M3_brands_categories_locations_trilingual_fields`
- `brands`: `name_zh/ja/en` (+ sort/is_active metadata)
- `equipment_categories`: `name_zh/ja/en`, optional `description_zh/ja/en`
- `locations`: `name_zh/ja/en`, `address_zh/ja/en`, `business_hours_zh/ja/en`, `contact_notes_zh/ja/en`, `description_zh/ja/en`

4. `M4_about_milestones_table`
- Create `about_milestones` with tri-lingual title/description and publish/sort controls.

5. `M5_public_read_contract_alignment`
- Enforce API contract pattern:
  - `display` (locale resolved + fallback applied)
  - `i18n` (raw `zh/ja/en`)

## Fallback Contract (Normative)

- `zh-TW`: `zh -> ja -> en`
- `ja`: `ja -> zh -> en`
- `en`: `en -> zh -> ja`

Rule:
- Do not allow empty primary title on public pages.

## Staging Deployment Sequence

1. Apply schema additions (non-breaking columns/tables first)
2. Apply tag normalization logic (write/read paths)
3. Run backfill scripts (idempotent, chunked)
4. Validate APIs with locale matrix
5. Validate frontend pages (`/equipment`, `/equipment/detail`, `/locations`, `/about`, `/contact`, `/services`)
6. Freeze migration hashes and release notes

## Deliverables for Production Gate

- Migration SQL files (staging tested)
- Backfill report
- Smoke test report
- Rollback runbook
- API contract diff (before/after)
