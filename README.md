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

相依套件:`@supabase/supabase-js`(資料存取)、`@supabase/ssr`(後台 Supabase Auth 的 cookie session,App Router middleware/Server Component 必需)。

---

## 公開入口 smoke

部署後可用不含密鑰的 HTTP smoke 檢查公開頁與 Cron 未授權邊界：

```powershell
$env:SMOKE_BASE_URL = "https://your-staging.example.com"
npm run smoke:public
```

它會確認 `/`、`/register`、`/register/pay`、`/book/browser`、`/embed/register` 回 200，且三支 Cron endpoint 在沒有密鑰時回 401；不會建立或修改任何資料。

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
-- 其餘欄位皆有預設值:time 模式、不延長初診、一電話一人、不收訂金、前置30分、可約30天

-- 3) 後台帳號:先在 Authentication → Users 以 email/密碼建立一名使用者,取得其 user id,
--    再建立其與品牌的對應(後台 RLS 以此判斷可存取哪個品牌)
insert into clinic_members (clinic_id, user_id) values ('<clinic_id>', '<auth_user_id>');

-- 4)(選用)新增醫師、門診段,亦可改由後台「門診表」頁建立
```

4. 相容單品牌部署時，把預設品牌 id 填進 `NEXT_PUBLIC_CLINIC_ID`；SaaS 模式不可只依賴此變數，必須使用登入後的品牌 context。

5. 第一個品牌與後台 owner 建立後，平台管理員可在後台「SaaS 平台 → 品牌總管理」建立其他品牌；品牌 owner 仍可在「品牌與系統設定」管理自己可存取的品牌。建立流程會在資料庫內原子建立品牌、預設 `clinic_settings` 與 owner 成員資格。

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
| `NEXT_PUBLIC_LIFF_ID` | 病患端 LIFF ID |
| `PLATFORM_ADMIN_USER_IDS` | 平台總後台 bootstrap 管理員 UUID（逗號分隔；僅 server environment） |
| `CRON_SECRET` | Vercel／Railway Cron 呼叫提醒、報名逾時與行銷 endpoint 的密鑰(長亂數) |
| `REMINDER_HOURS_BEFORE` | 看診前幾小時發提醒(預設 24) |
| `MEMBERSHIP_LOW_BALANCE_THRESHOLD` | 會員餘額提醒門檻（預設 1 堂） |
| `MEMBERSHIP_EXPIRY_NOTICE_DAYS` | 會員到期前提醒天數（預設 7 天） |
| `APP_URL` | 公開 canonical URL；付款回呼／回跳與 Railway Cron 都使用此 server-side 網址 |
| `CRON_TARGET_URL` | 可選，覆寫提醒 endpoint 的完整 URL |
| `CRON_MARKETING_TARGET_URL` | 可選，覆寫 CRM Lite 行銷 endpoint 的完整 URL |
| `CRON_REGISTRATION_TARGET_URL` | 可選，覆寫報名／付款逾時 endpoint 的完整 URL |

---

## 三、LINE 設定

1. **Messaging API channel**:取得 access token 與 channel secret。
2. **Webhook URL**:設為 `https://<你的網域>/api/line/webhook`,並開啟「使用 webhook」。
   - 系統會驗 `x-line-signature`(HMAC-SHA256 / `LINE_CHANNEL_SECRET`)。
   - 提醒訊息的「確認赴診/取消」按鈕以 postback 回寫約診狀態。
3. **LIFF**:在對應 channel 新增一個 LIFF app,Endpoint URL 設為 `https://<你的網域>/book`,取得 LIFF ID 填入 `NEXT_PUBLIC_LIFF_ID`;其所屬 channel id 填入 `LINE_LOGIN_CHANNEL_ID`。
4. Rich Menu 連到該 LIFF。
5. 多品牌 webhook：在各品牌公開設定填入 LINE webhook payload 的 `destination`；若各品牌使用不同 LINE channel，將 destination 對應的 secret／access token 放入 `LINE_CHANNEL_SECRETS_JSON`／`LINE_CHANNEL_ACCESS_TOKENS_JSON`，不可放到前端或資料庫。

> 多品牌必須同時維護 `clinics.line_destination` 與兩張 credential map；只要任一 map 已啟用，未對應的 destination 會 fail-closed，不會回退到預設品牌 token。Rich Menu 與 webhook 回覆中的 LIFF 連結也會帶入目前品牌的 `clinic_slug`。

> 病患端永不直接連 Supabase:LIFF 頁只呼叫本專案 API route,server 端以 service role 操作。前端送來的 `line_user_id` 一律先用 LIFF ID token 向 LINE 驗證後才採用。

---

## 四、本機開發

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # 生產建置
npm run typecheck  # tsc --noEmit
npm run verify:contracts  # 規格、路由、RLS 與秘密邊界靜態檢查
```

- 病患預約頁:`/book`(需在 LINE/LIFF 環境;或設好 `NEXT_PUBLIC_LIFF_ID` 後於 LINE 內開啟)。
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

Railway **不會** 讀 `vercel.json`,所以排程另外做。`npm run reminders` 會由同一支腳本依序呼叫提醒、報名付款逾時／通知與 CRM Lite 行銷三個 endpoint:

1. 由同一個 repo **再建一個服務**(或用 Railway 的 Cron 功能),設定:
   - **Custom Start Command**:`npm run reminders`(即 `node scripts/trigger-reminders.mjs`,跑完即退出)
   - **Cron Schedule**:`0 * * * *`
   - **Variables**:
     - `CRON_SECRET`(與 web 服務相同)
     - `APP_URL`(web 服務的公開網址,例如 `https://your-app.up.railway.app`)
      — 或分別改設 `CRON_TARGET_URL`、`CRON_MARKETING_TARGET_URL`、`CRON_REGISTRATION_TARGET_URL` 指定完整 endpoint。

