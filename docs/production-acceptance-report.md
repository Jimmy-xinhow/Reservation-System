# Reservation System v3 驗收證據報告

更新日期：2026-08-06

本報告記錄目前已取得的程式、正式 Supabase 資料庫與併發驗收證據。沒有外部服務設定或備份／還原證據的項目，仍維持未完成，不宣稱正式上線完成。

## 已完成

### 程式與提交

- `npm test`：PASS，契約測試包含租戶隔離、RLS、預約／報名／付款／CRM Lite 與 SQL 回歸檢查。
- `npm run typecheck`：PASS。
- `npm run build`：PASS。現有 lint warning 只涉及 custom font 與 `<img>`，不阻擋 build。
- `npm run smoke:public`：PASS；以本次 production build 在獨立 3199 port 執行，四個公開頁回 200，三支 Cron 未授權回 401。
- `npm audit --omit=dev`：PASS，0 vulnerabilities；依賴與原始碼檢查未發現實際密鑰值寫入版本庫。
- 預約顧客端（LINE／瀏覽器）已支援選填 Email；僅在身分驗證、租戶範圍與預約建立成功後寫入，更新失敗會取消該筆預約。
- 簡報視覺 token：深青／天藍／金色與 Noto Sans TC／Inter 字體基線已同步，`accent-700` CSS class 已由 production build 產生。
- client static output 掃描：未發現 `SUPABASE_SERVICE_ROLE_KEY`、金流／Email／LINE secrets 或 `service_role`／敏感資料欄位標記。
- GitHub `main` 已同步至 `7c09478`，包含 CRM Lite 自動化編輯／預覽、分眾顧客明細入口、分眾篩選保留與預約 Email（選填）。
- 已保留 smoke 與 Supabase CLI 暫存目錄，未納入提交。

### 正式 Supabase

- 專案：`Reservation system`。
- Project ref：`cmoacgcbxllfpwhiidsx`。
- 已依既有資料庫順序套用 CRM Lite、報名／付款、v3 hardening、會員／優惠券與 v4 role matrix。
- 目前 `public` 有 47 張資料表，全部啟用 RLS。
- 系統目錄檢查沒有 anon／public policy；核心預約與報名 RPC 僅 service role 可執行。
- 本輪 anon REST 探測回應為 404，未將其當作 RLS 正面證據；RLS 以正式庫系統目錄與政策檢查為準，仍需在可用的 staging／部署 REST 入口補做雙品牌 anon 攻擊驗收。
- 已登入 Supabase CLI 並以 linked project 執行唯讀 `select 1`，正式資料庫回傳 `healthcheck: 1`。
- 正式資料庫唯讀 schema 檢查確認 `patients.blocked_until` 存在，且 `patients` 已啟用 RLS。
- 本輪 linked 唯讀安全稽核回傳 `public_tables=47`、`rls_tables=47`、anon/public policy `=0`、authenticated policy `=93`；legacy secret 欄位 `=0`，核心預約／報名／取消 RPC 對 anon 與 authenticated 的 execute 權限均為 `0`。
- `supabase migration list --linked` 目前回傳空清單；正式 schema 的存在與交易行為已驗證，但 CLI migration history／獨立環境 replay 仍未建立，不能將其誤列為 migration replay 證據。
- `supabase db push --linked --yes` 實際執行並回傳 remote database up to date（`migrations=[]`）；因目前沒有標準 timestamp migration 目錄，此結果僅表示 CLI 沒有可推送的 migration，不等同於獨立環境 replay。
- 本機以隔離 PostgreSQL 16 建立 Supabase `auth`／角色最小替身後，從空資料庫首次重播 `supabase/schema.sql` PASS，第二次重播亦 PASS；重播後為 47/47 表啟用 RLS、anon policy `=0`、v3 必要表全數存在、legacy secret 欄位 `=0`，並確認核心預約／報名／候補／CRM RPC 已建立。此證據不取代 staging Supabase replay。

### 正式資料庫交易驗收

使用單一 transaction 建立暫時資料並 rollback，已通過：

- 時間制預約：同日重複顧客拒絕、跨品牌 doctor／patient 綁定拒絕。
- 號次制預約：號次遞增與容量封頂。
- 活動報名：容量、候補、QR 報到與重複 QR 報到冪等。
- 會員方案：報名扣點、預約扣點、餘額與 ledger 一致。
- 折扣碼：折扣金額、報名綁定、redemption audit 與使用次數一致。
- CRM Lite：標籤分眾刷新、投遞 claim 去重與跨品牌拒絕。
- 兩連線併發：容量 1 的預約最後只成功 1 筆；容量 1 的活動最後為 1 筆 `confirmed` 與 1 筆 `waitlisted`。
- 併發 fixture 清理後，clinic、doctor、patient、appointment、event、registration 殘留數均為 0。

## 尚未完成的外部驗收

- 備份／還原演練：本機沒有 Docker Desktop；已找到 PostgreSQL 16 `pg_dump.exe`，但尚未設定 Supabase DB connection string／password，仍未取得可還原 backup 證據。
- LINE LIFF、Rich Menu、webhook signature、destination mapping：需要品牌 Channel 設定與 secret。
- Email／行銷投遞：需要 Email provider、寄件網域與測試信箱。
- ECPay／NewebPay：需要 test merchant、金流設定與可接收的 callback URL。
- Cron 重跑：需要部署 URL 與 `CRON_SECRET`。
- 自訂網域／HTTPS：需要 DNS 控制權與正式 TLS／反向代理設定。

以上項目不是以程式碼推測代替實測；完成前不標記整體目標為 complete。
