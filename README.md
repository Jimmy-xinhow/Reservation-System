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

6. 配置圖片 Storage bucket。後台品牌／LINE 圖片使用公開的 `line-media`；顧客服務照片使用私密的 `customer-media`。若缺少 `line-media`，後台第一張圖片就無法上傳。將 `NEXT_PUBLIC_SUPABASE_URL` 與 **server-only** `SUPABASE_SERVICE_ROLE_KEY` 設在當前終端環境後，先唯讀檢查，再明確套用到指定專案：

```sh
node scripts/provision-storage-buckets.mjs --project-ref=<Supabase project ref>
node scripts/provision-storage-buckets.mjs --project-ref=<Supabase project ref> --apply
node scripts/provision-storage-buckets.mjs --project-ref=<Supabase project ref>
node scripts/audit-storage-buckets.mjs --project-ref=<Supabase project ref>
```

腳本會確認 URL 與 project ref 完全相符，不會改動既有 bucket 的公開性或既有檔案；新增 bucket 限制圖片格式與 5MB。檢查時若缺 bucket 會以退出碼 2 結束。最後一行會上傳兩張一次性 1px 圖片，驗證公開讀取／私密拒絕／簽名讀取後按精確路徑清理。請勿將 service-role key 寫入 README、命令列參數或版控。

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
| `LINE_CHANNEL_ACCESS_TOKEN` | 平台共用或單品牌相容的 Messaging API token；新增獨立品牌可在後台安全設定 |
| `LINE_CHANNEL_SECRET` | 平台共用或單品牌相容的 webhook secret；新增獨立品牌可在後台安全設定 |
| `LINE_CHANNEL_ACCESS_TOKENS_JSON` | 舊版多品牌 destination → token 備援；僅 server environment |
| `LINE_CHANNEL_SECRETS_JSON` | 舊版多品牌 destination → secret 備援；僅 server environment |
| `RESEND_API_KEYS_JSON` | 舊版多品牌 `clinic_id` → Resend API key 備援；僅 server environment |
| `RESEND_EMAIL_FROM_JSON` | 舊版多品牌 `clinic_id` → 寄件人備援；僅 server environment |
| `RESEND_API_KEY` / `RESEND_EMAIL_FROM` | 平台共用或單品牌相容備援；僅 server environment |
| `PAYMENT_SECRETS_JSON` | 舊品牌／首次部署的金流密鑰備援；新設定由品牌管理者在後台單向寫入 Supabase Vault |
| `REGISTRATION_TOKEN_ENCRYPTION_KEY` | 報名通知重試用 AES-GCM 加密金鑰（至少 32 字元）；僅 server environment，不寫入資料庫 |
| `LINE_LOGIN_CHANNEL_ID` | LIFF 所屬 channel id(驗 ID token 用) |
| `NEXT_PUBLIC_LIFF_ID` | 顧客端 LIFF ID |
| `PLATFORM_ADMIN_USER_IDS` | 平台總後台 bootstrap 管理員 UUID（逗號分隔；僅 server environment） |
| `CRON_SECRET` | Vercel／Railway Cron 呼叫提醒、報名逾時、行銷與 Rich Menu 排程 endpoint 的密鑰(長亂數) |
| `CRON_HEALTH_ENABLED` | Railway worker 專用；`1` 代表每項工作後以 `CRON_SECRET` 回寫不含顧客資料的執行結果。須先套用 `cron_job_runs` migration 並部署 `/api/cron/health`；未設定時沿用既有 worker 行為 |
| `CRON_ALLOWED_CLINIC_IDS` | Web 與隔離 worker 必須設定相同的品牌 UUID 清單；設定後七支全域 GET 排程拒絕執行，POST 只接受清單內品牌。空值、重複或不合法 UUID 會 fail closed；排程健康頁改查 scoped 執行紀錄 |
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
4. 在後台「LINE 官方帳號連線」選擇連線方式，填入 destination、Login Channel ID、LIFF ID 與 endpoint。品牌獨立渠道再由品牌管理者貼上 Channel access token 與 Channel secret；完整內容單向寫入 Supabase Vault，儲存後不回傳畫面。
5. 在「Rich Menu」由預約型、活動型或綜合型模板另存草稿，通過圖片／動作／模組／渠道驗證後再發布；系統保留版本、發布事件、下架與回復紀錄，不會先刪除線上舊版。已存在於 LINE 的版本可建立 Alias 頁籤、排定台北時間顯示期間，並以 LINE 官方 Insights 對照匿名預約／報名轉換。
6. 多品牌 webhook：以 LINE payload 的 `destination` 對應品牌。server 優先讀取品牌在 Supabase Vault 的 secret／access token；舊環境的 `LINE_CHANNEL_SECRETS_JSON`／`LINE_CHANNEL_ACCESS_TOKENS_JSON` 只作尚未遷移品牌的備援。

