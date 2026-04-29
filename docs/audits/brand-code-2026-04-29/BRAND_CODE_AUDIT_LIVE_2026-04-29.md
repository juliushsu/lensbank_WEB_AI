# LensBank 品牌代碼一致性 Audit Report

Date: 2026-04-29
Method: read-only audit via Supabase REST API
Project ref: `reczunexoejndosqzjal`
Tables checked: `brands`, `products`, `equipment_categories`, `category_brands`

## Summary

- `brands`: 85 rows
- `products`: 598 rows
- `equipment_categories`: 53 rows
- `category_brands`: 126 rows

Key findings:

- `products` **沒有** `brand_id`，目前是直接存 `brand` 文字代碼。
- `products` **沒有** `brand_name` / `producer` / `manufacturer` 之類 legacy 欄位。
- `products.category` 也是直接存文字代碼，不是 FK。
- `brands` 有 `code`，但沒有 `brand_code`、沒有 `slug`。
- `brands` 與分類不是直接欄位關聯，而是透過 `category_brands(category_id, brand_id)` 多對多表。
- `brands.code` 違反 UI 規則的品牌共有 7 筆。
- 額外還有 4 筆品牌名稱含前後空白。
- `products.brand` 指到不存在 `brands.code` 的 orphan reference 有 13 筆商品，集中在 `ZOOM` 與 `L005`。

## A. brands schema

`brands` 實際欄位：

- `id` uuid PK
- `name_zh` text
- `name_ja` text
- `icon_url` text
- `display_order` integer
- `is_active` boolean
- `created_at` timestamptz
- `updated_at` timestamptz
- `code` varchar(20)
- `name_en` text
- `sort_order` integer

確認結果：

- 沒有 `brand_code`
- 沒有 `slug`
- 沒有 `brand.category_id`
- 品牌與分類關聯改由 `category_brands.brand_id`

## B. products-brand relation 現況

`products` 實際欄位中與品牌/分類有關的只有：

- `brand` varchar(100)
- `category` varchar(50)
- `subcategory` varchar(100)

確認結果：

- 沒有 `brand_id`
- 沒有 `brand_name`
- 沒有 `producer`
- 沒有 `manufacturer`
- 沒有 `category_id`

目前 relation 現況：

- `products.brand` 存的是品牌代碼字串，例如 `A002`、`S003`、`ZOOM`
- `products.category` 存的是分類 code，例如 `C0004`
- `category_brands.brand_id -> brands.id`
- `category_brands.category_id -> equipment_categories.id`

重要觀察：

- `products.brand` 用的是 `brands.code`
- `products.category` 用的是 `equipment_categories.code`
- 但 `category_brands.category_id` 用的是 `equipment_categories.id`

這表示目前系統同時存在「code-based 關聯」與「id-based 關聯」兩種模式。

## C. 異常品牌清單

### 1. 不符合 `^[A-Z][0-9]{3}$` 的品牌 code

共 7 筆：

| brand_id | name_zh | code | 問題 |
|---|---|---|---|
| `ee1b5198-a43c-4ad0-9070-9713a50e4b98` | Lexar | `B0002` | 5 碼數字格式錯誤 |
| `b591b153-25b2-4cb6-8561-2e19613185cf` | Fujifilm | `FUJI` | 英文字，不是首字母+3位數 |
| `e1fb0083-3659-4575-bb22-d6b3fc3bd9e9` | Godox | `GODOX` | 英文字，不是首字母+3位數 |
| `a7fbfdf0-6bd2-4c4b-bc45-01317735e1d9` | Rode | `RODE` | 英文字，不是首字母+3位數 |
| `4e64bbad-7ac5-4628-987d-1463edb55fac` | GoPro | `GOPRO` | 英文字，不是首字母+3位數 |
| `8f7a700d-1a80-4f41-8b41-bc4a989480e8` | OSEE | `OSEE` | 英文字，不是首字母+3位數 |
| `9333d4fc-5b40-4249-8321-8da197e3586d` | MOMA | `MOMA` | 英文字，不是首字母+3位數 |

### 2. 名稱前後空白

共 4 筆：

| brand_id | current name_zh | current name_ja | code |
|---|---|---|---|
| `176fddab-9c05-46cb-bd06-e1bdc96076bd` | `PrismLens ` | `PrismLens ` | `P003` |
| `0e3bba29-35fa-4bf7-ac21-4ca15c85a13f` | `Cine Soft ` | `Cine Soft ` | `C002` |
| `a6b4d473-2397-472c-96fe-196d00bb5382` | `FUJINON ` | `FUJINON ` | `F002` |
| `38afd6e5-5e9b-44a5-924b-d5ccd6d1d9d4` | `NISI ` | `NISI ` | `N002` |

