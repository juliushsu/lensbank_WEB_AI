# LensBank Display Tags Enum Lock v1 (Proposal Only)

Date: 2026-04-22  
Status: Proposal only (no migration execution, no production change in this doc)

## Purpose
This document is the single source of truth for `display_tags` across:
- DB
- Admin form input
- Frontend rendering
- i18n label mapping
- migration/normalize workflows

Goal: prevent enum drift such as `crew_package` / `coming_soon`.

## 1) Canonical Keys (Only Legal Values)

Only the following 5 keys are legal:
- `hot`
- `new`
- `incoming`
- `staff_required`
- `crew_only`

## 2) Legacy Value Mapping Table

Legacy value -> canonical key:
- `熱門` -> `hot`
- `新品` -> `new`
- `新上架` -> `new`
- `預計進貨` -> `incoming`
- `即將上架` -> `incoming`
- `coming_soon` -> `incoming`
- `需搭人員` -> `staff_required`
- `需搭工作人員` -> `staff_required`
- `出班組限定` -> `crew_only`
- `crew_package` -> `crew_only`

## 3) Forbidden Aliases / Values

Explicitly forbidden:
- `coming_soon` (forbidden alias; normalize to `incoming`)
- `crew_package` (forbidden alias; normalize to `crew_only`)
- Any direct Chinese label stored in DB
- Any key not listed in the canonical 5-key set is illegal

## 4) Implementation Rules

- DB stores canonical keys only
- Admin must normalize before persistence
- Frontend displays localized labels via i18n mapping
- API/public read must not output aliases

## 5) Acceptance Criteria

- DB has no alias tags
- DB has no Chinese tag values
- list/detail rendering is consistent
- zh/ja/en label rendering is correct

## Notes

- If unknown legacy values are found, treat them as invalid and route to migration/audit cleanup list.
- This file is a lock spec and should be referenced by DB constraints, form validators, and API normalization logic.
