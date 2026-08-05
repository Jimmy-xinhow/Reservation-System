# AGENTS.md — 診所預約系統 開發規範

本檔是這個專案的最高規則。`clinic-booking-spec-v3.md` 是目前功能、開發與驗收規格；`clinic-booking-spec-v2.md` 與 `saas-platform-plan-v1.md` 僅供歷史追溯。**當規格與本檔衝突,以本檔為準**。動工前先讀完本檔與 v3 規格。

---

## 專案是什麼

多品牌 SaaS 的線上預約與報名系統,範圍包含:**預約、報名、收款、提醒、CRM Lite、報表、品牌與後台管理**。
- 病患端:LINE 官方帳號 Rich Menu → LIFF 開啟預約頁。
- 顧客端:主要使用 LINE Rich Menu → LIFF,並提供瀏覽器、自訂網址、嵌入元件與自訂網域入口。
- 後台:品牌成員依角色管理預約、報名、報到、顧客、訊息、CRM Lite 與報表。
- 提醒與行銷:LINE／Email 行前提醒及規則式行銷自動化。

多租戶以 `clinic_id` 作為相容租戶鍵,品牌資料完全隔離;同一登入帳號可依授權切換多個品牌。`NEXT_PUBLIC_CLINIC_ID` 只可作為相容部署 fallback,不可作為 SaaS 隔離邊界。

### 明確不做(未經我同意不要碰)
健保掛號、HIS 病歷同步、叫號 / 看診進度、完整 CRM、AI 行銷自動化、評價導流、公開活動市集。標準金流以綠界／藍新為限;其他金流、完整退款／對帳與清單外新功能須另行報價與確認。

---

## 設定驅動(最高原則)

這是**多租戶產品,不是單一客戶**。品牌／租戶之間的行為差異一律放設定,目前相容欄位為 `clinic_settings`,程式讀設定決定行為,**禁止寫死任何單一模式或門檻**。

- **預約模式**:讀 `booking_mode`。`time`=時間制(選確切時段、區間重疊算容量)、`number`=號次制(選診次給號、整診總量)。兩套 UI 與兩組 RPC 都要做,依設定切換,不可只實作一種。
- **初診時長**:讀 `first_visit_extends` / `first_visit_minutes`,不要假設初複診等長。
- **一電話多病患**:讀 `allow_multi_patient_per_phone` / `max_patients_per_phone`,建立病患時在 server 端檢查上限。
- **訂金**:讀 `deposit_enabled` / `deposit_amount` / `deposit_scope`;付款狀態與訂金狀態分開保存,依 v3 標準金流流程處理。
- **標準金流**:綠界／藍新付款、回呼與付款狀態納入;其他金流、完整退款與對帳另行報價,不代收款。
- **會員／套票／優惠碼**:標準功能包含會員套票、堂數 ledger 與報名優惠碼；一堂抵一次預約或一張指定活動票，優惠碼與套票不可疊加，完整退款／對帳仍屬加購範圍。
- **預約區間**:讀 `min_lead_minutes` / `max_advance_days`。
- **品牌與入口**:品牌設定、Rich Menu → LIFF、瀏覽器備援、自訂網址、嵌入元件與自訂網域依租戶設定運作。

新建診所要自動帶一筆預設 `clinic_settings`(出廠即可用)。任何「要哪一種」的問題,答案都是「做成設定、兩種都做」。

---

## 技術棧(不要替換)
- Next.js 15 App Router + TypeScript(`strict: true`)
- Supabase (Postgres) — 資料 + 後台 Auth
- Tailwind CSS v4
- LINE Messaging API(推播 / webhook)+ LIFF(病患入口)
- Vercel Cron(排程)

不要為了某個小功能引入新框架或 ORM。要加任何相依套件前先說明理由。

---

## 安全與個資(最高優先,違反視為 bug)

1. **病患端永不直接連 Supabase。** LIFF 頁只能呼叫本專案的 Next.js API route;所有 DB 操作在 server 端用 `SUPABASE_SERVICE_ROLE_KEY` 執行。`service_role key` 絕不可出現在任何 client component 或 `NEXT_PUBLIC_*` 變數。
2. **所有資料表開啟 RLS,且不給 anon 任何 policy。** anon key 視為公開資訊。後台讀寫走 Supabase Auth(authenticated)+ 對應 policy。
3. **信任 LINE 身分前要驗證。** 前端送來的 `line_user_id` 不可信;server 端必須用 LIFF ID token 向 LINE 驗證後才採用。webhook 必須驗 `x-line-signature`(HMAC-SHA256 / `LINE_CHANNEL_SECRET`)。
4. **病患 PII(姓名 / 電話 / line_user_id)只在必要時回傳**,不要整包丟到前端。後台列表也只給登入櫃檯看。
5. 機密一律走環境變數,禁止寫死在程式碼或 commit 進 repo。
6. 多品牌 LINE webhook 以 payload `destination` 對應品牌;各品牌 channel secret／access token 使用 server-only `LINE_CHANNEL_SECRETS_JSON`／`LINE_CHANNEL_ACCESS_TOKENS_JSON`,未提供 mapping 時僅相容單品牌 fallback。

