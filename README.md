# 預約與報名 SaaS 平台

多品牌預約與報名 SaaS:**預約 · 報名 · 標準金流 · 提醒 · CRM Lite · 報表 · 後台管理**。顧客主要由 LINE Rich Menu → LIFF 進入，也支援瀏覽器備援、自訂網址、嵌入元件與自訂網域。

多租戶以 `clinic_id` 作為相容租戶鍵，品牌資料完全隔離；同一登入帳號可依授權管理多個品牌。行為差異由 `clinic_settings` 與品牌設定驅動。

> 規範見 `AGENTS.md`／`CLAUDE.md`(最高規則)與 `clinic-booking-spec-v3.md`(功能、開發與驗收規格)。v2 與 SaaS v1 僅為歷史文件。
>
> 驗收證據與外部環境待辦見 `docs/acceptance-matrix.md`。

## 技術棧

- Next.js 15(App Router, TypeScript strict)
- Supabase(Postgres + 後台 Auth)
- Tailwind CSS v4
- LINE Messaging API(推播/webhook)+ LIFF
- Vercel Cron(提醒排程)

正式環境相依套件：`@supabase/supabase-js`（資料存取）、`@supabase/ssr`（後台登入狀態）。`@playwright/test` 只用於驗收與 CI，不會加入正式執行內容。

---

## 公開入口 smoke

部署後可用不含密鑰的 HTTP smoke 檢查公開頁與 Cron 未授權邊界：

```powershell
$env:SMOKE_BASE_URL = "https://your-staging.example.com"
npm run smoke:public
```

它會確認公開入口回 200，並確認 reminders、registration、marketing、membership、Rich Menu 五支 Cron endpoint 在沒有密鑰時均回 401；不會建立或修改任何資料。`/api/cron/richmenu` 也作為本次產品重整的部署版本指紋，若為 404，代表目標環境仍是未包含 Rich Menu 排程的舊版本。

瀏覽器備援的 signed token、同品牌顧客擁有權及跨品牌拒絕，可在 Railway staging 執行下列資料 audit。腳本只接受 `RAILWAY_ENVIRONMENT_NAME=staging`，使用臨時 QA 資料並在結束時清理：

```powershell
railway run npm run audit:staging-browser-identity
```

要一次執行公開 smoke 與五支 staging domain audit，使用：

```powershell
railway run npm run audit:staging-core
```

`audit:staging-core` 僅允許 `RAILWAY_ENVIRONMENT_NAME=staging`，任何一個 gate 失敗都會立即停止並回傳非零狀態；各 domain audit 仍負責清理自己的臨時品牌、帳號與交易資料。

GitHub Actions 提供兩個關卡：

- `Verify`：每次 pull request 與 main 更新執行型別、契約與 production build。
- `Staging release gate`：手動指定已部署的 staging 網址，先跑六組資料／API 驗收，再建立臨時四身分帳號，以 Chromium 驗證系統管理者、系統員工、品牌管理者與品牌員工的桌機／手機權限導覽；完成後清理臨時資料。

`Staging release gate` 必須在 GitHub 的 `staging` Environment 保存 `NEXT_PUBLIC_SUPABASE_URL`、`NEXT_PUBLIC_SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`CRON_SECRET`、`BROWSER_BOOKING_SECRET`。密鑰不放在 workflow、程式碼或執行輸出中。

---

## 一、Supabase 設定

1. 建立 Supabase 專案。
2. SQL Editor 貼上並執行 **`supabase/schema.sql`**(建表、RPC、RLS、權限)。
   - 套用前先設定 `.env.local`／部署環境中的 Email 與金流 server secrets；schema 會清除並移除舊版資料庫內的 legacy 密鑰欄位。
3. 建立一個品牌租戶與其預設設定,並建立後台帳號對應:

```sql
-- 1) 品牌租戶
insert into clinics (name) values ('示範品牌') returning id;
-- 記下回傳的 clinic id,以下用 :clinic_id 代表

-- 2) 預設 clinic_settings(出廠即可用)
insert into clinic_settings (clinic_id) values ('<clinic_id>');
-- 其餘欄位皆有預設值:time 模式、不延長首次服務、一電話一人、不收訂金、前置30分、可約30天

-- 3) 後台帳號:先在 Authentication → Users 以 email/密碼建立一名使用者,取得其 user id,
--    再建立其與品牌的對應(後台 RLS 以此判斷可存取哪個品牌)
insert into clinic_members (clinic_id, user_id, role, access_type, permissions)
values ('<clinic_id>', '<auth_user_id>', 'admin', 'brand_admin', array['brand.manage', 'operations.manage']);

