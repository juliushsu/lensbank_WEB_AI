# LensBank Tri-lingual Backfill, Smoke Test, Rollback v1 (Staging-Only, Proposal)

Date: 2026-04-22  
Mode: Proposal only (read/proposal mode, no DB execution here)

## 1) Backfill Plan

## A. display_tags canonical backfill

### Canonical target set
- `hot`
- `new`
- `incoming`
- `staff_required`
- `crew_only`

### Legacy -> canonical mapping
- `熱門` -> `hot`
- `新品` -> `new`
- `預計進貨` -> `incoming`
- `需搭人員` / `需搭工作人員` -> `staff_required`
- `出班組限定` / `crew_package` -> `crew_only`

### Strategy
- Normalize on write path first.
- Backfill historical data in batches.
- Deduplicate per-row tags after mapping.
- Unknown values:
  - keep in audit output
  - quarantine from public display until mapped

## B. Tri-lingual field backfill

### products / brands / categories / locations
- Keep existing `zh/ja` as source-of-truth baseline.
- `en` can be initially null where content is not ready.
- Public read API must apply fallback contract, so null `en` does not break rendering.

### about_milestones
- Table can launch empty.
- Content ops fills `title_zh/ja/en` and `description_zh/ja/en` progressively.

## 2) Smoke Test Checklist (Staging)

## A. Tag system
- DB/API returns canonical keys only.
- No raw Chinese tag strings in public payload.
- No alias keys (`crew_package`, etc.) in public payload.
- List/detail tag rendering is consistent.

## B. Locale + fallback
- `en` missing -> fallback `zh` then `ja`
- `ja` missing -> fallback `zh` then `en`
- `zh` missing -> fallback `ja` then `en`
- Public title must never be empty.

## C. Product pages
- `/equipment` and `/equipment/detail`:
  - fixed UI strings switch with i18n
  - content strings follow display fallback
  - tags render by canonical key -> locale label mapping

## D. Store/about pages
- `/locations` shows tri-lingual fields with fallback
- `/about` milestone sections use publish + sort order and locale fallback
- `/contact` fixed copy uses i18n; content block uses tri-lingual fallback

## 3) Rollback Notes

## A. Schema rollback posture
- Prefer logical rollback (feature flag/API contract fallback) over destructive column drops.
- Keep new columns even when disabled to avoid data loss.

## B. Tag rollback posture
- Retain mapping audit artifact for reverse tracing.
- If needed, rollback to pre-normalization read behavior by API switch, not immediate data rewrite.

## C. API rollback posture
- Revert public `display` resolver to previous behavior behind version toggle.
- Keep `i18n` payload optional for backward compatibility.

## D. Release safety gates
- No production rollout before:
  - staging smoke pass
  - fallback matrix pass
  - canonical tag pass
  - rollback drill documented
