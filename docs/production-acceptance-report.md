# Reservation System v3 驗收證據報告

更新日期：2026-08-06

本報告記錄目前已取得的程式、正式 Supabase 資料庫與併發驗收證據。沒有外部服務設定或備份／還原證據的項目，仍維持未完成，不宣稱正式上線完成。

## 已完成

### 程式與提交

- `npm test`：PASS，契約測試包含租戶隔離、RLS、預約／報名／付款／CRM Lite 與 SQL 回歸檢查。
- `npm run typecheck`：PASS。
- `npm run build`：PASS。現有 lint warning 只涉及 custom font 與 `<img>`，不阻擋 build。
- `npm run smoke:public`：PASS；以本次 production build 在獨立 3209 port 執行，十一個公開頁（`/`、`/register`、`/register/pay`、`/book/browser`、`/book/browser/my`、`/book/browser/reschedule`、`/book/reschedule`、`/register/cancel`、`/payment/result`、`/embed/register`、`/admin/login`）回 200，三支 Cron 未授權回 401。
- Playwright UI recon：以正式 Supabase runtime 與 active brand 在 3210 port 執行，桌面 1440×900／手機 390×844 的首頁、報名、瀏覽器預約、嵌入與後台登入皆無 application/page error；瀏覽器預約可切換初診並填入姓名／電話。Google Fonts 請求受測試環境網路政策阻擋，未影響頁面渲染，列為外部資源限制。
- `.ics` runtime 驗收：錯誤日期回 400、正常內容回 200、CRLF 注入行不存在，Content-Type 為 `text/calendar`。
- `npm audit --omit=dev`：PASS，0 vulnerabilities；依賴與原始碼檢查未發現實際密鑰值寫入版本庫。
- 預約顧客端（LINE／瀏覽器）已支援選填 Email；僅在身分驗證、租戶範圍與預約建立成功後寫入，更新失敗會取消該筆預約。
- 後台報名管理可由品牌營運角色在場次開始後將已確認報名標記為 `no_show`；更新受品牌／角色／狀態／時間條件限制，並沿用報名狀態稽核 trigger。
- 付費候補遞補後會由通知帶到品牌付款恢復頁；付款頁仍要求原報名憑證並由 server 重新驗證品牌、報名與付款狀態，不在通知連結中放入個資或金流密鑰。
- 候補／待付款通知會附上原報名產生的非個資憑證，讓顧客能在跨裝置情境完成付款或取消；資料庫保留 hash，另以 server-only AES-GCM 加密保存供失敗通知重試使用，不保存明文。
- 活動自訂表單由報名 API 重新驗證必填勾選、文字／日期／選項欄位型別，不能只依賴瀏覽器端驗證。
- 簡報視覺 token：深青／天藍／金色與 Noto Sans TC／Inter 字體基線已同步，`accent-700` CSS class 已由 production build 產生。
- client static output 掃描：未發現 `SUPABASE_SERVICE_ROLE_KEY`、金流／Email／LINE secrets 或 `service_role`／敏感資料欄位標記。
- 公開品牌解析只採用實際 `Host`，不信任可由直接請求偽造的 `x-forwarded-host`，並已加入契約測試防止跨品牌 header 租戶混淆。
- GitHub `main` 已包含最新程式／驗證提交 `7df64c1`，包含 CRM Lite 自動化編輯／預覽、分眾顧客明細入口、分眾篩選保留、報名行銷同意同步至 CRM 顧客、預約 Email（選填）、公開報名設定缺失時的 fail-closed 防護、公開品牌 Host 租戶邊界修正、`.ics` 輸出安全修正與圖片上傳內容驗證。
- 已保留 smoke 與 Supabase CLI 暫存目錄，未納入提交。

### 正式 Supabase