-- 4)(選用)新增服務提供者、服務時段,亦可改由後台「服務排程」頁建立
```

4. 相容單品牌部署時，把預設品牌 id 填進 `NEXT_PUBLIC_CLINIC_ID`；SaaS 模式不可只依賴此變數，必須使用登入後的品牌 context。

5. 第一個品牌與品牌管理者建立後，系統管理者可在「系統總控台 → 品牌租戶」建立其他品牌；品牌管理者仍可在「品牌與系統設定」管理自己可存取的品牌。建立流程會在資料庫內原子建立品牌、預設 `clinic_settings` 與品牌管理者資格。兩層管理者都可新增所屬員工並逐項授予工作權限。

> `clinic_members` 是本系統為實作「後台只能存取自己品牌」所需的租戶成員表。一筆代表某 auth 使用者可管理某品牌。

---

## 二、環境變數

複製 `.env.example` 為 `.env.local` 並填入:

| 變數 | 說明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 專案 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key(公開,僅後台 Auth 用) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key,**只在 server 端**,絕不可進 `NEXT_PUBLIC_*` |
| `NEXT_PUBLIC_CLINIC_ID` | 相容單品牌部署的預設品牌 id；SaaS 模式不可作為隔離邊界 |
| `PUBLIC_SHARED_HOSTS` | 允許使用 `NEXT_PUBLIC_CLINIC_ID` fallback 的共享公開 host，逗號分隔；未設定時未知自訂 host 會拒絕 |
| `PUBLIC_PLATFORM_HOSTS` | 顯示平台官網首頁的正式 host，逗號分隔；其他品牌 host 依租戶解析 |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API channel access token(推播/回覆) |
| `LINE_CHANNEL_SECRET` | Messaging API channel secret(驗 webhook 簽章) |
| `LINE_CHANNEL_ACCESS_TOKENS_JSON` | 多品牌 webhook destination → access token JSON；僅 server environment |
| `LINE_CHANNEL_SECRETS_JSON` | 多品牌 webhook destination → channel secret JSON；僅 server environment |
| `RESEND_API_KEYS_JSON` | 多品牌 `clinic_id` → Resend API key JSON；僅 server environment，不寫入資料庫 |
| `RESEND_EMAIL_FROM_JSON` | 多品牌 `clinic_id` → 寄件人 JSON；僅 server environment，寄件人只由部署環境設定 |
| `RESEND_API_KEY` / `RESEND_EMAIL_FROM` | 單品牌相容 fallback；僅 server environment |
| `PAYMENT_SECRETS_JSON` | 多品牌 `clinic_id` → `{hashKey,hashIv}` JSON；僅 server environment，不寫入資料庫 |
| `REGISTRATION_TOKEN_ENCRYPTION_KEY` | 報名通知重試用 AES-GCM 加密金鑰（至少 32 字元）；僅 server environment，不寫入資料庫 |
| `LINE_LOGIN_CHANNEL_ID` | LIFF 所屬 channel id(驗 ID token 用) |
| `NEXT_PUBLIC_LIFF_ID` | 顧客端 LIFF ID |
| `PLATFORM_ADMIN_USER_IDS` | 平台總後台 bootstrap 管理員 UUID（逗號分隔；僅 server environment） |
| `CRON_SECRET` | Vercel／Railway Cron 呼叫提醒、報名逾時、行銷與 Rich Menu 排程 endpoint 的密鑰(長亂數) |
| `REMINDER_HOURS_BEFORE` | 預約前幾小時發提醒(預設 24) |
| `MEMBERSHIP_LOW_BALANCE_THRESHOLD` | 會員餘額提醒門檻（預設 1 堂） |
| `MEMBERSHIP_EXPIRY_NOTICE_DAYS` | 會員到期前提醒天數（預設 7 天） |
| `APP_URL` | 公開 canonical URL；付款回呼／回跳與 Railway Cron 都使用此 server-side 網址 |
| `CRON_TARGET_URL` | 可選，覆寫提醒 endpoint 的完整 URL |
| `CRON_MARKETING_TARGET_URL` | 可選，覆寫 CRM Lite 行銷 endpoint 的完整 URL |
| `CRON_REGISTRATION_TARGET_URL` | 可選，覆寫報名／付款逾時 endpoint 的完整 URL |
| `CRON_RICHMENU_TARGET_URL` | 可選，覆寫 Rich Menu 顯示排程 endpoint 的完整 URL |

---

## 三、LINE 設定

1. **Messaging API channel**:取得 access token 與 channel secret。
2. **Webhook URL**:設為 `https://<你的網域>/api/line/webhook`,並開啟「使用 webhook」。
   - 系統會驗 `x-line-signature`(HMAC-SHA256 / `LINE_CHANNEL_SECRET`)。
   - 提醒訊息的「確認／取消」按鈕以 postback 回寫預約狀態。
