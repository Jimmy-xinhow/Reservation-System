# G1-01 品牌網域直接開啟 `/book` 的登入回跳

狀態：**本機候選通過定向檢查；staging 同版回測前，G1-01 仍待驗證。**

- 真實 staging Chrome：`https://booking-qa.laihowke.com/book?clinic_slug=qa-line-openroom-20260929` 進入 LINE `error400`，錯誤為 `invalid url`，其中 `redirectUriString` 是品牌網域 `/book`。該 LIFF 的 Endpoint 由後台設定在 staging Railway 網域；兩者來源不同。
- 原因：`useLiff` 在未登入時無條件以 `window.location.href` 呼叫 `liff.login`。LINE 僅接受 LIFF Endpoint 下的回跳網址，因此品牌網域直接入口被拒。
- 候選：公開入口設定回傳系統配置的 LIFF Endpoint 來源。`/book` 若由其他來源開啟，在載入 LIFF SDK 前改走既有瀏覽器入口；僅攜帶公開品牌、服務、日期等任務參數，不攜帶 LINE 身分或付款資料。符合 Endpoint 來源的 LIFF 入口維持原流程。
- 本機正式 build 頁面＋隔離 Chrome：以公開入口設定模擬品牌來源，`/book?view=booking&clinic_slug=...&service_id=...&date=2026-10-21` 自動落在 `/book/browser` 並完整保留三項參數，沒有進入 LINE 400。另直接讀取 staging 的相同瀏覽器入口，品牌標題、預選服務與日期均正確；沒有建立預約。
- 定向 `scripts/test-customer-entry.mjs` 20/20、`npm run typecheck`、`npm run build` 通過。未作 staging 版號一致的回測，不計入 24 項主驗收通過。
