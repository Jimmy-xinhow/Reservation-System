# Reservation System v3 驗收矩陣

日期：2026-08-13
基準：`AGENTS.md`、`clinic-booking-spec-v3.md`

本文件把「程式碼與本機可證明的結果」和「必須連接實際外部環境的結果」分開。沒有 Supabase 或第三方服務證據的項目，不視為已完成正式上線驗收。

2026-08-12 的角色與 LINE／Rich Menu staging 實測、缺陷與修正狀態，另見 [staging-full-acceptance-2026-08-12.md](staging-full-acceptance-2026-08-12.md)。

## 已取得程式與正式 Supabase 證據

| 項目 | 證據 | 結果 |
|---|---|---|
| 契約與安全邊界靜態檢查 | `npm test` / `npm run verify:contracts` | PASS |
| TypeScript strict 型別檢查 | `npm run typecheck` | PASS |
| Next.js production build | `npm run build` | PASS；僅有 custom font、`img` 的非阻塞 lint warning |
| 公開頁渲染 | `npm run smoke:public` 檢查首頁、報名／付款、瀏覽器預約／我的預約／改期、取消、付款結果、嵌入與 `/admin/login` | HTTP 200，無 Application error |
| 瀏覽器 UI／互動 | Playwright desktop 1440×900、mobile 390×844；正式 Supabase active brand；初診切換、姓名／電話填寫與水平溢出檢查 | PASS；頁面無 application/page error 或水平溢出，外部 Google Fonts 受測試網路政策阻擋 |
| 登入／受保護邊界 | `/admin/login` 為 200；後台資料與三支 Cron API 未登入為 401 | PASS |
| 多品牌入口邊界 | slug／hostname resolver、URL `clinic_id` 不作為租戶依據 | 靜態契約 PASS |
| 預約併發設計 | time／number RPC advisory lock、容量條件、無 schedule template `limit 1`；正式 Supabase 兩連線測試 | PASS；time／number 均已實測 |
| 報名併發設計 | registration RPC advisory lock、答案快照、候補資料域；正式 Supabase 兩連線測試 | PASS；confirmed／waitlisted 已實測 |
| 付款建立／回跳 | ECPay／NewebPay server-only、TWD 幣別、付款期限、公開預約／報名回跳保留品牌路徑 | 靜態契約 PASS |
| 付款回呼 | ECPay／NewebPay server-only、簽章、event key、終態保護、重送後仍會 reconcile 下游狀態 | 靜態契約 PASS |
| CRM Lite | 分眾、三種規則式自動化、opt-in、冷卻、投遞去重 | 靜態契約 PASS；行銷 opt-in 正式 Supabase transaction PASS |
| 報名行銷同意同步 | 報名 API、`create_or_get_public_patient_with_marketing_opt_in`、既有顧客更新與未勾選不撤銷 | 正式 Supabase transaction PASS；測試資料已 rollback |
| appointment notifications | 預約建立、取消、改期與付款結果的 LINE／Email 投遞；appointment_notification_logs 去重與失敗重試 | 靜態契約 PASS |
| notification queue draining | 狀態事件以 `notification_processed_at` 與 `created_at + id` 游標逐頁處理；失敗保留重試 | Staging PASS；LINE 失敗可重試、Email 缺設定獨立跳過，所有渠道無失敗後事件游標才完成 |
| PII 角色邊界 | provider 的報名 JSON／CSV 匯出遮蔽姓名、電話、Email | 靜態契約 PASS |
| Provider 列級權限 | 指派醫師範圍 RLS、完成／未到限定寫入、叫號唯讀 | Staging PostgreSQL PASS；不可讀寫未指派預約，可完成被指派預約 |
| 套票取消一致性 | 後台、顧客自助與 LINE 取消共用原子取消 RPC 並恢復堂數 | Staging ledger PASS；取消恢復一次且重送冪等 |
| 新品牌建立 | 系統管理者授權、DB function 原子建立品牌／預設設定／品牌管理者 | 靜態契約 PASS |
| 會員／套票／優惠碼 | migration、租戶 RLS、原子扣抵、付款失敗釋放、後台管理與預約／報名入口；正式 Supabase 報名／預約扣點與折扣碼交易測試 | PASS；核心交易已實測 |
| Supabase security advisor | linked project migration 後重新檢查 | DB 函式／RPC 警告已清除；Auth leaked password protection 尚待 Dashboard 啟用 |
| anon REST 讀取邊界 | 以固定 UUID 合成顧客資料後，由 legacy anon／publishable key 查詢 `patients`、`appointments`、`registrations`、`payment_orders`、`crm_delivery_logs` | 正式 Supabase PASS；全部 HTTP 200 空陣列，測試後品牌／設定／顧客殘留數均為 0 |