---

## 資料模型規則

1. **一個醫師一天可有多段門診**(上午 / 下午 / 晚診)。`schedule_templates` 同 `(doctor_id, weekday)` 允許多筆;算空檔與訂位時,依目標時間落在哪一段決定時長與容量。**禁止用 `limit 1` 抓單一模板。**
2. `appointments.status` 限定 `booked / confirmed / cancelled / done / no_show`,用 enum 或 CHECK 約束。`visit_type` 限定 `first / return`。
3. **取消是改 `status='cancelled'`,不是 DELETE。** 保留歷史。
4. **醫師、診所用 soft-delete(`active=false`),不要硬刪**,避免連帶刪掉約診。外鍵不要對 appointments 用 `on delete cascade` 往上刪。
5. 加 `updated_at`(trigger 自動更新)。約診的狀態異動要可追溯(誰、何時)。
6. 時間一律 `timestamptz`;所有「日期 / 時段」運算的時區基準是 `Asia/Taipei`。

---

## 預約領域規則

1. 只顯示 / 接受**未來且容量未滿**的時段;算容量時 `status in ('booked','confirmed','done')` 才算佔位。
2. 訂位必須原子化(advisory lock 或等價機制),禁止兩人搶到同一個最後名額。
3. 預約有**最短前置時間**(預設 30 分鐘內不可約)與**最長可預約區間**(預設 30 天),做成可設定常數。
4. 初診(`first`)可能比複診長,時長要能依 `visit_type` 調整(先預留邏輯,值可後設)。
5. 同一支電話是否能對應多名病患由 `clinic_settings` 決定:關閉時一電話一人;開啟時可多人但建立病患要檢查 `max_patients_per_phone` 上限。`patients.phone` 不可設唯一鍵。

---

## 提醒規則

1. 提醒要涵蓋**當天才新增的預約**,不能只在固定時間掃隔天。採「看診前 N 小時」邏輯,或多支 cron 補當天。
2. 用 `reminder_logs` 的 unique 約束保證**同一約診同管道只發一次**。
3. **Vercel Cron 是 UTC**,排程註解要標清楚換算後的台北時間。
4. 推播文字的時間要轉成台北、含星期與上午 / 下午。
5. 留意 LINE 推播額度;大量提醒時評估通知型訊息(實作前先跟我確認再加)。
6. 規則式行銷 Cron 與提醒 Cron 同樣要求去重、重試、錯誤紀錄與 Asia/Taipei 時間規則;行銷只對 `marketing_opt_in=true` 顧客發送。

---

## 程式規範

1. 敏感或寫入操作一律放 server(route handler / server action),不在 client 直接執行。
2. TypeScript `strict`,不要用 `any` 逃避型別。
3. 每個外部呼叫(Supabase / LINE / cron)都要有錯誤處理,不要讓未捕捉錯誤直接 500。
4. SQL 函式(`get_available_slots` / `book_appointment` 等)放 `supabase/schema.sql`,改動 schema 要同步更新這個檔。
5. 命名用英文、訊息對病患 / 櫃檯用繁體中文。
6. 不要過度抽象。先能動、結構清楚,再談重構。

### 建議檔案結構
```
app/book/            病患 LIFF 預約頁
app/admin/           後台
app/api/booking/     病患端訂位 / 查空檔(server, service role)
app/api/cron/        提醒排程
app/api/line/webhook webhook 回寫
lib/supabase.ts      anon / service-role 兩種 client
lib/line.ts          push / reply / 簽章 / ID token 驗證
lib/slots.ts         空檔計算與格式化
supabase/schema.sql
```

---

## 與我協作的方式

1. **不要擅自擴張範圍。** 碰到「不做清單」或規格沒寫的需求,先問,不要自己補。
2. **改動 schema、換套件、調整架構前先講原因再動手**,不要默默重寫。
3. 回報用繁體中文,**簡潔、講重點**,不要長篇解釋或道歉。
4. 不確定時提一個明確問題,不要一次丟一堆。
5. 每完成一步,跑一次 build / type-check 確認沒壞再往下。

## 完成定義(Definition of Done)
- `next build` 與 type-check 通過。
- 用 anon key 無法讀到任何病患資料(RLS 已生效)。
- 多時段門診、容量、初複診、取消改期都能正確運作。
- 同日新增的預約也會收到提醒,且不重複發。
- 預約與活動報名、候補、QR 報到、標準金流回呼與付款冪等驗收通過。
- CRM Lite 分眾、互動時間軸、三種規則式自動化、opt-in 與投遞去重驗收通過。
- 報表可依品牌與日期範圍正確統計並匯出,跨品牌查詢一律被拒絕。
- 瀏覽器備援、Email、自訂網址、嵌入元件與自訂網域的路由／安全邊界驗收通過。
- `.env.example` 與 README 齊全,新環境照著做能跑起來。
