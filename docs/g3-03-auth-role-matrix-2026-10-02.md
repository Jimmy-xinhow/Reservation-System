# G3-03 已登入後台 API 角色矩陣（2026-10-02）

商用總表維持 **13/24**；本批是 G3-03 的一段證據，不代表整項通過。測試只寫入 staging 專案 `ongjsegewpnbkqugrpom` 的兩個一次性合成品牌；正式站及既有品牌未寫入，未發 LINE／Email／付款。

## 真實版本發現與修補

在 staging Web 的既有版本 `3ea8370b`，服務人員登入後讀 `GET /api/admin/chat?type=threads` 回 HTTP 500。`clinic_settings` 的 RLS 不允許 provider 讀品牌設定，但客服 GET 在回應 provider 空清單之前先呼叫 `isAdminModuleEnabled`。管理者／員工同路徑 200，證明不是客服表格本身故障。

候選修補僅把 provider 的三種讀取（threads/messages/unread）空回應移到模組設定查詢之前。非 provider 的模組關閉拒絕仍維持 403，寫入路徑不變。這讓服務人員拿不到客服內容，也不再碰無權讀取的 `clinic_settings`。

## 同資料庫、本機候選矩陣

用 staging Supabase 真實 Auth 建立隔離品牌 A/B、A 的品牌管理者／員工／服務人員各一組一次性身分，以及各品牌各一筆合成顧客、預約、報名、客服訊息。密碼只在程序記憶體，不輸出或保存。對本機編譯候選 Web 以真實登入 Cookie 發起 **29/29** 定向請求：

- 管理者與員工：顧客搜尋、結帳顧客／預約來源、服務紀錄來源、客服清單、報名與營運 CSV 均 HTTP 200，只含 A 標記，不含 B 的姓名、ID 或標記。
- 服務人員：顧客搜尋 200 空、結帳／服務來源 403、客服 200 空、兩種 CSV 307 拒絕、Rich Menu 圖片 401 拒絕。
- 品牌管理者：合併候選同品牌 200、外品牌來源 ID 404；竄改 active-clinic Cookie 指向 B 仍只回 A。員工／服務人員的合併候選均 403；外品牌 Rich Menu 版本查詢 404。

修補後定向模組測試 3/3、typecheck、contracts、build 通過。首次平行執行 typecheck/build 時，Next 刪改 `.next/types` 造成 typecheck 的暫時檔案錯誤；build 完成後獨立重跑 typecheck 為 0 錯誤。未以此局部結果代替主驗收。

## 測資與剩餘門檻

兩輪隔離測試的兩品牌、三 Auth 帳號及所有關聯列均按 ID 清理；最後以 service role **唯讀 49 項表／Auth 查核全為 0**。本機 manifest 僅記 ID、slug、建立／清理時間；不存密碼或金鑰。

候選修補尚須推送並取得 staging Web／worker 同 SHA，再只重測原失敗的 provider 客服 GET 和關鍵拒絕邊界。G3-03 另外仍缺正式版已登入輸出、其他品牌 Vault 及共用限流故障等整關證據，狀態保持「待驗證」。