### 3. 重複品牌名稱 / 同品牌多筆

沒有重複 `code`。

但有疑似同品牌多筆：

| 問題 | 品牌 | codes |
|---|---|---|
| duplicate name | Lilliput | `L003`, `L006` |
| duplicate name | LensBank / Lensbank | `L004`, `X001` |

判斷：

- `Lilliput` 高機率是同品牌多筆。
- `LensBank` / `Lensbank` 高機率是大小寫不同造成的重複品牌。

## D. products orphan brand reference

### 1. `product.brand_id` 找不到 `brands.id`

不適用。

原因：

- `products` 沒有 `brand_id` 欄位。

### 2. `product` 只存品牌文字但沒有 `brand_id`

成立，而且是目前主流模式：

- 596 / 598 筆 `products` 有 `brand` 值，但沒有 `brand_id`
- 2 筆商品 `brand` 為 `null`

`brand is null` 的 2 筆商品：

| product_id | name_zh | category |
|---|---|---|
| `8daff101-2d2b-44a1-8945-61b5aeeb4c11` | Cine Soft FX 兩片組 1/2 1/4 | `C0008` |
| `8df23b33-28e4-4a6b-b3c2-7eb6ccd22c04` | DJI RS4 PRO | `C0005` |

### 3. `products.brand` 指向不存在的 `brands.code`

共 13 筆商品：

- `ZOOM`: 11 筆
- `L005`: 2 筆

明細：

| product_name | brand |
|---|---|
| Zoom F6 錄音機 | `ZOOM` |
| F4 | `ZOOM` |
| FRC-8 | `ZOOM` |
| Zoom F8 | `ZOOM` |
| Zoom FRC-8 | `ZOOM` |
| H8 | `ZOOM` |
| H6 BLACK | `ZOOM` |
| Zoom H6 BLACK | `ZOOM` |
| Zoom F4 | `ZOOM` |
| Zoom EXH-6 | `ZOOM` |
| F8 | `ZOOM` |
| 24mm f/14 2x Macro Probe (PL) 微距鏡 | `L005` |
| 12mm t/2.9 Zero-D Cine (PL) | `L005` |

補充：

- `brands` 裡其實有 `Zoom`，但 code 是 `Z008`
- `brands` 裡其實有 `Laowa`，但 code 是 `L002`

因此這 13 筆不是「完全找不到品牌名稱」，而是商品仍沿用舊 code 或錯 code。

## E. category / brand relation 現況

`category_brands` 沒有 orphan：

- `brand_id` 全都能對到 `brands.id`
- `category_id` 全都能對到 `equipment_categories.id`

但有 4 個品牌沒有任何分類連結：

- `L001` Leica
- `A005` ATOMOS
- `N003` Nanlite
- `Z002` Zhiyun

這不一定是錯，但可能代表後台品牌分類維護不完整。

## F. 可能修復策略

### Strategy 1: 保留現有 code

不建議直接保留現況，因為目前已經同時存在：

- 規範碼，例如 `Z008`
- 舊品牌字串碼，例如 `ZOOM`
- 疑似人工碼，例如 `L005`

這會讓 `products.brand` 與 `brands.code` 長期失去一致性。

### Strategy 2: 重新產生規範 code

可行，但要注意：

- `products.brand` 目前就是品牌代碼主資料來源之一
- 直接改 `brands.code` 會影響所有用 code join、filter、匯出與後台選單的地方

### Strategy 3: 新增 `legacy_code` 欄保存舊值

最建議。

建議做法：

1. 在 `brands` 新增 `legacy_code`
2. 先把現有 `brands.code` 備份到 `legacy_code`
3. 建立人工審核過的 canonical code mapping
4. 同步修正 `products.brand`
5. 最後再加 format / unique constraint

## G. 建議 SQL / migration 草案

### 1. staging-only schema change

```sql
alter table public.brands
  add column if not exists legacy_code text;
```

### 2. 備份現有品牌 code

```sql
update public.brands
set legacy_code = code
where legacy_code is null
  and code is not null;
```

### 3. 建立人工核准的 remap 表