> 品牌獨立渠道必須同時維護 `clinics.line_destination` 與品牌 Vault 憑證；無法對應時會 fail-closed，不會回退到其他品牌 token。Rich Menu 與 webhook 回覆中的 LIFF 連結也會帶入目前品牌的 `clinic_slug`。

Email 同樣由品牌管理者在「品牌與系統設定 → 付款與通知」填入已驗證寄件者與 Resend API key。API key 只進 Supabase Vault，舊環境變數仍可在遷移期間備援。

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
   - `LINE_CHANNEL_ACCESS_TOKEN`（平台共用或既有單品牌備援）
   - `LINE_CHANNEL_SECRET`（平台共用或既有單品牌備援）
   - `LINE_LOGIN_CHANNEL_ID`
   - `LINE_CHANNEL_ACCESS_TOKENS_JSON` / `LINE_CHANNEL_SECRETS_JSON`（選填；既有多品牌備援）
   - `RESEND_API_KEYS_JSON` / `RESEND_EMAIL_FROM_JSON`（選填；既有品牌備援）
   - `PAYMENT_SECRETS_JSON`（選填；僅供既有品牌或首次部署備援）
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

品牌金流不需要交付 Railway 權限。品牌管理者可到「品牌與系統設定 → 付款與通知」輸入 Merchant ID、HashKey 與 HashIV；密鑰會單向寫入 Supabase Vault，儲存後只顯示是否完成，不會把完整內容回填到瀏覽器。綠界密鑰長度為 16／16 碼，藍新為 32／16 碼。

> `NEXT_PUBLIC_*` 在 build 階段就會被內嵌進前端,改值後需 **重新部署** 才生效。

### (b) Cron 服務(提醒、報名與行銷排程)

Railway **不會** 讀 `vercel.json`。`npm run reminders` 是人工全域執行命令，在設定 `CRON_ALLOWED_CLINIC_IDS` 的環境會被 Web 拒絕。正式排程依下表拆成五組，範本位於 `deploy/cron/`，使用 `scripts/run-allowlisted-cron.mjs` 每次重新查詢清單內品牌的現有工作，再以指定品牌／紀錄的 POST 執行；目前尚未部署。

| worker 設定檔 | UTC 排程 | 工作／台北時間 |
|---|---|---|
| frequent.json | `*/5 * * * *` | 指定回訪、報名／付款逾時、Rich Menu；每五分鐘 |
| reminders.json | `0 * * * *` | 預約提醒；每小時整點 |
| marketing.json | `30 * * * *` | 規則式行銷；每小時 30 分 |
| membership.json | `45 * * * *` | 會員提醒；每小時 45 分 |
| subscription-freezes.json | `5 16 * * *` | 會籍凍結／恢復；每日 00:05 |

1. 每組使用獨立 worker service，Config File 指定對應的 `/deploy/cron/<name>.json`，不得沿用 Web 的根 `railway.json`：
   - Start Command 與 Cron Schedule 由該設定檔提供；`--jobs=` 僅選工作類型。品牌由 Web 與 worker 相同的 `CRON_ALLOWED_CLINIC_IDS` 強制限制。
   - Restart Policy 為 `NEVER`，避免平台立即重送結果不明的通知；下一週期的恢復仍依各 endpoint 投遞狀態判斷。
   - **Variables**:
     - `CRON_SECRET`(與 web 服務相同)
     - `CRON_ALLOWED_CLINIC_IDS`(與 web 服務相同；不得空白或加入未授權品牌)
     - `NEXT_PUBLIC_SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`(worker 只在 server 讀取可執行紀錄 ID，不輸出顧客資料)
     - `APP_URL`(web 服務的公開網址,例如 `https://your-app.up.railway.app`)
      — 或分別改設 `CRON_TARGET_URL`、`CRON_MARKETING_TARGET_URL`、`CRON_MEMBERSHIP_TARGET_URL`、`CRON_FOLLOWUP_TARGET_URL`、`CRON_REGISTRATION_TARGET_URL`、`CRON_RICHMENU_TARGET_URL`、`CRON_SUBSCRIPTION_FREEZE_TARGET_URL` 指定完整 endpoint。