- 專案：`Reservation system`。
- Project ref：`cmoacgcbxllfpwhiidsx`。
- 已依既有資料庫順序套用 CRM Lite、報名／付款、v3 hardening、會員／優惠券與 v4 role matrix。
- 目前 `public` 有 47 張資料表，全部啟用 RLS。
- 系統目錄檢查沒有 anon／public policy；核心預約與報名 RPC 僅 service role 可執行。
- 本輪正式 Supabase REST RLS 讀取驗收：先以固定 UUID 建立合成品牌／顧客資料，再由 legacy anon 與 publishable key 查詢 `patients`、`appointments`、`registrations`、`payment_orders`、`crm_delivery_logs`；均回 HTTP 200 且空陣列（body length 2），未輸出金鑰。測試後品牌、設定、顧客殘留數均為 0；匿名 key 無法讀取敏感資料，雙品牌跨租戶攻擊仍需 staging 測試資料補做。
- 已使用 Supabase CLI `2.111.0` 登入並以 linked project 執行唯讀 `select 1`，正式資料庫回傳 `healthcheck: 1`。
- 正式資料庫唯讀 schema 檢查確認 `patients.blocked_until` 存在，且 `patients` 已啟用 RLS。
- 本輪 linked 唯讀安全稽核回傳 `public_tables=47`、`rls_tables=47`、anon/public policy `=0`、authenticated policy `=93`；legacy secret 欄位 `=0`，核心預約／報名／取消 RPC 對 anon 與 authenticated 的 execute 權限均為 `0`。
- 正式 Supabase 套用 `migration_security_advisor_hardening.sql` 後重新執行 `supabase db advisors --linked --type security`，資料庫函式／RPC 警告已清除，目前唯一剩餘警告是 Supabase Auth 控制面尚未啟用 leaked password protection；此項需在 Supabase Dashboard 的 Auth 密碼安全設定完成。
- 正式 Supabase 已套用 `migration_registration_credentials.sql`，唯讀 schema 查詢確認 `public.registrations.checkin_token_encrypted` 為 `text`。
- 正式 Supabase 已套用 `migration_marketing_opt_in_sync.sql`，唯讀 schema 查詢確認 `create_or_get_public_patient_with_marketing_opt_in(uuid, text, text, date, text, boolean)` 已建立；報名勾選行銷同意時會在同一 transaction 內將 CRM 顧客 `marketing_opt_in` 設為 `true`，未勾選不會覆蓋既有同意。
- `supabase migration list --linked` 目前回傳空清單；正式 schema 的存在與交易行為已驗證，但 CLI migration history／獨立環境 replay 仍未建立，不能將其誤列為 migration replay 證據。
- `supabase db push --linked --yes` 實際執行並回傳 remote database up to date（`migrations=[]`）；因目前沒有標準 timestamp migration 目錄，此結果僅表示 CLI 沒有可推送的 migration，不等同於獨立環境 replay。
- 本機以隔離 PostgreSQL 16 建立 Supabase `auth`／角色最小替身後，從空資料庫首次重播 `supabase/schema.sql` PASS，第二次重播亦 PASS；重播後為 47/47 表啟用 RLS、anon policy `=0`、v3 必要表全數存在、legacy secret 欄位 `=0`，並確認核心預約／報名／候補／CRM RPC 已建立。此證據不取代 staging Supabase replay。
- 本輪安全 advisor 修正後，隔離 PostgreSQL replay 首次／第二次均 PASS；47/47 表啟用 RLS、anon policy `=0`，內部函式對 anon／authenticated execute 權限均為 `0`，`touch_updated_at`／`sync_patient_birthday_mmdd` 已固定空 `search_path`。

### 正式資料庫交易驗收

使用單一 transaction 建立暫時資料並 rollback，已通過：

- 時間制預約：同日重複顧客拒絕、跨品牌 doctor／patient 綁定拒絕。
- 號次制預約：號次遞增與容量封頂。
- 活動報名：容量、候補、QR 報到與重複 QR 報到冪等。
- 會員方案：報名扣點、預約扣點、餘額與 ledger 一致。
- 折扣碼：折扣金額、報名綁定、redemption audit 與使用次數一致。
- CRM Lite：標籤分眾刷新、投遞 claim 去重與跨品牌拒絕。
- 報名行銷同意：報名 API 傳入 `marketing_opt_in` 後，正式資料庫同步更新同租戶 CRM 顧客狀態。
- 報名行銷同意正式 transaction 驗收：首次勾選同步、後續未勾選不撤銷、再次勾選更新既有顧客，測試資料已 rollback。
- 兩連線併發：容量 1 的預約最後只成功 1 筆；容量 1 的活動最後為 1 筆 `confirmed` 與 1 筆 `waitlisted`。
- 併發 fixture 清理後，clinic、doctor、patient、appointment、event、registration 殘留數均為 0。

## 尚未完成的外部驗收

- 備份／還原演練：本機沒有 Docker Desktop；已找到 PostgreSQL 16 `pg_dump.exe`，但尚未設定 Supabase DB connection string／password，仍未取得可還原 backup 證據。
- LINE LIFF、Rich Menu、webhook signature、destination mapping：需要品牌 Channel 設定與 secret。
- Email／行銷投遞：需要 Email provider、寄件網域與測試信箱。
- ECPay／NewebPay：需要 test merchant、金流設定與可接收的 callback URL。
- Cron 重跑：需要部署 URL 與 `CRON_SECRET`。
- Railway：帳號 `jimmy@xinhow.com.tw` 已登入，但本 repo 尚未連結專案；`railway status` 無法取得服務與部署狀態，需指定正確 project／environment 後才能執行部署驗收。
- 報名通知重試：部署環境需設定 `REGISTRATION_TOKEN_ENCRYPTION_KEY`（至少 32 字元）；正式資料庫欄位已套用，但目前未替部署環境代填秘密值。
- 自訂網域／HTTPS：需要 DNS 控制權與正式 TLS／反向代理設定。

以上項目不是以程式碼推測代替實測；完成前不標記整體目標為 complete。
