# 品牌代碼議題四方會議 Memo

日期：2026-04-29

## 1. 本次問題摘要

本次 audit 確認，品牌資料目前同時存在規範 code、舊文字 code 與錯置 code，造成 `products.brand` 與品牌主檔之間已有不一致情況。已知異常包含：`brands.code` 有規格外值、`products.brand` 有 orphan reference，且現行資料模型同時混用 code-based 與 id-based 關聯，若直接調整主鍵關聯方式，風險會高於收益。

## 2. 現行資料模型結論

目前正式結論是：`products.brand` 存的是 `brands.code`，不是 `brand_id`。`products` 沒有 `brand_id` 欄位；`category_brands.brand_id -> brands.id` 則是另一套存在中的 id-based 關聯，因此品牌模組現況是 code 與 id 兩種模式並存。

## 3. 已確認風險

- `brands.code` 可為 `null`，主資料缺少必填保護。
- 現場已存在 legacy code / 舊文字 code，例如 `ZOOM`、`L005`。
- 缺少 DB constraint，尚未鎖住 format 與唯一性。
- 目前已確認 `products.brand` 有 orphan reference，代表商品與品牌主檔可能持續脫鉤。

## 4. 短期處理

- 前端防呆：新增 / 編輯品牌時先擋不合法 code。
- 自動編號：新品牌 code 由系統產生，避免人工自由輸入。
- 商品品牌選單顯示 code：後台商品品牌選單需明確顯示品牌名稱 + code，降低誤選與沿用舊碼風險。

## 5. 中期建議

先完成 staging audit 與對照驗證，再決定是否整理 legacy code。若 staging 驗證後確認舊碼仍被前台、後台或匯出流程依賴，應先建立 mapping 與驗收，再談清理，不建議跳過 audit 直接重編。

## 6. 不建議現在直接改 UUID `brand_id` 的理由

- 現況商品主資料是以 `products.brand` code 運作，不是以 `brand_id` 運作。
- 直接改成 UUID 會牽動前台篩選、後台編輯器、API 條件、匯出與既有 join 邏輯。
- 既有 orphan 與 legacy code 尚未清乾淨，現在切主關聯只會把髒資料搬到新模型。
- 目前缺少完整 staging 驗證結果，貿然切換會提高回歸風險，也不利四方同步驗收。

## 7. 下一步驗收清單

- 確認 `products.brand` 全數可對回有效 `brands.code`，無 orphan。
- 確認新建品牌流程會自動產生合法 code，前端不可手動送出非法值。
- 確認商品品牌選單可清楚顯示品牌名稱與 code。
- 確認 staging 中 legacy code 的實際使用面已盤點完成。
- 確認是否需要整理 legacy code，再決定是否補 DB constraint。
- 確認本階段不改 DB 主關聯、不做 UUID `brand_id` 切換。