2. 腳本會帶 `Authorization: Bearer <CRON_SECRET>`、指定品牌與動態選出的紀錄 ID，依序 POST 到:
   - `${APP_URL}/api/cron/reminders`
   - `${APP_URL}/api/cron/marketing`
   - `${APP_URL}/api/cron/membership`
   - `${APP_URL}/api/cron/followups`
   - `${APP_URL}/api/cron/registration`
   - `${APP_URL}/api/cron/richmenu`
   - `${APP_URL}/api/cron/subscription-freezes`

   七個 endpoint 必須回傳成功 HTTP、JSON `ok:true` 才回 0；沒有待辦紀錄的工作只寫成功心跳。任何品牌的單一類別超過 100 筆時停止該類工作並回非零，須分批處理，不能退回全域 GET。日誌只保留工作名稱、狀態、時間、耗時與安全數字摘要，不輸出完整回應／目標網址／憑證；不自動重送逾時或未知結果。

排程設定只代表預期行為；須確認 Railway 有獨立 Cron 服務、下一次執行時間及成功執行紀錄。Web 服務本身不會執行此腳本。漏跑／失敗告警須在部署平台另行設定並驗證送達；僅有 `CRON_SECRET` 不代表排程健康。

### Cron 時間(重要:Railway Cron 為 UTC)