## 2026-08-11 產品重整 M0–M6 增量

### 里程碑追溯狀態

| 里程碑 | 本機／程式狀態 | 正式環境狀態 |
|---|---|---|
| M0 範圍與基線鎖定 | 完成 | 不需外部渠道 |
| M1 產品架構與角色流程 | 完成 | 系統管理者、品牌管理者兩種管理身份與可授權員工、direct-route、server action、RLS 已完成 staging 正反向驗收 |
| M2 候補、LINE 多品牌、Rich Menu 資料契約 | 完成 | linked staging 已套用 `202608110001`～`202608110007`，local／remote 相符 |
| M3 後台導覽與啟用中心 | 完成 | Railway staging 已部署；系統管理後台與品牌營運後台共用登入入口、雙向切換與 `/admin/platform` 導向已用真實帳號驗收，品牌設定流程待使用者驗收 |
| M4 Rich Menu 重建 | 完成本機兩批功能 | 正式 LINE 發布、回復、Alias、排程與 Insights 待驗收 |
| M5 統一 LIFF 顧客中心 | 完成本機與響應式驗收 | 真實 LINE WebView／LIFF 身分待驗收 |
| M6 自動化、資安及跨租戶驗收 | 本機契約、型別、build、公開邊界與安全追溯完成 | PostgreSQL RLS、雙品牌、Cron 去重／重試與核心狀態機已完成 staging；外部投遞仍歸 M7 |
| M7 正式渠道驗證與文件交付 | staging deployment `f58f03c4-3758-4c2f-84ce-37f1f0513bf6`、migration 至 `202608130009`、`audit:staging-core` 6／6、`audit:staging-growth`、DB lint、四身分桌機／手機與顧客端成長流程驗收完成 | LINE／LIFF、Email、測試金流、DNS 與三個真實試用品牌觀察待外部設定及實際使用 |

