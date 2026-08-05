# Reservation System v3 Staging 驗收 Runbook

本文件是正式 staging 驗收的執行順序與證據格式。它不能被本機 `build` 或靜態契約檢查取代；每一項都要保存執行時間、環境、測試資料識別與結果。

## 0. 驗收前提

- 使用獨立 staging Supabase project，不直接在正式資料庫試跑。
- 先完成可還原備份，並確認操作者有 SQL Editor、Auth、Cron、LINE、Email、金流與 DNS 的必要權限。
- 建立兩個品牌 `Brand-A`、`Brand-B`，兩個不同後台帳號，各只加入對應品牌；另建立一個同時加入兩品牌的管理員帳號。
- 測試資料使用假姓名、假電話、假 Email 與測試 LINE 帳號，不使用真實病患個資。
- 產生並保存部署環境的 `CRON_SECRET`、`BROWSER_BOOKING_SECRET`、`PAYMENT_SECRETS_JSON`；金鑰不寫入本文件、不提交 Git。

## 1. 建置與 migration

全新資料庫：

1. 執行 `supabase/schema.sql`。
2. 執行 `npm test`、`npm run typecheck`、`npm run build`。

既有資料庫：

1. 先備份，再依序執行 `migration_crm_lite.sql`、`migration_registration_payments.sql`、`migration_v3_hardening.sql`、`migration_memberships_coupons.sql`、`migration_role_matrix_v4.sql`、`migration_security_advisor_hardening.sql`。
2. 每支 migration 執行一次後重跑同一支，確認可重跑且沒有重複 constraint／policy 錯誤。
3. 檢查 `reminder_logs.clinic_id`、付款欄位、表單版本、會員 ledger 與所有新表的 row count／NULL。
4. 重新執行三個本機命令並保存輸出。

## 2. 租戶與角色隔離

| 測試 | 操作 | 必須觀察的結果 |
|---|---|---|
| 品牌建立 | Brand-A 的 owner 建立 Brand-B | DB transaction 同時建立品牌、預設設定與 owner 成員；中途失敗不得留下半套資料 |
| 品牌切換 | 同一帳號切換 A／B | 後台資料、公開品牌名稱、服務、活動、報表跟著 active brand 改變 |
| URL 猜測 | 以 A 的 session 查 B 的 id、slug、活動 id、報名 id、付款 id | 回傳空資料或拒絕，不可洩漏 B 的 PII、金額或狀態 |
| 角色矩陣 | provider、frontdesk、admin、owner 各執行設定、匯出、報到、CRM、成員管理 | 只能執行規格允許的操作；不能只靠前端隱藏按鈕達成 |
| provider 指派範圍 | provider 查詢未指派醫師的 `doctors`、`appointments`、`patients`、`schedule_templates`，並嘗試修改他人預約 | 回傳 0 筆／拒絕；只能讀被指派資料，且只能標記完成／未到；叫號控制為唯讀 |
| anon RLS | 以 anon key 查 `patients`、`appointments`、`registrations`、`payment_orders`、`crm_delivery_logs` | 所有查詢均被拒絕或回傳 0 筆；不可讀取其他品牌資料 |

證據至少包含：兩個品牌 id、兩個使用者 id、每個跨品牌請求的 HTTP status／response 摘要、Supabase RLS 結果截圖或 log。

## 3. 預約流程與競態

### 3.1 時間制

1. 為同一服務提供者建立同一星期的上午、下午、晚診三段模板。
2. 驗證查空位包含三段，且不使用單一 `limit 1` 模板。
3. 開啟初診延長，建立一筆初診與一筆複診重疊請求；確認容量依區間重疊計算。
4. 對最後一個名額送出兩個平行預約請求；只能一筆成功，另一筆必須收到額滿／競態拒絕。
5. 取消後確認狀態為 `cancelled`、歷史仍存在、名額釋放；改期確認舊紀錄保留且有新紀錄。
6. 若預約使用套票，分別從後台、瀏覽器／LIFF 與 LINE 取消；確認 `cancel_appointment` 交易後預約只保留歷史狀態、套票只恢復一次，重送取消不得重複恢復。後台取消另須確認 `cancel_appointment_by_operator` 僅接受同品牌非 provider 成員，且 `appointment_status_events.actor_id` 記錄實際操作員。

### 3.2 號次制

1. 建立兩個不同時段模板，驗證每診獨立計算容量與號碼。
2. 平行搶最後一號；只能一筆成功，號碼不重用。
3. 驗證取消與 `no_show` 不佔位，`booked／confirmed／done` 佔位。

### 3.3 訂金

1. 開啟 `deposit_enabled`，分別測試 `all`、`self_pay`、`none`。
2. 預約建立後狀態應為待付款並保留 15 分鐘名額；付款成功才變成 `confirmed`。
3. 待付款超時後執行 registration cron，預約應取消、訂金狀態變為失敗、pending payment order 變為 expired、名額釋放；若預約使用套票，付款失敗 webhook 的 `fail_appointment_payment` 也須只回補一次堂數。

## 4. 報名、表單、候補與報到

1. 建立公開活動、私密活動、兩場次、免費票與付費票。
2. 發布表單 v1，完成一次報名；再建立 v2，確認舊報名的 `form_id／form_version／registration_answers` 仍指向舊版本。
3. 平行送出最後名額，確認不超賣；額滿後依序進入候補。
4. 取消一筆有效報名，執行候補遞補；同一候補不可重複遞補或重複通知。
5. 使用有效 QR 報到、過期／錯誤憑證、重複掃描各一次，保存三種結果與操作者。
6. 付費報名測試付款成功、失敗、逾時與同一回呼重送；不得重複確認、扣除會員額度或寫入交易。

