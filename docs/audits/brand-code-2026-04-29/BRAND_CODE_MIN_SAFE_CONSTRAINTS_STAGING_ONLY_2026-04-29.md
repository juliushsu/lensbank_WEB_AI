# Brand Code 最小安全約束（staging only）

日期：2026-04-29

## 設計結論

本次 staging-only 約束採最小安全方案：

- `brands.code` 先加 `NOT NULL`
- `brands.code` 先加 `UNIQUE`
- 新增 `brands.code_is_legacy` 暫時標記 legacy code
- `brands` 加 `CHECK`：非 legacy 必須符合 `^[A-Z][0-9]{3}$`
- `products.brand` 加 FK 指向 `brands.code`
- FK 採 `NOT VALID`，避免已知 orphan product code 直接阻斷 migration

## 為什麼這樣設計

目前 audit 已確認：

- `products.brand = brands.code` 是現行關聯模式
- `brands.code` 有 7 筆規格外值
- `products.brand` 有 13 筆 orphan reference，集中在 `ZOOM` 與 `L005`
- `products.brand` 另有 2 筆 `null`

因此如果直接上嚴格 `CHECK` 與已驗證 FK，migration 會被現有 staging 資料擋住。最小安全版本的目標不是一次清乾淨，而是先保護未來新資料，同時保留 staging 清理空間。

## Migration 檔案

- [20260429_0004_brand_code_min_safe_constraints_staging_only.sql](/Users/chishenhsu/Desktop/Codex/LensBankWEB/shared/lensbank_WEB_AI/supabase/migrations/20260429_0004_brand_code_min_safe_constraints_staging_only.sql)

## Rollback SQL

```sql
begin;

alter table public.products
  drop constraint if exists products_brand_fk_to_brands_code;

alter table public.brands
  drop constraint if exists brands_code_format_or_legacy_ck;

alter table public.brands
  drop constraint if exists brands_code_uk;

alter table public.brands
  alter column code drop not null;

alter table public.brands
  drop column if exists code_is_legacy;

commit;
```

## 風險說明

- 這不是 production migration；它依賴 staging 現況與清理順序。
- `products.brand` 的 FK 是 `NOT VALID`，代表既有 orphan 仍存在，但新寫入與後續更新會開始受到保護。
- 若 staging 其實還有未被 audit 捕捉到的 `brands.code` null / blank / duplicate，migration 會在前置檢查時直接 fail，且整筆 transaction rollback。
- `code_is_legacy` 只是暫時豁免，不應當成長期模型。

## 是否會炸現有資料

依 2026-04-29 audit 結果推估：

- 不會因 `products.brand` 既有 orphan 直接炸掉，因為 FK 是 `NOT VALID`
- 不會因既有 legacy code 直接炸掉，因為會先標記 `code_is_legacy = true`
- 會在以下情況中止：
  - `brands.code` 存在 null / blank
  - `brands.code` 存在 duplicate

換句話說，這版 migration 的目標是「如果資料狀況比 audit 更髒，就安全中止；如果符合 audit 現況，就先把最小安全護欄架起來」。