```sql
create table if not exists public.brand_code_remap_staging (
  brand_id uuid primary key,
  old_code text,
  new_code text not null,
  canonical_name text,
  notes text,
  approved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 4. 依這次 audit 可先放入的 remap 候選

以下只是 staging 候選，先不要直接上 production：

```sql
insert into public.brand_code_remap_staging (brand_id, old_code, new_code, canonical_name, notes)
values
  ('b591b153-25b2-4cb6-8561-2e19613185cf', 'FUJI',  'F003', 'Fujifilm', 'old alpha code'),
  ('e1fb0083-3659-4575-bb22-d6b3fc3bd9e9', 'GODOX', 'G009', 'Godox',    'old text code'),
  ('a7fbfdf0-6bd2-4c4b-bc45-01317735e1d9', 'RODE',  'R002', 'Rode',     'old text code'),
  ('4e64bbad-7ac5-4628-987d-1463edb55fac', 'GOPRO', 'G010', 'GoPro',    'old text code'),
  ('8f7a700d-1a80-4f41-8b41-bc4a989480e8', 'OSEE',  'O003', 'OSEE',     'old text code'),
  ('9333d4fc-5b40-4249-8321-8da197e3586d', 'MOMA',  'M002', 'MOMA',     'old text code'),
  ('ee1b5198-a43c-4ad0-9070-9713a50e4b98', 'B0002', 'L007', 'Lexar',    'current code violates one-letter + 3-digit rule');
```

注意：

- 上面 `new_code` 只是草案，不保證沒有和未來新增品牌衝突
- `Lexar -> L007` 是依品牌首字母 L 暫擬；若 L 系列保留策略不同需再調整
- `GoPro -> G010`、`Godox -> G009` 也需先查是否和未來保留號碼策略衝突

### 5. 同步修正 products.brand

先依核准 remap 更新商品：

```sql
update public.products p
set brand = r.new_code
from public.brand_code_remap_staging r
join public.brands b on b.id = r.brand_id
where r.approved = true
  and p.brand = r.old_code;
```

### 6. 針對這次已知 orphan 先做 staging mapping

如果確認：

- `ZOOM` 應映射到 `Z008`
- `L005` 應映射到 `L002`

則 staging 可先試：

```sql
update public.products
set brand = 'Z008'
where brand = 'ZOOM';

update public.products
set brand = 'L002'
where brand = 'L005';
```

### 7. 清理名稱空白

```sql
update public.brands
set
  name_zh = btrim(name_zh),
  name_ja = btrim(name_ja),
  name_en = btrim(name_en)
where
  name_zh <> btrim(name_zh)
  or name_ja <> btrim(name_ja)
  or coalesce(name_en, '') <> btrim(coalesce(name_en, ''));
```

### 8. 後續再上 constraint

```sql
alter table public.brands
  add constraint brands_code_format_ck
  check (code ~ '^[A-Z][0-9]{3}$');

create unique index if not exists brands_code_uk
  on public.brands(code);
```

## H. 是否會影響現有商品與前台顯示

會，而且主要影響點不是 `brands` 本身，而是 `products.brand`。

### 會受影響的地方

- 前台若用 `products.brand` 直接做品牌過濾
- 後台商品編輯器若把 `products.brand` 當品牌值
- 任何以 code 做 join / 匯出 / API 條件的地方
- 舊商品若仍存 `ZOOM`、`L005`，在品牌管理畫面中可能無法正確對應到品牌主檔

### 不會受影響的情況

- 單純修改 `brands.name_*` 空白，不改 code
- 單純補 `legacy_code` 欄位

### 風險最高的操作

- 直接改 `brands.code` 但沒有同步改 `products.brand`
- 合併重複品牌但未處理商品/分類關聯

## I. 建議結論

建議順序：

1. 先在 staging 新增 `legacy_code`
2. 建一份人工核准的 brand code remap 表
3. 先修 `products.brand` orphan：`ZOOM`、`L005`
4. 再修 `brands.code` 規格外資料：`GOPRO`、`FUJI`、`GODOX`、`RODE`、`OSEE`、`MOMA`、`B0002`
5. 再處理重複品牌：`Lilliput`、`LensBank/Lensbank`
6. 最後才加 constraint 與後台 UI 驗證

## Artifacts

- [artifacts/brand_rest_audit_result.json](./artifacts/brand_rest_audit_result.json)
- [BRAND_CODE_AUDIT_REPORT_2026-04-29.md](./BRAND_CODE_AUDIT_REPORT_2026-04-29.md)
- [supabase/migrations/20260429_0003_brand_code_staging_only.sql](../../../supabase/migrations/20260429_0003_brand_code_staging_only.sql)
