# LensBank brand code staging 執行順序建議

日期：2026-04-29

## 1. 執行 migration 前檢查

先確認 `brands.code` 可安全上最小約束，至少要檢查：

```sql
select id, code
from public.brands
where nullif(btrim(code), '') is null;
```

```sql
select code, count(*)
from public.brands
group by code
having count(*) > 1;
```

```sql
select id, name_zh, code
from public.brands
where code !~ '^[A-Z][0-9]{3}$'
order by code, id;
```

```sql
select id, name_zh, brand
from public.products
where brand is not null
  and not exists (
    select 1
    from public.brands b
    where b.code = public.products.brand
  )
order by brand, id;
```

若 `brands.code` 出現 `null / blank / duplicate`，先不要跑 migration；要先清理後再執行。

## 2. 執行 `20260429_0004_brand_code_min_safe_constraints_staging_only.sql`

執行：

```sql
-- run staging only
\i supabase/migrations/20260429_0004_brand_code_min_safe_constraints_staging_only.sql
```

這支 migration 會做以下事情：

- 前置檢查 `brands.code` 是否有 `null / blank / duplicate`
- 新增 `brands.code_is_legacy`
- 將不符合 `^[A-Z][0-9]{3}$` 的 `brands.code` 標記為 legacy
- 對 `brands.code` 加 `NOT NULL`
- 對 `brands.code` 加 `UNIQUE`
- 對 `brands` 加格式檢查，但允許 legacy 暫時存在
- 對 `products.brand -> brands.code` 加 `NOT VALID` FK

## 3. 檢查 legacy code

跑完 migration 後，先確認哪些品牌被標成 legacy：

```sql
select id, name_zh, code, code_is_legacy
from public.brands
where code_is_legacy = true
order by code, id;
```

目前依 audit 預期，至少應包含：

- `B0002`
- `FUJI`
- `GODOX`
- `RODE`
- `GOPRO`
- `OSEE`
- `MOMA`

若還出現其他 legacy code，需先確認是不是 staging 真實資料差異，不要直接推下一步。

## 4. 檢查 orphan `products.brand`

migration 後 FK 雖已建立，但因為是 `NOT VALID`，既有 orphan 仍可能存在。請再次確認：

```sql
select id, name_zh, brand
from public.products
where brand is not null
  and not exists (
    select 1
    from public.brands b
    where b.code = public.products.brand
  )
order by brand, id;
```

依 2026-04-29 audit，已知重點是：

- `ZOOM`
- `L005`

## 5. 修復 orphan 的建議 SQL

若 staging 確認：

- `ZOOM` 應對應 `Z008`
- `L005` 應對應 `L002`

則可先在 staging 修正：

```sql
update public.products
set brand = 'Z008'
where brand = 'ZOOM';
```

```sql
update public.products
set brand = 'L002'
where brand = 'L005';
```

修正後再次確認 orphan 已清空：

```sql
select id, name_zh, brand
from public.products
where brand is not null
  and not exists (
    select 1
    from public.brands b
    where b.code = public.products.brand
  );
```

若結果仍非 0 筆，不可進入 validate 階段。

## 6. 重新驗證新增品牌與商品上架

請至少做兩組 staging 驗證：

品牌新增驗證：

- 新增合法 code，例如 `T001`，應成功
- 新增重複 code，應失敗
- 新增非法 code 且未標 legacy，應失敗

商品上架驗證：

- 建立 `products.brand =` 現有有效 `brands.code`，應成功
- 建立 `products.brand =` 不存在 code，例如 `ZOOM`，應失敗
- 修改既有商品品牌 code，若新值不存在於 `brands.code`，應失敗

## 7. 最後何時可以 `VALIDATE CONSTRAINT`

只有在以下條件全部成立時，才可以執行：

```sql
alter table public.products
  validate constraint products_brand_fk_to_brands_code;
```

必要條件：

- orphan `products.brand` 已清為 0
- staging 品牌新增流程已驗證可擋非法 / 重複 code
- staging 商品新增 / 修改流程已驗證會受 FK 保護
- legacy code 清單已被人工確認，不存在誤標或未盤點項目
- 四方已同意目前 canonical code mapping

## 8. 哪些情況下不得推 production

以下任一成立，都不得推 production：

- `brands.code` 仍有 `null / blank / duplicate`
- `products.brand` 仍有 orphan reference
- `ZOOM`、`L005` 這類舊碼尚未完成 mapping 與驗收
- legacy code 清單尚未被業務 / 後台 / 工程共同確認
- staging 尚未完成新增品牌、商品上架、商品編輯、品牌篩選等 smoke test
- 尚未確認前台、後台、匯出、API 是否仍依賴 legacy code
- 還沒有決定 legacy code 的最終處理策略

## 建議順序總結

1. 先跑前檢，確認 `brands.code` 沒有 `null / blank / duplicate`
2. 執行 `20260429_0004_brand_code_min_safe_constraints_staging_only.sql`
3. 盤點 legacy code 清單
4. 修正 orphan `products.brand`
5. 驗證新增品牌與商品流程
6. orphan 清為 0 後，再 `VALIDATE CONSTRAINT`
7. staging smoke test 全部通過後，才討論 production 方案
