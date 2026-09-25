# G3-03：會員提醒跨品牌顧客關聯

狀態：staging 資料庫已完成定向修補與回測；候選 Web 尚未推送／部署。**G3-03 整項與商用主驗收仍待驗證，10/24 不變。**

## 真實重現

在指定 staging Supabase `ongjsegewpnbkqugrpom` 建立兩個隔離品牌、兩位合成顧客及品牌 A 會員方案。修補前，service-role 成功建立「品牌 A 會員 → 品牌 B 顧客」資料；會員提醒使用的 `patient_memberships` 嵌入查詢可取出 B 的合成姓名及 `example.invalid` Email。同品牌會員也正常可讀。只查詢，**沒有呼叫 Cron、LINE 或 Email 發送**。第一輪七筆已建測資按 ID 刪除，殘留 0。

根因：`patient_memberships.patient_id` 只有指向 `patients.id` 的單欄外鍵；提醒服務角色以會員的 `clinic_id` 篩選後仍能沿錯連讀取外品牌顧客。這證明顧客資料可能被送往錯誤品牌流程；因未啟用外部送達，本批沒有宣稱真實跨品牌訊息已寄出。

## 修補及回測

- 新 migration `202609250004_membership_patient_tenant_link.sql` 先核對歷史資料，再建立並驗證 `(clinic_id, patient_id)` 複合外鍵；移除舊單欄外鍵，避免既有 `patients(...)` 查詢關聯歧義。`supabase/schema.sql` 同步。
- 會員提醒另外讀取顧客 `clinic_id`，若與工作品牌不同就中止該品牌處理，且不建立投遞紀錄或發訊。這是 Web 與 DB 不同版期間的防護，候選 Web 尚未部署。
- staging `db push --dry-run` 僅列這一支；遷移前 public custom dump 已以 Windows DPAPI 加密、記憶體解密核對 `PGDMP`，明文檔已移除。此回復材料**不等於**完整 Supabase Auth／Vault／Storage 還原。
- staging 首跑及相同 SQL 重跑成功；PostgREST 正向嵌入查詢可用，`db lint` 零警告，後續 dry-run 無待套 migration。第二輪隔離回測：外品牌會員新增以 `23503` 拒絕；同品牌會員寫入及關聯查詢成功，外品牌合成姓名／Email 不在查詢結果。
- 候選本機會員／提醒定向測試 **27/27**、typecheck、build、`verify:contracts` 均通過。未為這一變更重跑七項 Playwright 或 release gate。
- 兩輪共建立的 13 個品牌／顧客／方案／會員 ID 精確回查均 0，`qa-g303-m%` 品牌查窗 0；沒有測試 Auth 或外部通知。正式 DB／Web 未寫入。

## 剩餘簽核

此修補尚未推送至公開草稿 PR #12，Web 仍為 `e2745b04`；需經新提交的明確推送授權、staging 同版部署及會員提醒定向回測後，才可把 Web 防護視作線上證據。G3-03 的其他入口、正式故障情境及 24 項剩餘條件仍依總表逐項驗證。新 migration 也尚未納入先前 36 支合成庫重播結果，G3-05 不得因此簽核。
