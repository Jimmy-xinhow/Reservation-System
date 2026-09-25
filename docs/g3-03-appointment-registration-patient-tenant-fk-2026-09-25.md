# G3-03 預約／報名顧客跨品牌關聯修補（2026-09-25）

狀態：**部分證據，整關待驗證；商用主驗收 10/24 不變。** 本批只改 staging 資料庫；候選 Web 程式尚未推送或部署，正式資料庫與正式 Web 未修改。

## 實際重現與影響

- 修補前，在 staging 兩個隔離品牌中，service-role 可新增「品牌 A 預約 → 品牌 B 顧客」關聯；品牌 A 管理者真實登入後，`GET /api/admin/service-record-sources?kind=appointment` 回 HTTP 200，包含品牌 B 的合成顧客姓名。根因是 `appointments.patient_id` 僅以單欄外鍵指向 `patients.id`，後台服務角色查詢嵌入顧客時繞過 RLS。`registrations.patient_id` 有同類單欄外鍵，納入同一修補。
- 修補前唯讀全表盤點：staging 顧客 18、預約 10、報名 12；正式顧客 45、預約 65、報名 6。兩環境的已存在跨品牌／缺失顧客關聯都為 0。正式環境只讀，沒有測試寫入。
- 初次重現腳本清理時，先刪預約遇狀態稽核外鍵 `23503`。已按原測資 ID 先刪稽核事件再刪來源，兩品牌與顧客等殘留回查 0；後續腳本調整清理順序。

## 修補與真實回測

- 候選程式：`service-record-sources` 取顧客 `clinic_id`，只有與登入品牌相同才輸出來源；負向定向測試涵蓋一般與搜尋回傳。資料庫 migration `202609250003` 對預約及報名新增 `(clinic_id, patient_id)` 複合外鍵，驗證既有資料後移除舊單欄外鍵，避免 PostgREST 關聯歧義；`schema.sql` 同步。
- staging 遷移前建立 public schema／資料 PostgreSQL custom dump，使用目前 Windows 使用者 DPAPI 加密，檔案 `tmp/staging-source-baseline/tmp/g303-pre-tenant-fk-public.dump.dpapi`；記憶體解密確認 `PGDMP`、原始 1,034,695 bytes，明文檔不存在。這是本次 public DDL 的回復材料，**不是** Auth／Vault／Storage 完整還原驗收。
- `supabase db push --dry-run --linked` 顯示只待 `202609250003`；遷移實際套 staging 成功，原 SQL 再跑一次成功；`supabase db lint --linked --schema public --level warning --fail-on warning` 為零錯誤／警告。
- 遷移後同一 staging 的兩個新隔離品牌：跨品牌預約與報名寫入各以 `23503` 拒絕；同品牌預約與報名新增成功；已登入品牌管理者讀舊 Web 的來源 API HTTP 200，兩種同品牌來源均可見、外品牌姓名不可見。這也確認移除舊外鍵後，該嵌入查詢未出現 `PGRST201`。
- 候選程式定向測試 5/5、`npm run typecheck`、`npm run build`、`npm run verify:contracts` 通過。第一次 build 因沙盒阻斷 Google Fonts 下載失敗，開放既有字體下載後成功；沒有為此改產品程式。
- 本批按 ID 清理 2 個品牌、4 個一次性 Auth，以及顧客／醫師／預約／報名／活動／場次；測試腳本逐項回查 0，獨立 staging QA 品牌 0、近期 QA Auth 0。一筆 8/12 舊 QA Auth 不屬本批，未動。

## 待辦與簽核界線

1. 候選程式先提交並經明確授權推送至公開草稿 PR #12，等待 staging Web 同版部署，再定向回測 API 的新回傳守衛與其餘預約／報名嵌入頁。
2. 該完整新版本只跑一次七項 Playwright，再跑一次 staging release gate；本批沒有把本機測試或舊版 gate 計入主驗收。
3. 正式資料庫雖無既存錯連，但尚未套此 migration；需先有正式回復材料與部署／回退窗口。G3-03 其他入口、匯出與故障模式仍待，G3-05 完整還原環境使用者已暫緩，均不能簽核。

## 同類外鍵盤點與交付文件

- staging `pg_constraint` 唯讀盤點找到 33 條指向 `patients` 的外鍵，其中本批新預約／報名及既有服務紀錄 3 條含 `clinic_id`；其餘 30 條仍只以顧客 ID 關聯。這是**結構風險清單，不等同 30 個可利用漏洞**；仍須逐表核對寫入路徑、RLS 與服務角色回傳。本批不以外鍵名稱推論外洩。
- 嘗試對 31 個顧客關聯欄位做全表計數時，通用 REST 腳本依序在 `crm_segment_members`、`customer_submission_requests` 遇到無通用 `id` 的 `42703`。兩次均未產生完成的計數證據，因此停止該腳本；後續需改用資料庫目錄導出的主鍵或單次 SQL 聚合，不原樣重跑。
- README 既有環境 migration 順序原停在第 77 步，漏列其後 17 支。候選文件已補至 94 步；核對 86 支時間戳檔案與 README 清單數量及順序完全一致。README 與候選 Web 尚未推送，不能視為已發布交付文件。