- `0 * * * *` = **每小時整點(UTC)**。台北時間 = **UTC + 8**(整點偏移),故台北亦為每小時整點觸發。
- 採「預約前 N 小時」邏輯(`REMINDER_HOURS_BEFORE`,預設 24):每次掃描「未來 N 小時內、`status=booked`、尚無 LINE 提醒紀錄」的預約並推播。**因每小時整窗掃描,當天才新增的預約也會被涵蓋。**
- `reminder_logs (appointment_id, channel)` unique 約束保證同一預約同管道只發一次。
- 工作選擇不依啟動當下分鐘判斷，平台延遲啟動仍會執行指定工作。Railway 不保證準點且上次未退出會跳過下次；實際延遲與漏跑仍須監測。參考 [Railway Cron 文件](https://docs.railway.com/cron-jobs)。

### Vercel Cron 排程

`vercel.json` 使用 UTC：`/api/cron/reminders` 為 `0 * * * *`（台北每小時整點）、`/api/cron/marketing` 為 `30 * * * *`（台北每小時 30 分）、`/api/cron/membership` 為 `45 * * * *`（台北每小時 45 分）、`/api/cron/followups`、`/api/cron/registration` 與 `/api/cron/richmenu` 為 `*/5 * * * *`（每 5 分鐘）；`/api/cron/subscription-freezes` 為 `5 16 * * *`（台北每日 00:05），用來切換會籍凍結與恢復狀態。

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
47. `supabase/migrations/202609060001_clinic_member_owner_role_check.sql`
48. `supabase/migrations/202609060002_payment_secret_self_service.sql`
49. `supabase/migrations/202609060003_channel_secret_self_service.sql`
50. `supabase/migrations/202609070001_brand_visual_refresh.sql`
51. `supabase/migrations/202609070002_staff_attendance.sql`
52. `supabase/migrations/202609070003_membership_card_and_redemption.sql`
53. `supabase/migrations/202609070004_industry_dashboard_and_service_records.sql`
54. `supabase/migrations/202609080001_registration_scope_richmenu_catalog.sql`
55. `supabase/migrations/202609090001_line_first_customer_journeys.sql`
56. `supabase/migrations/202609090002_line_native_member_identity.sql`
57. `supabase/migrations/202609090003_line_account_link_digest_fix.sql`
58. `supabase/migrations/202609100001_line_flex_design_workbench.sql`
59. `supabase/migrations/202609140001_effective_resource_availability.sql`
60. `supabase/migrations/202609150001_checkin_session_expiry.sql`
61. `supabase/migrations/202609150002_registration_session_expiry.sql`
62. `supabase/migrations/202609150003_concurrent_customer_lock.sql`
63. `supabase/migrations/202609150004_customer_submission_recovery.sql`
64. `supabase/migrations/202609150005_typed_ticket_projection.sql`
65. `supabase/migrations/202609150006_waitlist_lifecycle.sql`
66. `supabase/migrations/202609150007_scoped_registration_expiry.sql`
67. `supabase/migrations/202609150008_waitlist_session_deadline.sql`
68. `supabase/migrations/202609150009_appointment_payment_deadline.sql`
69. `supabase/migrations/202609150010_scoped_appointment_deposit_expiry.sql`
70. `supabase/migrations/202609150011_registration_payment_lifecycle.sql`
71. `supabase/migrations/202609150012_membership_ledger_idempotency.sql`
72. `supabase/migrations/202609160001_membership_purchase_terms.sql`
73. `supabase/migrations/202609160002_membership_redemption_terms.sql`
74. `supabase/migrations/202609160003_registration_membership_owner.sql`
75. `supabase/migrations/202609200001_payment_transition_audit.sql`
76. `supabase/migrations/202609200002_late_tenant_history_foreign_keys.sql`
77. `supabase/migrations/202609200003_scoped_followup_claim.sql`

`202609200003` 新增 service-role 專用的品牌／指定回訪原子領取。單次維運使用 `POST /api/cron/followups`，Bearer `CRON_SECRET`，JSON 為 `{ "clinic_id": "品牌 UUID", "followup_ids": ["回訪 UUID"] }`；只處理該品牌、指定 ID、已到期且 pending 的 LINE／Email 回訪。空值、不合法或重複 ID 回 400，不回退全域。正常 GET 排程維持原行為。此入口可能真正發訊，僅能指定已授權的收件資料；不會替未知送達的 processing 紀錄自動重送。先部署 migration，再部署 route；目前本機待部署。

`202609200002` 修正 9 張後建資料表的品牌外鍵刪除動作為 `RESTRICT`，保留歷史紀錄，使新建與升級的結構一致。本輪只完成本機驗證，尚未套用 staging／正式資料庫；完整 Supabase Vault／Auth 備份還原仍待獨立環境。詳見 [G3-05 本機重播與還原證據](docs/g3-05-local-evidence-2026-09-20.md)。

`202609200001` 必須先於新版付款回呼部署：新增僅 service_role 可執行的 `transition_verified_payment`，付款狀態與稽核同筆交易寫入。失敗會回滾狀態，回呼可重送；不回填歷史缺漏。回退應用程式時可保留此向後相容函式。

`202609160003` 以 server 解析的顧客 ID 驗證報名套票持有人；同電話不同顧客不共用套票，不符時整筆交易回滾。參見 [G2-05 最終驗收](docs/g2-05-final-evidence-2026-09-16.md)。

`202609160002` 在購買／新發放時固定套票適用服務、範圍與渠道，並同步自動及後台扣抵。先套用 DB，再部署快照顯示與付款 API。舊已發放套票沒有原始快照時仍沿用即時方案，不能宣稱原購買限制已還原；正式遷移前另盤點處理。詳見 [兌換限制驗收](docs/g2-05-redemption-evidence-2026-09-16.md)。

`202609160001` 先於對應付款 API 部署，保存新套票訂單的堂數／有效天數快照。遷移前盤點待付款與已付款未發放套票；舊單不以目前方案回填。缺快照的舊單停止再次付款／自動發放，須依原始購買憑據人工核對；已發放舊單重送仍返回原套票。本輪僅 staging 驗證，正式環境另依部署門檻執行，詳見 [快照驗收](docs/g2-05-snapshot-evidence-2026-09-16.md)。

`202609070003` 新增套票卡面、跨場景使用設定，以及商品／課程／線下兌換的原子扣點與不可覆蓋紀錄。`202609070004` 新增品牌工作台營運主軸，並讓服務過程紀錄可安全關聯預約或課程／活動報名。`202609090001` 新增 LINE 對話狀態、webhook 去重與既有會員安全找回；`202609090002` 讓簽章驗證後的 LINE 使用者可直接在聊天室啟用品牌會員身分，不需要先填電話或生日，完整資料仍在實際需要時補齊；`202609090003` 固定既有會員連結的 nonce 雜湊函式搜尋路徑；`202609100001` 新增每品牌獨立的 Flex 草稿與已發布版本，讓內建範本可帶入後再修改。

每支 migration 設計為可重跑；`migration_registration_payments.sql` 也會建立 TWD 幣別與付款期限欄位，`migration_v3_hardening.sql` 會加入訂金逾時釋放與狀態稽核，`migration_role_matrix_v4.sql` 會將 authenticated 的讀寫權限收斂到角色矩陣，`202608060001_customer_portal_identity.sql` 會把活動報名接到統一顧客入口，`202608060002_funnel_events.sql` 只保存匿名漏斗事件，`202608060003_registration_patient_transaction.sql` 讓報名與顧客關聯在同一個 DB transaction 完成，`202608060004_cross_industry_booking_foundation.sql` 新增服務目標、共用服務排程與服務客製欄位，`202608060005_isolate_legacy_progress.sql` 將舊版服務進度設為明確 opt-in，`202608060006_service_reschedule_transaction.sql` 讓免指定服務提供者的預約也能原子改期，`202608060007_reschedule_same_day_fix.sql` 修正同日改期時舊預約佔位造成的誤判，`202608110001_product_modules_line_richmenu.sql` 新增品牌標準模組開關、品牌級 LINE／LIFF 中繼資料及 Rich Menu 版本生命週期；它不保存任何 LINE secret 或 access token。`202608110002_appointment_waitlist.sql` 將時間制／場次制預約候補與活動候補分離，並以原子鎖、預留預約、逾時釋放及投遞佇列建立可恢復的生命週期；`202608110003_appointment_waitlist_surfaces.sql` 另外提供已額滿目標查詢及通知佇列的原子 claim／retry／finish，讓正常可預約時段與候補入口保持分離；`202608110004_richmenu_optimization.sql` 新增同品牌複合外鍵保護的 Alias、顯示排程、版本複製與可重試排程 RPC；`202608110005_db_lint_hardening.sql` 修正品牌建立、會員發放、報名與改期函式的 PL/pgSQL 名稱歧義；`202608110006_db_lint_followup.sql` 修正 staging lint 找到的 Rich Menu／候補函式並補齊品牌更新時間；`202608110007_waitlist_capacity_error_fix.sql` 修正 `006` 中的額滿判斷亂碼，避免滿額時誤將候補標記失效；`202608110008_two_level_admin_permissions.sql` 將產品管理身份收斂為系統管理者與品牌管理者，並加入系統／品牌員工的明確權限欄位。`202608120001` 修正免指定提供者的時間制預約時段判定，`202608120002` 消除 provider 顧客資料 policy recursion，`202608130001` 修正活動報名流水號，`202608130002` 對跨服務共用資源的容量競爭加鎖，`202608130003` 補齊訂金逾時的 failed 狀態，`202608130004` 將品牌設定頁、server action 與 RLS 收斂為 `brand.manage`，`202608130005` 建立三品牌採用指標、CSV 匯入、渠道測試、交班與付費意願資料契約，`202608130006` 原子限制同時最多三個試用品牌，`202608130007` 加入服務加購、表單快照與每週重複預約交易，`202608130008` 讓可預約時段包含加購服務所增加的時間，`202608150001` 加入可設定的品牌公開頁模板與內容，`202609020001` 加入跨執行個體共用的 API 限流，`202609020002` 以資料庫聚合回傳平台使用量，`202609060001` 讓舊資料庫的成員角色檢查接受目前品牌建立流程使用的 `owner`，`202609060002` 讓品牌管理者可單向設定綠界／藍新密鑰，`202609060003` 讓品牌管理者可單向設定 LINE／Email 憑證；三種外部憑證皆只在 server 端由 Supabase Vault 解密。`202609070001` 僅將仍使用舊系統預設圖的美業、課程與運動模板換成新版產業素材，品牌自行設定的圖片網址不會變更。`202609070002` 新增每品牌獨立的員工出勤設定、按鈕／輪替 QR／LINE 打卡、LINE webhook 去重與可配對工時計算資料。舊版角色值僅保留為 RLS 相容映射。以上均維持原有 service-role 權限。若回填 `reminder_logs.clinic_id` 仍有 NULL，必須先修復對應預約資料，不得直接略過 `NOT NULL` 驗證。會員套票採「一堂抵一次預約或一張指定活動票」；優惠碼套用報名票種，兩者不可疊加。執行後跑 `supabase db lint --linked --schema public --level warning --fail-on warning`、`npm test`、`npm run typecheck` 與 `npm run build`；任一項失敗都不得發布。


### 共享限流故障行為

API 限流使用 PostgreSQL 共用計數；本機 bucket 只用於提前拒絕，不能在共享儲存故障時額外放行。RPC 失敗或回傳格式錯誤時拒絕請求，JSON API 回 503（共用回應與既有帶 Retry-After 的端點提示 5 秒後重試）；一般超額仍回 429。LINE account-link 表單沿用 303 回重試頁，且不執行业務操作。此設計犧牲短暫可用性，以免多實例各自增加配額。

來源 IP 仍依部署入口的轉送標頭；部署到新代理／CDN／直連入口前必須重新驗證標頭覆寫与不可繞過的入口限制，不能把單次 staging 偽造標頭測試視為所有環境的信任保證。

### 指定預約與會員提醒

維運可用 `POST /api/cron/reminders` 搭配 `{ "clinic_id": "品牌 UUID", "appointment_ids": ["預約 UUID"] }`，或 `POST /api/cron/membership` 搭配 `{ "clinic_id": "品牌 UUID", "membership_ids": ["會員套票 UUID"] }`。皆需 Bearer `CRON_SECRET`，一次限 1–100 筆不重複 UUID；缺欄位、額外欄位或非法 ID 回 400，未授權回 401，不回退全域掃描。只處理啟用品牌內的指定紀錄，仍套用既有提醒視窗、業務狀態、渠道與去重規則。外品牌及未選紀錄不處理；查無符合資料回零筆。正常 GET 排程仍維持原行為。

這些 POST 可能真實發訊，僅指定授權測試收件人或維運已確認的紀錄。執行指定提醒不會同時跑付款到期、行銷、Rich Menu 或其他全域工作。worker 現在將 `lineFailed`／`emailFailed` 視為失敗並保留安全計數，不會把提醒部分失敗誤記為成功。

### 指定 Rich Menu、訂閱凍結與行銷

先套用 `202609210001`。三個 POST 入口皆需 Bearer `CRON_SECRET` 與 `clinic_id`：`/api/cron/richmenu` 使用 `schedule_ids`；`/api/cron/subscription-freezes` 使用 `subscription_ids`；`/api/cron/marketing` 同時使用 `automation_ids` 與 `patient_ids`。每組 ID 限 1–100 筆不重複 UUID，非法或額外欄位回 400，未授權回 401；不回退全域。GET 維持原排程行為。

凍結以整份訂閱為單位處理相鄰凍結期間與暫停歸屬，避免完成舊凍結時解除人工暫停。指定行銷僅唯讀解析所選顧客的五種分眾規則，不刷新全品牌分眾快取，仍檢查 opt-in、觸發條件與投遞去重。Rich Menu 與行銷可能真正呼叫外部渠道，僅可指定授權範圍；此修正不代表已驗證真實送達或 worker。

### 指定期限處理與交易通知

`202609210003` 新增 `POST /api/cron/registration`：需 Bearer `CRON_SECRET`，JSON 必須包含 `clinic_id`、`registration_ids`、`appointment_ids`、`membership_payment_ids`、`waitlist_ids`。四組清單各限 0–100 筆不重複 UUID，至少一組非空，沒有提供的種類應明確傳空陣列；非法輸入回 400，沒有授權回 401，不回退全域。

五類期限處理在同一筆資料庫交易完成；付款、優惠占用、狀態事件以及指定預約候補的保留／新遞補預約是連動範圍。若取消將觸及未選候補（報名同場次、預約同品牌同日所有候補目標），整批期限處理回滾並回 409。需將連動候補一併列入清單，不可為測試放寬成全品牌。交易成功後三個通知佇列僅處理所選報名、預約與候補及其新保留預約；空清單不查詢。通知可能真實發送，僅用已授權收件資料。部分通知失敗回 ok=false，期限交易已提交，重跑具冪等性。GET 保留既有全域排程行為。

### 指定範圍 worker 與短期排程演練

`node scripts/trigger-reminders.mjs --scoped` 以 POST 執行七類工作；可搭配 `--jobs=membership,subscription-freezes` 限定種類。必須設定 `CRON_SCOPES_JSON`（以工作名稱對應前述各 POST 的完整 JSON body）與未來的 ISO 時間 `CRON_SCOPE_EXPIRES_AT`。scope 的工作名稱必須恰好等於本次所選工作，所有 scope 在第一個 HTTP 前一起驗證；缺漏、非法、重複 ID、過期或有 scope 卻忘記 --scoped，直接非零退出，絕不退回 GET。執行途中到期會停止剩餘工作。

每筆安全結構化日誌有 `run_id` 與 `mode`，不輸出 scope IDs、URL、密鑰或供應商回應。每個工作最多一次 HTTP、60 秒 timeout、不跟隨 redirect；部分失敗會繼續其餘已指定工作，最後非零退出，不自動重試未知結果。恢復後以相同範圍重新執行，依服務端去重規則處理。

獨立測試 worker 範本在 `deploy/scoped-cron/railway.json`（UTC 每五分鐘，restartPolicyType=NEVER）。使用只含腳本、Node 22 package.json 與該設定的隔離部署目錄，設定 APP_URL、CRON_SECRET 與上述兩個 scope 變數即可；worker 不需要 Supabase service role 或 LINE／Email 金鑰。驗收完成後停用並移除臨時 worker、清理精確 fixtures。五組正常營運 GET 範本維持原行為，尚未啟用。

Railway 會跳過與前次執行重疊的排程，仍需外部監測最後成功時間與告警收件人，不能只靠程序退出碼宣稱已完成漏跑監控。參考 [Railway Cron 說明](https://docs.railway.com/cron-jobs)。

可用 `node scripts/check-cron-health.mjs --log-file=worker.jsonl --jobs=membership,subscription-freezes --max-age-minutes=15` 檢查單一 worker 的 Railway JSON 日誌匯出。必須包含所選工作的最新完整 run；缺紀錄、過期、未完成、失敗、工作缺漏、設定失敗或無效時間回非零，只輸出安全摘要。此工具提供健康判斷，仍須由獨立監測器定期呼叫並接上告警，並非已部署的告警服務。

### 通知結果不明保護（202609210004）

既有環境依序套用 `202609210004_notification_uncertainty_claims.sql`，再部署相符程式。提醒 sending 及候補 claimed 不因時間經過重領；提醒／行銷／會員／候補在供應商呼叫後的錯誤不回寫可重試狀態。先查供應商證據；不批次重送歷史 failed。積壓監測與人工判斷見 `docs/operations-observability.md`。

### 手動報到原子交易（202609220001）

先套用 `202609220001_atomic_manual_checkin.sql`，再部署相符程式。手動報到透過單一 service-role RPC 寫入報到與報名狀態，與 QR 共用報名列鎖；重試會修復舊版半完成紀錄，保留原報到時間與操作人員，不恢復已取消報名。手動補登過去場次的既有行為不變。驗證腳本 `scripts/test-manual-checkin-transaction.sql` 只在隔離驗收資料庫執行，使用既有 Auth 使用者並將測試資料與故障 trigger 全部 rollback。

### 顧客客服送出結果與重試（2026-09-22）

訊息成功存入後，CRM／自動回覆錯誤只記錄安全分類，不再回報主訊息失敗。新版客服頁對一次送出保留 messageId；斷線／結果不明時保留待確認文字，使用同一按鈕重試沿用原 ID。API 以既有 chat_messages 主鍵去重，只接受相同品牌、驗證後 LINE 身分、sender 與內容的既有紀錄，不覆寫訊息。無 schema migration。待確認內容目前只保留於該頁記憶體；關閉／重新整理前應先核對對話，不承諾跨頁重啟草稿復原。缺少 messageId 的舊版仍相容，但不同請求無法去重。CRM 或自動回覆缺漏不自動補送。

`node --test scripts/test-customer-chat-certainty.mjs` 驗證 route 與 composer；`node scripts/test-customer-chat-postgres.mjs` 僅在文件指定的本機 g305 測試叢集執行，測試真實寫入後回應遺失與併發唯一性；LINE 驗證使用測試替身，不代表實際渠道驗收。