## 5. 會員、套票與優惠碼

- 建立預約用、報名用與兩者皆可用的套票方案。
- 一次預約／一張指定票只能扣一堂；扣抵、取消、付款失敗與報名逾時都要檢查 ledger 前後餘額，取消須確認 `restore` 的 idempotency key 不重複。
- 同一流程輸入套票與優惠碼必須被拒絕。
- 優惠碼測試固定折扣、百分比、最低金額、有效期與使用上限；平行使用不能超過上限。
- 付費流程失敗或取消不可留下已套用但沒有對應使用紀錄的額度／折扣。

## 6. CRM Lite 與行銷自動化

1. 建立標籤、未回訪、完成次數、未到次數、生日月份五種分眾，刷新後人工核算人數。
2. 建立 `appointment_done`、`birthday`、`inactive` 三種自動化，分別測試 LINE 與 Email。
3. `marketing_opt_in=false`、顧客被封鎖、缺少渠道身份時，必須跳過並寫入原因。
4. 連續執行兩次 marketing cron，確認同一顧客／事件／渠道不重複投遞；冷卻期內不可再發。
5. 讓 LINE／Email provider 回傳錯誤，確認單筆寫入 failed、整批其他顧客仍繼續。
6. 取消行銷同意後再次執行，確認待發訊息被跳過；保存投遞 log 與 server log。

## 7. 通知、入口與品牌化
4. 預約建立、付款確認、取消與改期後，確認 LINE／Email 各自最多投遞一次；檢查 appointment_notification_logs 的 kind、channel、status、attempt_count 與失敗重試結果。

- LINE：驗證 LIFF ID token、Rich Menu、webhook signature、destination 對應品牌；錯誤 destination 不得 fallback 到其他品牌。
- 瀏覽器：驗證必要欄位、生日精確命中、signed token 過期與跨品牌 token 拒絕。
- Email：使用 staging 寄件網域與測試信箱，確認提醒、報名狀態與行銷信件的成功／失敗紀錄。
- 嵌入元件：在另一個測試網站 iframe 開啟，確認 `clinic_slug` 或自訂網域仍正確解析。
- 自訂網域：新增 DNS TXT、驗證成功後才啟用；未驗證／停用網域不得成為公開品牌入口。
- 逐一保存 LIFF、瀏覽器、嵌入與自訂網域的手機畫面與 network response，確認沒有 service role、金流密鑰或不必要 PII。

## 8. 報表與匯出

用固定測試資料人工計算並對照畫面與 CSV：預約量、報名量、未到率分母、候補填補率、付款摘要、CRM 投遞摘要。每份證據要記錄品牌、日期範圍、時區與最後更新時間。provider 角色的匯出必須遮蔽姓名、電話與 Email。

## 9. 備份、恢復與排程重跑

1. 在 staging 建立備份，執行一次 migration／測試資料寫入，再以備份還原到獨立資料庫。
2. 確認品牌、預約、報名、付款、CRM ledger 與通知 log 均可讀取。
3. 讓提醒／報名／行銷 cron 在中途失敗後重跑，確認去重鍵、`notification_processed_at` 游標、retry window 與結果一致；先製造超過單批上限的狀態事件，確認較早事件不會被餓死。
4. 保存 Cron authorization、HTTP status、summary、錯誤 log 與資料庫前後差異。

若環境沒有 Docker，可使用已安裝的 PostgreSQL client 直接做 logical dump；請把 Supabase Dashboard 的 connection string 只放在目前 PowerShell session 的環境變數，不要寫入檔案或提交 Git：

```powershell
$env:SUPABASE_DB_URL = "<dashboard connection string>"
& "C:\Program Files\PostgreSQL\16\bin\pg_dump.exe" --format=custom --no-owner --file C:\tmp\reservation-system-staging.dump $env:SUPABASE_DB_URL
```

還原時必須使用獨立 staging／temporary database，並保存 dump checksum、還原前後 row count 與結構檢查結果；不可直接覆蓋正式資料庫。

## 10. 交付判定

只有第 1–9 節均有 staging 證據，且無 P0／P1 缺陷，才可在 `docs/acceptance-matrix.md` 將「外部驗收」改為 PASS。若缺少 Supabase、第三方帳號、DNS 或備份證據，狀態必須維持「未完成／待外部驗收」，不得宣稱正式上線。

## 11. 顧客端改期驗收

1. 由 LINE Rich Menu → LIFF 開啟「我的預約」，確認每筆未來預約都有「改期」入口；改期後舊預約為 `cancelled`、新預約保留同一病患與正確服務／醫師。
2. 由瀏覽器備援完成一次預約，確認同一品牌同一裝置可從「我的預約」查詢、取消與改期；換另一品牌的 `clinic_slug` 不得讀取原品牌預約。
3. 同時以兩個請求改到最後一個名額，只能一筆成功；失敗請求不得留下 active appointment，也不得重複扣除會員／套票額度。
4. 改期成功後確認 LINE／Email 通知各自只投遞一次，並在 `appointment_notification_logs` 留下 `rescheduled` 紀錄；若新預約需訂金，確認瀏覽器與 LIFF 都能進入付款流程。
