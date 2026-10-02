# G3-01 全部 LINE push 來源的收件身分邊界（本機候選）

2026-10-01。沿 `pushMessages` 的九個呼叫點逐一讀取收件來源。前一版只補客服與後台測試推播，但預約、候補、報名、定時提醒、CRM 行銷、回訪、會員提醒仍使用可由品牌後台成員更新的 `patients.line_user_id` 或衍生列。即使資料列有 `clinic_id`，只靠該列仍不能證明 LINE ID 曾與這個品牌、這位顧客完成可信綁定。這是來源碼與 RLS 權限可重現的邊界缺口；沒有向真實外品牌 ID 發送訊息。

本機候選新增共用 `isVerifiedLineRecipient(service, clinicId, lineUserId, patientId)`，只在服務端查 `line_customer_identities` 的同品牌、同 LINE ID、`active=true`、同顧客 ID。該表在現有 schema 對 `anon`／`authenticated` 均撤銷權限。九個呼叫點的處置如下：

| 發訊來源 | 本機候選守衛 |
|---|---|
| 後台測試推播 | 本品牌有效顧客＋相符的驗證身分；客服推播另要求本品牌既有對話與驗證身分。 |
| 預約／報名狀態、候補 | 發訊前以來源列的顧客 ID 對驗證身分；候補先按本品牌候補 ID 取顧客 ID。 |
| 預約定時提醒、會員提醒 | 已 claim 的本品牌預約／會員顧客與驗證身分相符才推播；未相符則失敗／跳過，不碰 LINE。 |
| CRM 行銷、定時回訪 | 保留原 opt-in／品牌條件，另外核對同顧客驗證身分；不符時不發。 |

從 LINE webhook 進入客服時，先在已驗簽事件流程保存服務端身分；既有進行中的客服會話於下一則顧客訊息補建。瀏覽器／LIFF 報名與預約建立的身分仍使用現有 server-side ID token 驗證流程。舊有僅存在 `patients.line_user_id`、尚未建立驗證身分的資料，候選會拒絕 LINE 發送；部署前需盤點 staging 對象並確認補綁流程，不可將此本機候選直接算作線上通知通過。

定向相關測試 93/93、`npm run typecheck`、`npm run verify:contracts`、`npm run build` 通過；build 僅有原本的 `<img>` 警告。無 schema、套件或機密變更；未使用 service_role 讀取線上資料、未發 LINE、未部署 staging／正式。藍新原始 Notify 本批重讀官方規範與既有診斷仍無新密文或商店加密設定證據，維持停止重複測試卡付款。

G3-01、G2-03／G1-04 仍待驗證，24 項主驗收維持 **13/24**。先前四 SHA 的公開推送問題已因新增完整發訊修補而過時；只應以包含本候選的新具名範圍申請 staging 推送，完成同版真實對象、舊資料兼容與零外品牌發訊回測後再評估整關。
