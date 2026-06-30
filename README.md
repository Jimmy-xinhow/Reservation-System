# 診所預約系統

單一診所線上預約系統:**預約 · 提醒 · 後台管理**。病患由 LINE 官方帳號 → LIFF 進入預約;櫃檯用後台管理約診與門診表;看診前自動 LINE 推播提醒(可確認/取消)。

多租戶就緒(所有表帶 `clinic_id`),本版以 `NEXT_PUBLIC_CLINIC_ID` 鎖定單一診所。行為差異全部由 `clinic_settings` 設定驅動(預約模式、初診延長、一電話多病患、訂金、預約區間)。

> 規範見 `CLAUDE.md`(最高規則)與 `clinic-booking-spec-v2.md`(功能規格)。

## 技術棧

- Next.js 15(App Router, TypeScript strict)
- Supabase(Postgres + 後台 Auth)
- Tailwind CSS v4
- LINE Messaging API(推播/webhook)+ LIFF
- Vercel Cron(提醒排程)

相依套件:`@supabase/supabase-js`(資料存取)、`@supabase/ssr`(後台 Supabase Auth 的 cookie session,App Router middleware/Server Component 必需)。

---

## 一、Supabase 設定

1. 建立 Supabase 專案。
2. SQL Editor 貼上並執行 **`supabase/schema.sql`**(建表、RPC、RLS、權限)。
3. 建立一間診所與其預設設定,並建立後台帳號對應:

```sql
-- 1) 診所
insert into clinics (name) values ('示範診所') returning id;
-- 記下回傳的 clinic id,以下用 :clinic_id 代表

-- 2) 預設 clinic_settings(出廠即可用)
insert into clinic_settings (clinic_id) values ('<clinic_id>');
-- 其餘欄位皆有預設值:time 模式、不延長初診、一電話一人、不收訂金、前置30分、可約30天

-- 3) 後台帳號:先在 Authentication → Users 以 email/密碼建立一名使用者,取得其 user id,
--    再建立其與診所的對應(後台 RLS 以此判斷可存取哪間診所)
insert into clinic_members (clinic_id, user_id) values ('<clinic_id>', '<auth_user_id>');

-- 4)(選用)新增醫師、門診段,亦可改由後台「門診表」頁建立
```

4. 把 clinic id 填進環境變數 `NEXT_PUBLIC_CLINIC_ID`。

> `clinic_members` 是本系統為實作「後台只能存取自己診所」所需的最小新增(規格未定義 auth↔clinic 對應)。一筆代表某 auth 使用者可管理某診所。

---

## 二、環境變數

複製 `.env.example` 為 `.env.local` 並填入:

| 變數 | 說明 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase 專案 URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon key(公開,僅後台 Auth 用) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key,**只在 server 端**,絕不可進 `NEXT_PUBLIC_*` |
| `NEXT_PUBLIC_CLINIC_ID` | 本版鎖定的診所 id |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API channel access token(推播/回覆) |
| `LINE_CHANNEL_SECRET` | Messaging API channel secret(驗 webhook 簽章) |
| `LINE_LOGIN_CHANNEL_ID` | LIFF 所屬 channel id(驗 ID token 用) |
| `NEXT_PUBLIC_LIFF_ID` | 病患端 LIFF ID |
| `CRON_SECRET` | Vercel Cron 呼叫提醒 endpoint 的密鑰(長亂數) |
| `REMINDER_HOURS_BEFORE` | 看診前幾小時發提醒(預設 24) |

---

## 三、LINE 設定

1. **Messaging API channel**:取得 access token 與 channel secret。
2. **Webhook URL**:設為 `https://<你的網域>/api/line/webhook`,並開啟「使用 webhook」。
   - 系統會驗 `x-line-signature`(HMAC-SHA256 / `LINE_CHANNEL_SECRET`)。
   - 提醒訊息的「確認赴診/取消」按鈕以 postback 回寫約診狀態。
3. **LIFF**:在對應 channel 新增一個 LIFF app,Endpoint URL 設為 `https://<你的網域>/book`,取得 LIFF ID 填入 `NEXT_PUBLIC_LIFF_ID`;其所屬 channel id 填入 `LINE_LOGIN_CHANNEL_ID`。
4. Rich Menu 連到該 LIFF。

> 病患端永不直接連 Supabase:LIFF 頁只呼叫本專案 API route,server 端以 service role 操作。前端送來的 `line_user_id` 一律先用 LIFF ID token 向 LINE 驗證後才採用。

---

## 四、本機開發

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # 生產建置
npm run typecheck  # tsc --noEmit
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
   - `CRON_SECRET`(長亂數)
   - `REMINDER_HOURS_BEFORE`(選填,預設 24)

   **NEXT_PUBLIC_(建置時打包進前端):**
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_CLINIC_ID`
   - `NEXT_PUBLIC_LIFF_ID`

3. 在 Settings → Networking 產生公開網域(Generate Domain),取得類似 `https://your-app.up.railway.app` 的網址。

> `NEXT_PUBLIC_*` 在 build 階段就會被內嵌進前端,改值後需 **重新部署** 才生效。

### (b) Cron 服務(提醒排程)

Railway **不會** 讀 `vercel.json`,所以排程另外做。提醒邏輯仍在 `/api/cron/reminders`,由一支獨立腳本定時去打它:

1. 由同一個 repo **再建一個服務**(或用 Railway 的 Cron 功能),設定:
   - **Custom Start Command**:`npm run reminders`(即 `node scripts/trigger-reminders.mjs`,跑完即退出)
   - **Cron Schedule**:`0 * * * *`
   - **Variables**:
     - `CRON_SECRET`(與 web 服務相同)
     - `APP_URL`(web 服務的公開網址,例如 `https://your-app.up.railway.app`)
       — 或改設 `CRON_TARGET_URL` 指定完整 endpoint。

2. 腳本會帶 `Authorization: Bearer <CRON_SECRET>` 打 `${APP_URL}/api/cron/reminders`,成功回 0、失敗回 1。

### Cron 時間(重要:Railway Cron 為 UTC)

- `0 * * * *` = **每小時整點(UTC)**。台北時間 = **UTC + 8**(整點偏移),故台北亦為每小時整點觸發。
- 採「看診前 N 小時」邏輯(`REMINDER_HOURS_BEFORE`,預設 24):每次掃描「未來 N 小時內、`status=booked`、尚無 LINE 提醒紀錄」的約診並推播。**因每小時整窗掃描,當天才新增的預約也會被涵蓋。**
- `reminder_logs (appointment_id, channel)` unique 約束保證同一約診同管道只發一次。

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
scripts/trigger-reminders.mjs  Railway cron 服務用:打 /api/cron/reminders 後退出
railway.json              Railway web 服務 build/start 設定
vercel.json               (僅 Vercel 用;Railway 不讀)
```