3. **LIFF**:在對應 channel 新增一個 LIFF app,Endpoint URL 設為 `https://<你的網域>/book`,取得 LIFF ID 填入 `NEXT_PUBLIC_LIFF_ID`;其所屬 channel id 填入 `LINE_LOGIN_CHANNEL_ID`。
4. 在後台「LINE／LIFF」設定品牌的 connection mode、destination、Login Channel ID、LIFF ID 與 endpoint；獨立品牌渠道缺少任一必要欄位時 fail-closed。
5. 在「Rich Menu」由預約型、活動型或綜合型模板另存草稿，通過圖片／動作／模組／渠道驗證後再發布；系統保留版本、發布事件、下架與回復紀錄，不會先刪除線上舊版。已存在於 LINE 的版本可建立 Alias 頁籤、排定台北時間顯示期間，並以 LINE 官方 Insights 對照匿名預約／報名轉換。
6. 多品牌 webhook：在各品牌公開設定填入 LINE webhook payload 的 `destination`；若各品牌使用不同 LINE channel，將 destination 對應的 secret／access token 放入 `LINE_CHANNEL_SECRETS_JSON`／`LINE_CHANNEL_ACCESS_TOKENS_JSON`，不可放到前端或資料庫。

> 多品牌必須同時維護 `clinics.line_destination` 與兩張 credential map；只要任一 map 已啟用，未對應的 destination 會 fail-closed，不會回退到預設品牌 token。Rich Menu 與 webhook 回覆中的 LIFF 連結也會帶入目前品牌的 `clinic_slug`。

> 顧客端永不直接連 Supabase:LIFF 頁只呼叫本專案 API route,server 端以 service role 操作。前端送來的 `line_user_id` 一律先用 LIFF ID token 向 LINE 驗證後才採用。

---

## 四、本機開發

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # 生產建置
npm run typecheck  # tsc --noEmit
npm run verify:contracts  # 規格、路由、RLS 與秘密邊界靜態檢查
```

- 顧客預約頁:`/book`(需在 LINE/LIFF 環境;或設好 `NEXT_PUBLIC_LIFF_ID` 後於 LINE 內開啟)。
- 後台:`/admin`(未登入導向 `/admin/login`)。

---

## 五、Railway 部署(資料庫/Auth 仍用 Supabase)

DB 與 Auth 維持 Supabase(照第一節建好 schema 與帳號即可),Railway 只負責跑 Next.js app 與 cron。

### (a) Web 服務

1. 在 Railway 由本 repo 建立服務。Nixpacks 會自動偵測 Next.js,依 `railway.json`:`npm run build` → `npm run start`(`next start` 會讀 Railway 注入的 `PORT` 並綁 `0.0.0.0`,無需設定)。
2. 在該服務的 **Variables** 填入下列環境變數:

   **Server-only(務必設,且不可外洩):**
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `LINE_CHANNEL_ACCESS_TOKEN`
   - `LINE_CHANNEL_SECRET`
   - `LINE_LOGIN_CHANNEL_ID`
   - `LINE_CHANNEL_ACCESS_TOKENS_JSON` / `LINE_CHANNEL_SECRETS_JSON`
   - `RESEND_API_KEYS_JSON` / `RESEND_EMAIL_FROM_JSON`
   - `PAYMENT_SECRETS_JSON`
   - `BROWSER_BOOKING_SECRET`
   - `REGISTRATION_TOKEN_ENCRYPTION_KEY`
   - `CRON_SECRET`(長亂數)
   - `REMINDER_HOURS_BEFORE`(選填,預設 24)

   **NEXT_PUBLIC_(建置時打包進前端):**
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_CLINIC_ID`
   - `NEXT_PUBLIC_LIFF_ID`

3. 在 Settings → Networking 產生公開網域(Generate Domain),取得類似 `https://your-app.up.railway.app` 的網址。

> `NEXT_PUBLIC_*` 在 build 階段就會被內嵌進前端,改值後需 **重新部署** 才生效。

