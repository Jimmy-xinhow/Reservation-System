# G3-01 LINE 發訊收件身分守衛：本機候選

2026-10-01。`09d03291`／`69a73563` 的本機候選先以本品牌 `chat_messages` 或 `patients` 是否存在作為收件對象檢查。來源碼與目前 `supabase/schema.sql` 顯示，品牌後台成員的 authenticated RLS 允許管理這兩張表；若只信這些可改寫的列，已知的外品牌 LINE ID 仍可能被偽造成本品牌資料後送出。這是本機來源鏈的缺口，尚未對真實外品牌發訊。

本次候選在客服發送／封鎖及測試推播前，另查 `line_customer_identities` 中同品牌且 `active=true` 的身分；該表對 `authenticated`、`anon` 均撤銷權限，只能由服務端依驗證過的 LIFF ID token 或已驗簽的 LINE webhook 寫入。客服顧客從 webhook 進入支援流程時先建立身分；舊的進行中支援會話收到下一則訊息時補建。資料庫查詢失敗、缺身分均在寫入或 LINE push 前停止。原本的本品牌有效顧客／對話檢查仍保留。

本機定向 81/81（客服偽造列、測試推播偽造列、查詢失敗、停用模組及 webhook 邊界），`npm run verify:contracts`、`npm run build`、build 結束後的 `npm run typecheck` 通過。首次 typecheck 曾與 build 並行，遇到 `.next/types` 產生期間的 TS6053；按順序重跑通過，並非程式型別錯誤。未新增套件或 migration，未向 LINE 發訊，也未部署 staging 或正式站。

這只收斂客服與測試推播兩個可由後台提供 LINE ID 的入口。排程提醒、行銷、會員等其餘發訊來源仍需依各自經驗證的預約／報名／顧客關聯與線上同版證據判定；G3-01 和商用主驗收維持待驗證、13/24。已有三個舊 SHA 的公開推送問題尚未獲答覆；因本次發現使第三個舊 SHA 的守衛不足，**不得以舊授權問題推送該版**，應待新候選固定 SHA 後重新具名確認。
