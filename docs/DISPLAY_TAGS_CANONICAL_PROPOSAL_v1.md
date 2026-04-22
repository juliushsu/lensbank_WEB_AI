# LensBank Display Tags Canonical Proposal v1 (Proposal Only)

Date: 2026-04-22  
Status: Proposal only (no migration execution)

## Objective
- Define a single canonical machine-key set for product `display_tags`.
- Normalize legacy/variant values into canonical keys.
- Keep frontend labels in i18n dictionaries (zh/ja/en), not in DB literal UI text.

## 1) Canonical Machine Keys (Official Set)

Recommended canonical keys:
- `hot`
- `new`
- `incoming`
- `staff_required`
- `crew_only`

Rationale:
- `hot/new/incoming` are already stable in existing docs.
- Keep `staff_required` for "requires staff/crew support".
- Keep `crew_only` for "crew package only / crew-limited".

## 2) Legacy Value Mapping -> Canonical Key

Map legacy or inconsistent values during read/write normalization:

- `熱門` -> `hot`
- `新品` -> `new`
- `預計進貨` -> `incoming`
- `需搭人員` -> `staff_required`
- `需搭工作人員` -> `staff_required`
- `staff_required` -> `staff_required`
- `出班組限定` -> `crew_only`
- `crew_package` -> `crew_only`
- `crew-only` -> `crew_only`
- `crew_only` -> `crew_only`

Unknown value strategy:
- preserve raw value in audit log
- do not expose unknown keys to frontend tag badges until mapped

## 3) Inconsistency Resolution (`crew_package` vs `crew_only`)

Official standard:
- Use `crew_only` as the single canonical key.
- Treat `crew_package` as legacy alias and normalize to `crew_only`.

This avoids split logic in frontend filters and tag badges.

## 4) Frontend i18n Label Mapping Recommendation

Use tag key -> i18n dictionary mapping:

- `hot`
  - zh: 熱門
  - ja: 人気
  - en: Hot
- `new`
  - zh: 新品
  - ja: 新着
  - en: New
- `incoming`
  - zh: 預計進貨
  - ja: 入荷予定
  - en: Incoming
- `staff_required`
  - zh: 需搭人員
  - ja: スタッフ同伴必須
  - en: Staff Required
- `crew_only`
  - zh: 出班組限定
  - ja: クルー限定
  - en: Crew Only

## 5) Backend Normalize Proposal

Normalize tags at both write and read paths:

### Write path
- accept canonical + known legacy aliases
- normalize before persisting
- reject unknown keys (or quarantine with warning mode during transition)

### Read path
- normalize existing historical values before returning API payload
- output canonical keys only to frontend

## 6) Future Migration Suggestion (Not Executed Here)

Phase 1 (safe):
- add normalization in Edge Functions first
- keep backward-compatible alias mapping

Phase 2 (data cleanup):
- backfill existing rows: convert legacy values to canonical keys
- record conversion audit summary

Phase 3 (strict mode):
- enforce canonical-only validation (check constraint or app-level guard)

## 7) Contract Recommendation

API should return:
- `display_tags: string[]` (canonical keys only)
- optional `display_tags_raw: string[]` (debug/admin only, behind non-public scope)

This keeps public frontend simple and stable for filtering and i18n rendering.