2. 腳本會帶 `Authorization: Bearer <CRON_SECRET>` 依序打:
   - `${APP_URL}/api/cron/reminders`
   - `${APP_URL}/api/cron/marketing`
   - `${APP_URL}/api/cron/registration`

   三個 endpoint 全部成功才回 0；任一失敗會保留錯誤輸出並回 1。

### Cron 時間(重要:Railway Cron 為 UTC)

- `0 * * * *` = **每小時整點(UTC)**。台北時間 = **UTC + 8**(整點偏移),故台北亦為每小時整點觸發。
- 採「看診前 N 小時」邏輯(`REMINDER_HOURS_BEFORE`,預設 24):每次掃描「未來 N 小時內、`status=booked`、尚無 LINE 提醒紀錄」的約診並推播。**因每小時整窗掃描,當天才新增的預約也會被涵蓋。**
- `reminder_logs (appointment_id, channel)` unique 約束保證同一約診同管道只發一次。
- Railway 的每小時腳本會同時執行報名／付款逾時釋放與 CRM Lite 規則式行銷；各 endpoint 內部仍以冪等鍵與投遞紀錄防止重複。

### Vercel Cron 排程

`vercel.json` 使用 UTC：`/api/cron/reminders` 為 `0 * * * *`（台北每小時整點）、`/api/cron/marketing` 為 `30 * * * *`（台北每小時 30 分）、`/api/cron/registration` 為 `*/15 * * * *`（台北每 15 分鐘）。

### (c) 部署後回填 LINE 設定

拿到 Railway 公開網址後,到 LINE Developers 後台:
- **LIFF** app 的 Endpoint URL 設為 `https://<railway 網址>/book`,並把該 LIFF ID 填回 web 服務的 `NEXT_PUBLIC_LIFF_ID`(改後重新部署)。
- **Messaging API** 的 Webhook URL 設為 `https://<railway 網址>/api/line/webhook`,開啟「使用 webhook」。

> `next.config.ts` 可選擇性加 `output: 'standalone'` 縮小映像;本專案用 `next start` 啟動,維持預設即可正常運作,故未開啟。

### 關於 `vercel.json`

`vercel.json` 僅供 Vercel 使用,**Railway 不會讀取它**;在 Railway 部署時排程一律走上述 (b) 的 cron 服務。若不部署到 Vercel,此檔留著無作用、也可刪除。

---

## 六、安全與個資要點

- 所有資料表開啟 RLS,**不給 anon 任何 policy** → 用 anon key 讀不到任何病患資料。
- 病患端一律經 Next.js API route 以 service role 操作;service key 僅存在 server 端。
- 後台走 Supabase Auth(authenticated)+ `clinic_members` policy,只能存取自己診所。
- RPC 全 `security definer`,execute 權限只給 `service_role`。
- 取消約診為改 `status='cancelled'`,不 DELETE;醫師/診所為 soft-delete(`active=false`)。

---

## 七、目錄結構

```
app/book/                 病患 LIFF 預約頁(依 booking_mode 渲染兩套 UI)
app/admin/                後台(今日約診/門診表/休診加診/病患查詢/診所設定)
app/api/booking/          病患端 config/availability/patient/reserve(server, service role)
app/api/cron/reminders/   提醒排程(CRON_SECRET 驗證)
app/api/line/webhook/     webhook 回寫(驗簽 + postback)
lib/supabase.ts           anon / service-role client
lib/supabase-server.ts    後台 SSR(authenticated)client
lib/line.ts               LIFF ID token 驗證 / 簽章驗證 / push / reply
lib/slots.ts              台北時區時間格式化
supabase/schema.sql       表 / RPC / RLS / 權限
middleware.ts             後台未登入攔截
scripts/trigger-reminders.mjs  Railway cron 服務用:依序打提醒、報名與行銷 endpoint 後退出
railway.json              Railway web 服務 build/start 設定
vercel.json               (僅 Vercel 用;Railway 不讀)
```
## 既有資料庫 migration 順序

全新資料庫使用 `supabase/schema.sql`。既有預約系統請依序在 Supabase SQL Editor 執行，且每一步完成備份與檢查：

1. `supabase/migration_crm_lite.sql`
2. `supabase/migration_registration_payments.sql`
3. `supabase/migration_v3_hardening.sql`
4. `supabase/migration_memberships_coupons.sql`
5. `supabase/migration_role_matrix_v4.sql`
6. `supabase/migration_security_advisor_hardening.sql`
7. `supabase/migration_registration_credentials.sql`
8. `supabase/migration_marketing_opt_in_sync.sql`

每支 migration 設計為可重跑；`migration_registration_payments.sql` 也會建立 TWD 幣別與付款期限欄位，`migration_v3_hardening.sql` 會加入訂金逾時釋放與狀態稽核，`migration_role_matrix_v4.sql` 會將 authenticated 的讀寫權限收斂到角色矩陣。若回填 `reminder_logs.clinic_id` 仍有 NULL，必須先修復對應預約資料，不得直接略過 `NOT NULL` 驗證。會員套票採「一堂抵一次預約或一張指定活動票」；優惠碼套用報名票種，兩者不可疊加。執行後跑 `npm test`、`npm run typecheck` 與 `npm run build`。
