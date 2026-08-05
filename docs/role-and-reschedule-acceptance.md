# Provider 權限與改期一致性驗收補充

## Provider 權限

- `doctor_assignments` 以品牌、醫師、帳號建立明確指派；沒有指派時採 fail-closed，不顯示任何門診資料。
- provider 在首頁、儀表板與佇列只查詢已指派醫師；首頁顧客電話遮罩。
- CRM、顧客名單、報名、報表、排程設定、品牌設定等非工作範圍頁面拒絕 provider 直接進入。
- 管理員可在帳號管理頁設定 provider 的醫師指派；品牌 owner 不可被改角色或移除。
- `doctor_assignments` 有 RLS：provider 只能讀自己的指派，owner/admin 才能管理指派。
- 核心 `doctors`、`schedule_templates`、`schedule_exceptions`、`appointments`、`patients`、`patient_records`、`serving_numbers` RLS 會再依指派醫師限縮列範圍；provider 不能直接查同品牌其他醫師資料。
- provider 只能把被指派預約標記為「完成／未到」；資料庫 trigger 會拒絕改動病患、醫師、時間、金流、備註等其他欄位，叫號控制對 provider 為唯讀。

## 櫃檯改期與套票

- `reschedule_appointment` 在同一個資料庫交易中鎖定原預約、建立新預約、恢復原套票扣抵、扣抵新預約並取消原預約。
- 新預約保留原服務項目；套票扣抵失敗時整筆交易回滾，不留下半完成狀態。
- `cancel_appointment` 在同一個資料庫交易中鎖定原預約、恢復套票額度並改為 `cancelled`；後台、顧客自助與 LINE 取消共用此函式，任何一步失敗都不留下半完成狀態。
- 本地可驗證：`npm test`、`npm run typecheck`、`npm run build`。
- staging 必須再驗證 PostgreSQL 函式、RLS、provider 跨醫師讀寫、兩個同時改期／取消請求與套票 ledger 前後餘額；目前沒有 staging Supabase 連線，因此這些仍是外部驗收項目。