| 項目 | 證據 | 結果 |
|---|---|---|
| 基線、資訊架構與功能差距 | `product-restructure-baseline.md`、`product-information-architecture.md`、`feature-gap-matrix.md` | PASS；核心／標準／加購／不做邊界已分離 |
| 品牌模組與多品牌 LINE／LIFF | `202608110001_product_modules_line_richmenu.sql`、`line-channel.ts`、品牌級 ID token 驗證、後台渠道 ready／error 驗證 | 本機契約、linked staging migration 與新版部署 PASS；正式渠道與手機 LIFF 待使用者設定及驗收 |
| 預約候補 | `202608110002`／`202608110003`、額滿目標分流、原子加入／遞補／接受／取消／逾時、LIFF／瀏覽器／後台介面、LINE／Email claim／retry／finish；Playwright 375px 完成加入、順位、名額保留與接受轉正式預約 | 本機契約／type-check／build／瀏覽器流程 PASS，375px 無水平溢位；`007` 額滿判斷修正已套用 linked staging，真實投遞待驗收 |
| 後台工作流 | 七群組導覽、角色工作台、七步驟開通狀態、模組及角色 direct-route guard | Staging PASS；營運員工無法進服務／資源／排程等品牌設定頁，品牌管理者可正常進入 |
| Rich Menu 版本生命週期 | 三模板、草稿、server 驗證、原子發布、下架、回復、補償與既有資料 v1 回填 | Staging 已實際建立 v1、複製 v2、另存 v3、比較版本、拒絕停用模組動作，並驗證實圖疊合 6 熱區及逐格連結；正式 LINE 發布／回復仍待外部渠道 |
| Rich Menu 第二批優化 | `202608110004`、Alias 官方 API、共享 channel 名稱隔離、richmenuswitch、台北時間顯示排程、5 次重試與稽核、版本複製／歷史比較、LINE Insights 與匿名轉換對照 | 契約／build／linked migration PASS；缺憑證時 Alias／排程／Insights 實測 disabled，正式正向流程待外部 LINE |
| PostgreSQL DB lint hardening | linked `public` schema 先找到 5 errors／2 warnings；套用 `202608110005`～`007` 後重跑 `supabase db lint --linked --schema public --level warning --fail-on warning` | linked staging PASS：`results=[]`、No schema errors found |
| 單一 LIFF 顧客入口 | `/book` 七個 view、活動 LIFF 身分、多人切換、票券 QR、會員與客服分流 | Playwright 375px 七 view PASS；414／768／1024／1440px 無水平溢出 |
| production runtime | 本機 `next start` + Playwright brand view；375px `scrollWidth=375` | PASS；console 0 errors／0 warnings |
| 視覺證據 | `output/playwright/customer-entry-375.png`、`appointment-waitlist-375.png`、`appointment-waitlist-offer-375.png` | PASS；票券 QR、七入口、候補成功與名額保留手機畫面已人工檢視 |
| Railway staging 公開邊界 | `npm run smoke:public` 對 `reservation-system-staging-staging.up.railway.app` | PASS；14 個公開入口為 200，五支 Cron 未授權均為 401，包含 `/embed/book` 與 `/api/cron/richmenu` |
| 單一 staging 核心 release gate | `railway run npm run audit:staging-core`；依序執行公開 smoke 與 security、booking、commerce、notifications、browser identity 五支 domain audit | 2026-08-13 fresh PASS（6／6）；任一 gate 失敗即停止，所有資料型 audit 均回報臨時資料清理成功 |
| 成長功能 release gate | `railway run npm run audit:staging-growth`；CSV 冪等、加購時長、三週系列、容量失敗整批回復、三品牌上限 | 2026-08-13 fresh PASS；Growth QA 品牌、資料與 Auth 帳號已清理 |
| 四身分與成長 UI | 系統管理者／系統員工／品牌管理者／品牌員工桌機與 390×844；顧客自訂欄位、加購、3 週預約與快速再約 | Staging PASS；未授權頁 server guard、無水平溢出、顧客系列實際建立後已清理 |

## 連接實際環境後必須執行