### (b) Cron 服務(提醒、報名與行銷排程)

Railway **不會** 讀 `vercel.json`,所以排程另外做。`npm run reminders` 會由同一支腳本依序呼叫預約提醒、CRM Lite 行銷、指定日期回訪、報名付款逾時／通知與 Rich Menu 排程五個 endpoint:

1. 由同一個 repo **再建一個服務**(或用 Railway 的 Cron 功能),設定:
   - **Custom Start Command**:`npm run reminders`(即 `node scripts/trigger-reminders.mjs`,跑完即退出)
   - **Cron Schedule**:`0 * * * *`
   - **Variables**:
     - `CRON_SECRET`(與 web 服務相同)
     - `APP_URL`(web 服務的公開網址,例如 `https://your-app.up.railway.app`)
      — 或分別改設 `CRON_TARGET_URL`、`CRON_MARKETING_TARGET_URL`、`CRON_FOLLOWUP_TARGET_URL`、`CRON_REGISTRATION_TARGET_URL`、`CRON_RICHMENU_TARGET_URL`、`CRON_SUBSCRIPTION_FREEZE_TARGET_URL` 指定完整 endpoint。

2. 腳本會帶 `Authorization: Bearer <CRON_SECRET>` 依序打:
   - `${APP_URL}/api/cron/reminders`
   - `${APP_URL}/api/cron/marketing`
   - `${APP_URL}/api/cron/followups`
   - `${APP_URL}/api/cron/registration`
   - `${APP_URL}/api/cron/richmenu`
   - `${APP_URL}/api/cron/subscription-freezes`

   五個 endpoint 全部成功才回 0；任一失敗會保留錯誤輸出並回 1。

### Cron 時間(重要:Railway Cron 為 UTC)

- `0 * * * *` = **每小時整點(UTC)**。台北時間 = **UTC + 8**(整點偏移),故台北亦為每小時整點觸發。
- 採「預約前 N 小時」邏輯(`REMINDER_HOURS_BEFORE`,預設 24):每次掃描「未來 N 小時內、`status=booked`、尚無 LINE 提醒紀錄」的預約並推播。**因每小時整窗掃描,當天才新增的預約也會被涵蓋。**
- `reminder_logs (appointment_id, channel)` unique 約束保證同一預約同管道只發一次。
- Railway 的每小時腳本會同時執行報名／付款逾時釋放與 CRM Lite 規則式行銷；各 endpoint 內部仍以冪等鍵與投遞紀錄防止重複。

### Vercel Cron 排程

`vercel.json` 使用 UTC：`/api/cron/reminders` 為 `0 * * * *`（台北每小時整點）、`/api/cron/marketing` 為 `30 * * * *`（台北每小時 30 分）、`/api/cron/followups`、`/api/cron/registration` 與 `/api/cron/richmenu` 為 `*/5 * * * *`（每 5 分鐘）；`/api/cron/subscription-freezes` 為 `5 16 * * *`（台北每日 00:05），用來切換會籍凍結與恢復狀態。

### (c) 部署後回填 LINE 設定

拿到 Railway 公開網址後,到 LINE Developers 後台:
- **LIFF** app 的 Endpoint URL 設為 `https://<railway 網址>/book`,並把該 LIFF ID 填回 web 服務的 `NEXT_PUBLIC_LIFF_ID`(改後重新部署)。
- **Messaging API** 的 Webhook URL 設為 `https://<railway 網址>/api/line/webhook`,開啟「使用 webhook」。

> `next.config.ts` 可選擇性加 `output: 'standalone'` 縮小映像;本專案用 `next start` 啟動,維持預設即可正常運作,故未開啟。

### 關於 `vercel.json`

`vercel.json` 僅供 Vercel 使用,**Railway 不會讀取它**;在 Railway 部署時排程一律走上述 (b) 的 cron 服務。若不部署到 Vercel,此檔留著無作用、也可刪除。

---

## 六、安全與個資要點

- 所有資料表開啟 RLS,**不給 anon 任何 policy** → 用 anon key 讀不到任何顧客資料。
- 顧客端一律經 Next.js API route 以 service role 操作;service key 僅存在 server 端。
- 後台走 Supabase Auth(authenticated)+ `clinic_members` policy,只能存取自己品牌。
- RPC 全 `security definer`,execute 權限只給 `service_role`。
- 取消預約為改 `status='cancelled'`,不 DELETE;服務提供者／品牌為 soft-delete(`active=false`)。

---

## 七、目錄結構

