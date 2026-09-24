# Staging 原始碼可重現基線（待審草稿）

日期：2026-09-24。本分支從 GitHub `main` `19c3b4757a86608a96537fb45c3738a086860c7c` 建立，承接正式付款八欄收據／限流熱修補，再納入目前工作區的應用程式、設定、資料庫遷移與測試。它是來源管理候選，**不是正式部署或商用 24/24 簽核**。

## 範圍與版本界線

- staging Web `61bfff58-83e6-4477-becd-891debdf6e1f` 為 `SUCCESS`，來源是 CLI 上傳，Railway 沒有 Git commitHash。production Web `2eddad9a-2ff6-4419-a42f-f689ac606c4a` 為 `SUCCESS`，來源是 GitHub main `19c3b475...`。本分支不更動兩者的部署。
- 原始工作區有 202 個修改的追蹤檔及 1,287 個未追蹤檔；其中 589 個 `.playwright-cli` 紀錄、暫存日誌、八張截圖、下載 CSV 及大量歷史驗收快照均未帶進此程式 PR。納入共 389 個程式／設定／遷移／測試檔（含兩份測試所需的 JSON 範圍清單）；另以本文件說明取捨。
- 對 `app`、`lib`、`components`、`public`、`types`、`supabase` 逐檔比對原工作區與本分支：126 個檔只有 CRLF/LF 差異，**內容差異 0**；原工作區另有九個 `supabase/.temp` 本機 CLI 狀態檔未帶入。此比對證明本分支的主要執行程式與當前工作區內容一致；CLI staging 部署本身無來源雜湊，仍須 Git 來源部署與線上回歸才能證明日後可重建。
- GitHub main 原有的四支付款／限流熱修補測試保留。付款收據單元測試更新為目前 `transition_verified_payment` 原子 RPC 的呼叫契約，並納入標準 `npm test`；沒有為了測試改動付款業務程式。

## 乾淨來源驗證

- 隔離 worktree 執行 `npm ci --prefer-offline --no-audit --no-fund` 成功。
- `npm test` 契約通過，主測試 **1,561/1,561**，員工與 Storage 各 **4/4**；`npm run typecheck` 通過。
- `npm run build` 在允許下載 Google Fonts 的環境完成；第一次隔離沙箱建置只因 `next/font` 無法取得字型而失敗，重跑後編譯與 33 頁靜態生成成功。仍有兩處既有 `<img>` 效能警告。
- 修改檔未掃到 JWT、私鑰、常見 live API key 或寫死的長憑證；`git diff --cached --check` 通過。此掃描是防誤提交措施，不取代完整安全稽核。

## 合併與商用限制

本分支先作草稿審查，尚未合併或切換 staging／production 的來源。正式資料庫仍有未套用的產品遷移，獨立 Supabase 還原、真實 LINE／Email、藍新 sandbox、網域、真機與店家試營運仍依商用驗收總表待驗。不得用乾淨 build 或草稿 PR 代替 G3-05、G3-06 或 24/24 簽核。