| 項目 | 必要環境或資料 | 未完成原因 |
|---|---|---|
| 產品重整 migration replay | linked staging migration 已套用至 `202608130009_recurring_booking_lint_fix.sql` | PASS；最新 DB lint 0 error／0 warning |
| 全新資料庫 schema replay | 隔離 PostgreSQL 16、Supabase Auth 最小角色／函式 bootstrap、`supabase/schema.sql` | PASS；首次建立與第二次重跑皆成功，63 張 public table 全部啟用 RLS、anon policy 0、最新品牌設定權限 policy 4／4 |
| 既有資料庫 migration、回填與回滾 | 一份可還原的 staging DB backup | 不可在沒有授權的資料庫上猜測或修改資料 |
| 雙品牌 anon 跨租戶攻擊 | Supabase anon key + 兩個品牌與成員測試資料 | Staging PASS；anon PII 空陣列、品牌 B 不可讀寫品牌 A，臨時資料已清理 |
| 預約／報名最後名額競爭 | Staging 兩連線平行請求，涵蓋 time／number、活動與跨服務共用資源 | PASS；最後名額只成功一次，活動第二筆進候補 |
| 金流回呼與重送 | ECPay／NewebPay test merchant、回呼 URL | 需要第三方商店設定與測試回呼 |
| 訂金／報名付款逾時釋放 | staging DB、待付款預約／報名、訂單、優惠名額與套票資料 | PASS；逾時取消／expired、優惠名額與 benefit 釋放均已實測，重送冪等 |
| LINE LIFF／Webhook／Rich Menu | 後台可自行填 destination、Login Channel ID、LIFF ID 與 endpoint；secret／token 維持 server environment；「重新驗證渠道」檢查 Bot、destination、webhook ready／error | 需要外部渠道設定與手機 LIFF 實測；伺服器 ready 不得取代發布／回復／點擊實測 |
| Email／行銷投遞 | Resend provider、寄件網域、測試信箱 | 需要部署環境 secret 與寄件網域驗證 |
| Cron 重跑、LINE 額度與錯誤恢復 | 部署後 staging Cron route 與臨時 notification／marketing 資料 | 內部流程 PASS；授權、去重、十分鐘後重試、缺渠道 skip／fail-closed 已驗證，真實 LINE 額度與送達仍待渠道 |
| 自訂網址／HTTPS | DNS 控制權、TLS／反向代理 | 本機無法證明 DNS ownership 與正式 HTTPS |
| Railway staging 頁面／API | `Reservation-System`／`staging`／`Reservation-System-staging` | deployment `f58f03c4-3758-4c2f-84ce-37f1f0513bf6` SUCCESS；migration 至 `202608130009`，DB lint 零警告；core 6／6 與 growth gate fresh PASS |
| 雙入口管理者登入 | 共用 `/admin/login` 的「系統管理後台／品牌營運後台」，真實 staging Auth + 系統管理者 + `staging-test` 品牌管理者 | PASS；同一帳號正確切換 `/admin/platform` 與 `/admin`，系統／品牌人員頁均顯示管理者與員工權限；390／768／1024px 無整頁水平溢位，管理頁瀏覽器 errors = 0 |
| 行動 LIFF、嵌入元件與瀏覽器完整流程 | staging URL、手機或 Playwright 環境 | 瀏覽器備援、跨網域嵌入、第三方儲存遭拒的安全降級與響應式已 PASS；真實 LINE WebView／LIFF ID token 尚待外部渠道 |
| 備份／還原演練 | PostgreSQL 16 custom-format dump、獨立還原資料庫；正式 staging 仍需 Supabase connection string／password | 本機全新資料庫 dump／restore PASS，還原後 63 張表、RLS 全開、anon policy 0；真實 staging 資料備份／還原仍待外部連線資料 |

## 執行順序

正式 staging 的逐項操作、輸入資料與證據欄位，請同步依 [staging 驗收 runbook](staging-acceptance-runbook.md) 執行。

1. 新環境執行 `supabase/schema.sql`；既有環境依 README 的 26 支 migration 順序執行。
2. 設定 `.env.example` 中的 Supabase、LINE、Email、付款與 `CRON_SECRET`。
3. 先跑 `npm test`、`npm run typecheck`、`npm run build`；部署後再以 `SMOKE_BASE_URL` 執行 `npm run smoke:public`。
4. 在 staging 建立至少兩個品牌、兩個後台帳號與各自的服務／活動資料。
5. 執行跨品牌、RLS、最後名額、回呼重送、提醒／行銷去重與 PII 匯出測試。
6. 通過後才把 staging URL、LINE／付款／Email／DNS 結果交給使用者做功能驗收。

## 已知限制

- 瀏覽器備援目前以品牌範圍內的必要欄位與簽名 token 識別，不包含 OTP；若正式服務需要 OTP，列為另行報價或新增需求。
- 標準金流包含綠界／藍新建立付款、TWD 訂單、回呼與狀態冪等；待付款逾時會由排程釋放保留名額；退款、對帳、其他金流商不在標準範圍。
- 套票標準規則為一堂抵一次預約或一張指定活動票；優惠碼套用報名票種，套票與優惠碼不可疊加。
- 本矩陣中的「靜態契約 PASS」不等同於已完成 PostgreSQL、LINE、Email、金流或 DNS 的正式環境驗收。

## Customer lifecycle coverage

| Requirement | Evidence | Current status |
|---|---|---|
| Customer appointment reschedule | LINE `/book/reschedule`; browser `/book/browser/my` and `/book/browser/reschedule`; server-side `reschedule_appointment` RPC with ownership and clinic checks | Contract PASS; production route smoke returned HTTP 200 |
| Browser fallback appointment continuity | Signed browser token is persisted per brand, then used for appointment listing, cancel, reschedule, and deposit payment | Staging PASS；本人清單、同品牌他人取消／改期拒絕、跨品牌 token、URL slug 切換、竄改 token 與資料清理皆已實測；金流正向流程仍待測試商店 |
