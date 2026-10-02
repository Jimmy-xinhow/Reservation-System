# G4-02 渠道檢查：真實付款證據接回後台候選

- 2026-10-03 台北 03:57，在 staging 隔離品牌重新按「通知與付款檢查」；五項仍為通過 2／待完成 3。付款列固定顯示「尚未完成測試交易」，Email 列固定顯示「尚未寄送測試信」。
- 已存在的藍新官方測試交易 APTMURCNYNN60FAA2DB 在 staging 唯讀對帳：payment_orders.status=paid、payment_transactions.status=accepted、相同 event_key 的 payment_webhook_events.processed_at 非空且 error 為空。訂單與 Webhook 均在目前品牌付款設定 updated_at 之後。此證據來自真實官方網關自然 Notify，不是合成回呼。
- 根因是 app/admin/channels/actions.ts 對 Email 與付款兩列無條件寫入 warning，從不讀既有實測稽核。這使店家即使付款成功也無法從自助頁得到相符結果。
- 本機候選只修付款：查目前品牌、供應商與環境的付款設定時間；以同品牌、同供應商且在設定後的已處理無錯回呼，關聯接受的交易及 paid 訂單，三者都有才標記通過。找不到或設定曾變更則維持待完成；頁面仍提醒付款返回需另驗。沒有新增交易、付款操作、migration 或讀取密鑰。
- Email 寄送資料庫的 sent 只證明系統／供應商接受，不能單憑它證明收件匣送達；因此這輪不把 Email 自動標綠，既有警示仍待設計可稽核的人工收件確認。LINE LIFF 因共用 OA Webhook 指向正式站也保持待完成。
- 本機：新付款正例與未處理／拒絕／待付／設定變更負例 5/5；既有投遞安全測試 155/155、typecheck、build、contracts 通過。待 staging 同版部署與真登入重新檢查，預期付款一項由待完成轉通過，整項 G4-02 與商用總表仍待驗證／17/24。