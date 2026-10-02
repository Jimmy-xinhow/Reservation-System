# G3-03：跨品牌來源關聯的資料層候選修補

2026-09-28 08:40 UTC 對固定 staging `ongjsegewpnbkqugrpom` 與正式 `cmoacgcbxllfpwhiidsx` 各執行 `set role postgres; begin read only` 聚合盤點，未輸出資料 ID、個資或連線憑證，亦未寫入兩環境。檢查的預約→服務／人員、活動場次／票種→活動、報名→活動／場次／票種、教材→活動，以及會員→方案／方案→服務，兩環境現存錯連各類均為 **0**。staging 有預約 10、報名 12、教材 5；正式有預約 65、報名 6、教材 5。這是當下既有資料狀態，不代表單欄外鍵能拒絕新錯連；先前 staging 隔離測資已實證服務角色可建立其中三種跨品牌關聯。

固定在獨立本機分支 `codex/tenant-relation-fk` 的候選 `202609280002_tenant_source_relation_foreign_keys.sql` 新增八個同品牌／同活動複合外鍵。遷移前先檢查上述八類關聯，任何歷史錯連即中止；驗證新外鍵後才移除對應舊單欄外鍵，避免 PostgREST 的通用巢狀關聯產生雙重路徑。沿用原本 `ON DELETE` 行為，並同步 `supabase/schema.sql` 和 README。會員方案關聯沒有改動，因其 staging 實際插入測試已由現有守衛拒絕。

本機驗證：

- 既有合成資料備份還原至隔離 PostgreSQL，migration 首跑、重跑均成功；八個新外鍵都處於 validated。這不是正式顧客資料或正式備份全量還原。
- 全新本機庫的核心 public schema 與 migration 首跑、重跑成功，八個外鍵 validated；完整 `schema.sql` 在本機缺 `supabase_vault` extension，於該擴充套件處停止，因此**不能**把此批稱為完整新環境建置通過。
- 合成資料庫在單一 rollback transaction 內做九種不合法更新／插入：外品牌預約服務／人員、外品牌場次／票種的活動、外品牌報名活動／場次／票種、同品牌但不同活動的報名場次、外品牌教材活動，**9/9** 被外鍵拒絕。
- `npm run typecheck` 通過；`npm run build` 在允許既有 Google Fonts 下載的執行環境通過。第一次受沙箱網路限制，字型下載 `EACCES`，非程式編譯錯誤。
- 兩個具名本機測試資料庫已刪除並獨立確認剩餘 **0**，本機 PostgreSQL 已停止。沒有建立 staging 測資或修改正式站。

2026-09-29 03:49 UTC 再對固定 staging 執行唯讀查詢：預約 10、報名 12、教材 5，八種待限制關聯的既有錯連仍各為 0；資料庫仍只有八個舊單欄外鍵，尚無此批複合外鍵。遠端 migration 紀錄至 `202609280001`，此批 `202609280002` 未套用。檢查應用程式和測試的具名 PostgREST 關聯，沒有引用這八個將移除的外鍵名稱；migration 檔案與 9/28 本機負向測試時的 blob 相同。候選已重放到 staging Web 同版基底 `eb357da6`，`npm run typecheck` 與 `npm run build` 再次通過；這不取代部署後的 PostgREST 巢狀查詢回測。

此修補目前僅為**本機候選**，尚未推送、未套用 staging 或正式資料庫。先前三個 Web 修補及測試 fixture 已在 `eb357da6` staging 通過唯一同版 release gate，這支 migration 不在該次具名推送範圍。G3-03 保持待驗證；商用主驗收 **10/24** 不變。
