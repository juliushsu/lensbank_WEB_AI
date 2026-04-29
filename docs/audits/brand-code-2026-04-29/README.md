# Brand Code Audit 2026-04-29

This audit pack is prepared for shared online discussion across product, backend, operations, and admin stakeholders.

## What is included

- [Live audit report](./BRAND_CODE_AUDIT_LIVE_2026-04-29.md)
  - Read-only findings from the connected Supabase project
  - Confirms actual schema, current relation mode, anomaly counts, orphan references, and impact
- [Repo-based audit report](./BRAND_CODE_AUDIT_REPORT_2026-04-29.md)
  - Earlier workspace audit
  - Useful as a baseline for how the codebase represented the schema before live verification
- Raw audit snapshot
  - [artifacts/brand_rest_audit_result.json](./artifacts/brand_rest_audit_result.json)
- Staging-only migration draft
  - [supabase/migrations/20260429_0003_brand_code_staging_only.sql](../../../supabase/migrations/20260429_0003_brand_code_staging_only.sql)

## Recommended reading order

1. Read the live audit first.
2. Review the proposed repair strategy and migration draft.
3. Use the raw JSON only when you need exact anomaly payloads for follow-up work.

## Notes

- No production write was performed during this audit.
- The migration draft is intentionally marked staging-only.