```
app/book/                 單一 LIFF 顧客入口(預約／我的預約／活動／票券／會員／客服／品牌)
app/my/                   統一顧客紀錄中心(預約／報名／會員)
app/embed/book/           官網 iframe 預約入口（共用瀏覽器備援流程）
app/embed/register/       官網 iframe 活動報名入口
app/admin/                後台(預約列表/服務排程/例外日期/顧客查詢/品牌設定)
app/api/booking/          顧客端 config/availability/patient/reserve(server, service role)
app/api/cron/reminders/   提醒排程(CRON_SECRET 驗證)
app/api/line/webhook/     webhook 回寫(驗簽 + postback)
lib/supabase.ts           anon / service-role client
lib/supabase-server.ts    後台 SSR(authenticated)client
lib/line.ts               LIFF ID token 驗證 / 簽章驗證 / push / reply
lib/slots.ts              台北時區時間格式化
supabase/schema.sql       表 / RPC / RLS / 權限
middleware.ts             後台未登入攔截
scripts/trigger-reminders.mjs  Railway cron 服務用:依序打提醒、報名與行銷 endpoint 後退出
docs/product-optimization-acceptance.md 產品流程與優化驗收基準
docs/operations-observability.md 維運、觀測與復原手冊
railway.json              Railway web 服務 build/start 設定
vercel.json               (僅 Vercel 用;Railway 不讀)
```
## 既有資料庫 migration 順序

全新資料庫使用 `supabase/schema.sql`。既有預約系統請依序在 Supabase SQL Editor 執行，且每一步完成備份與檢查：

正式套用前先執行 `supabase migration list` 與 `supabase db push --dry-run --linked`，確認遠端最後版本及待套用順序。`--dry-run` 只做預檢，不代表 migration 已執行；未完成可還原備份及取得部署授權前，不得移除 `--dry-run`。

1. `supabase/migration_crm_lite.sql`
2. `supabase/migration_registration_payments.sql`
3. `supabase/migration_v3_hardening.sql`
4. `supabase/migration_memberships_coupons.sql`
5. `supabase/migration_role_matrix_v4.sql`
6. `supabase/migration_security_advisor_hardening.sql`
7. `supabase/migration_registration_credentials.sql`
8. `supabase/migration_marketing_opt_in_sync.sql`
9. `supabase/migrations/202608060001_customer_portal_identity.sql`
10. `supabase/migrations/202608060002_funnel_events.sql`
11. `supabase/migrations/202608060003_registration_patient_transaction.sql`
12. `supabase/migrations/202608060004_cross_industry_booking_foundation.sql`
13. `supabase/migrations/202608060005_isolate_legacy_progress.sql`
14. `supabase/migrations/202608060006_service_reschedule_transaction.sql`
15. `supabase/migrations/202608060007_reschedule_same_day_fix.sql`
16. `supabase/migrations/202608110001_product_modules_line_richmenu.sql`
17. `supabase/migrations/202608110002_appointment_waitlist.sql`
18. `supabase/migrations/202608110003_appointment_waitlist_surfaces.sql`
19. `supabase/migrations/202608110004_richmenu_optimization.sql`
20. `supabase/migrations/202608110005_db_lint_hardening.sql`
21. `supabase/migrations/202608110006_db_lint_followup.sql`
22. `supabase/migrations/202608110007_waitlist_capacity_error_fix.sql`
23. `supabase/migrations/202608110008_two_level_admin_permissions.sql`
24. `supabase/migrations/202608120001_service_booking_segment_fix.sql`
25. `supabase/migrations/202608120002_provider_rls_recursion_fix.sql`
26. `supabase/migrations/202608130001_registration_number_sequence_fix.sql`
27. `supabase/migrations/202608130002_shared_resource_capacity_lock.sql`
28. `supabase/migrations/202608130003_appointment_deposit_failed_status.sql`
29. `supabase/migrations/202608130004_brand_configuration_permission_boundaries.sql`
30. `supabase/migrations/202608130005_adoption_and_operations_tooling.sql`
31. `supabase/migrations/202608130006_trial_observation_guard.sql`
32. `supabase/migrations/202608130007_booking_growth_features.sql`
33. `supabase/migrations/202608130008_addon_availability.sql`
34. `supabase/migrations/202608130009_recurring_booking_lint_fix.sql`
35. `supabase/migrations/202608150001_brand_page_templates.sql`
36. `supabase/migrations/202609020001_api_rate_limits.sql`
37. `supabase/migrations/202609020002_platform_report_aggregation.sql`
38. `supabase/migrations/202609030001_allow_unassigned_appointment_operations.sql`
39. `supabase/migrations/202609030002_course_learning_center.sql`
40. `supabase/migrations/202609030003_beauty_operations.sql`
41. `supabase/migrations/202609040001_checkout_center.sql`
42. `supabase/migrations/202609040002_customer_value_and_followups.sql`
43. `supabase/migrations/202609040003_industry_packs.sql`
44. `supabase/migrations/202609040004_course_unit_content_check.sql`
45. `supabase/migrations/202609040005_checkout_lint_cleanup.sql`
46. `supabase/migrations/202609040006_checkout_registration_sync.sql`

