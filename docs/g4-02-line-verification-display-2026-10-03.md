# G4-02 LINE 連線檢查提示：已確認根因與本機修補

- 範圍：staging 隔離品牌 34d483fb-c103-401a-8316-ecb39f9a811e；未改 LINE OA Webhook、資料庫設定或正式站。
- 2026-10-03 台北約 03:50，以品牌管理者登入 staging /admin/line 點「重新檢查連線」，頁面仍顯示「未通過」且技術明細為 delivery_error:internal。
- 隨後在已登入的 staging Supabase SQL Editor 以 BEGIN READ ONLY 查該品牌 clinic_line_channels 的三個非機密欄位。最新資料為 verification_status=error，last_verified_at=2026-10-02 19:50:20.528+00，verification_error=LINE Webhook URL 與本環境不符；請核對本頁下方的訊息接收網址。若此官方帳號也供其他環境使用，請勿直接覆蓋其 Webhook。
- 根因：server action 已將外部 URL 差異轉為固定、安全的操作提示並存入資料庫；app/admin/line/page.tsx 顯示時又呼叫 deliveryError，但固定提示未列入 lib/delivery-error.ts 的精確允許清單，因此第二次遮蔽為 internal。這是顯示缺陷；共用 OA 仍指向正式 Webhook，staging 連線檢查實際未通過。
- 本機窄修：只將該固定、無機密提示加入精確允許清單；任意帶入原文的錯誤仍保持遮蔽。scripts/test-delivery-error-privacy.mjs 155/155、npm run typecheck、npm run build 通過。
- 待證：推送及 staging 同版部署後，用原品牌現存錯誤直接重新整理頁面，應顯示可操作提示且維持「未通過」；不切換 OA Webhook。G4-02 與商用總表仍為待驗證，17/24 不變。