每支 migration 設計為可重跑；`migration_registration_payments.sql` 也會建立 TWD 幣別與付款期限欄位，`migration_v3_hardening.sql` 會加入訂金逾時釋放與狀態稽核，`migration_role_matrix_v4.sql` 會將 authenticated 的讀寫權限收斂到角色矩陣，`202608060001_customer_portal_identity.sql` 會把活動報名接到統一顧客入口，`202608060002_funnel_events.sql` 只保存匿名漏斗事件，`202608060003_registration_patient_transaction.sql` 讓報名與顧客關聯在同一個 DB transaction 完成，`202608060004_cross_industry_booking_foundation.sql` 新增服務目標、共用服務排程與服務客製欄位，`202608060005_isolate_legacy_progress.sql` 將舊版服務進度設為明確 opt-in，`202608060006_service_reschedule_transaction.sql` 讓免指定服務提供者的預約也能原子改期，`202608060007_reschedule_same_day_fix.sql` 修正同日改期時舊預約佔位造成的誤判，`202608110001_product_modules_line_richmenu.sql` 新增品牌標準模組開關、品牌級 LINE／LIFF 中繼資料及 Rich Menu 版本生命週期；它不保存任何 LINE secret 或 access token。`202608110002_appointment_waitlist.sql` 將時間制／場次制預約候補與活動候補分離，並以原子鎖、預留預約、逾時釋放及投遞佇列建立可恢復的生命週期；`202608110003_appointment_waitlist_surfaces.sql` 另外提供已額滿目標查詢及通知佇列的原子 claim／retry／finish，讓正常可預約時段與候補入口保持分離；`202608110004_richmenu_optimization.sql` 新增同品牌複合外鍵保護的 Alias、顯示排程、版本複製與可重試排程 RPC；`202608110005_db_lint_hardening.sql` 修正品牌建立、會員發放、報名與改期函式的 PL/pgSQL 名稱歧義；`202608110006_db_lint_followup.sql` 修正 staging lint 找到的 Rich Menu／候補函式並補齊品牌更新時間；`202608110007_waitlist_capacity_error_fix.sql` 修正 `006` 中的額滿判斷亂碼，避免滿額時誤將候補標記失效；`202608110008_two_level_admin_permissions.sql` 將產品管理身份收斂為系統管理者與品牌管理者，並加入系統／品牌員工的明確權限欄位。`202608120001` 修正免指定提供者的時間制預約時段判定，`202608120002` 消除 provider 顧客資料 policy recursion，`202608130001` 修正活動報名流水號，`202608130002` 對跨服務共用資源的容量競爭加鎖，`202608130003` 補齊訂金逾時的 failed 狀態，`202608130004` 將品牌設定頁、server action 與 RLS 收斂為 `brand.manage`，`202608130005` 建立三品牌採用指標、CSV 匯入、渠道測試、交班與付費意願資料契約，`202608130006` 原子限制同時最多三個試用品牌，`202608130007` 加入服務加購、表單快照與每週重複預約交易，`202608130008` 讓可預約時段包含加購服務所增加的時間，`202608150001` 加入可設定的品牌公開頁模板與內容，`202609020001` 加入跨執行個體共用的 API 限流，`202609020002` 以資料庫聚合回傳平台使用量。舊版角色值僅保留為 RLS 相容映射。以上均維持原有 service-role 權限。若回填 `reminder_logs.clinic_id` 仍有 NULL，必須先修復對應預約資料，不得直接略過 `NOT NULL` 驗證。會員套票採「一堂抵一次預約或一張指定活動票」；優惠碼套用報名票種，兩者不可疊加。執行後跑 `supabase db lint --linked --schema public --level warning --fail-on warning`、`npm test`、`npm run typecheck` 與 `npm run build`；任一項失敗都不得發布。
