# Reservation System v3 驗收矩陣

日期：2026-08-06
基準：`AGENTS.md`、`clinic-booking-spec-v3.md`

本文件把「程式碼與本機可證明的結果」和「必須連接實際外部環境的結果」分開。沒有 Supabase 或第三方服務證據的項目，不視為已完成正式上線驗收。

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
| notification queue draining | 狀態事件以 `notification_processed_at` 與 `created_at + id` 游標逐頁處理；失敗保留重試 | 靜態契約 PASS；需 staging Cron 壓力／重跑實測 |
| PII 角色邊界 | provider 的報名 JSON／CSV 匯出遮蔽姓名、電話、Email | 靜態契約 PASS |
| Provider 列級權限 | 指派醫師範圍 RLS、完成／未到限定寫入、叫號唯讀 | 靜態契約 PASS；需 staging PostgreSQL 實測 |
| 套票取消一致性 | 後台、顧客自助與 LINE 取消共用原子取消 RPC 並恢復堂數 | 靜態契約 PASS；需 staging ledger 實測 |
| 新品牌建立 | owner/admin 授權、DB function 原子建立品牌／預設設定／owner | 靜態契約 PASS |
| 會員／套票／優惠碼 | migration、租戶 RLS、原子扣抵、付款失敗釋放、後台管理與預約／報名入口；正式 Supabase 報名／預約扣點與折扣碼交易測試 | PASS；核心交易已實測 |
| Supabase security advisor | linked project migration 後重新檢查 | DB 函式／RPC 警告已清除；Auth leaked password protection 尚待 Dashboard 啟用 |
| anon REST 讀取邊界 | 以固定 UUID 合成顧客資料後，由 legacy anon／publishable key 查詢 `patients`、`appointments`、`registrations`、`payment_orders`、`crm_delivery_logs` | 正式 Supabase PASS；全部 HTTP 200 空陣列，測試後品牌／設定／顧客殘留數均為 0 |

## 連接實際環境後必須執行

| 項目 | 必要環境或資料 | 未完成原因 |
|---|---|---|
| 全新資料庫 migration replay | 獨立 staging Supabase project、SQL Editor 或 migration runner | 正式目標 project 已套用並驗證；獨立 staging replay 仍需另行建立，避免直接覆蓋正式資料 |
| 既有資料庫 migration、回填與回滾 | 一份可還原的 staging DB backup | 不可在沒有授權的資料庫上猜測或修改資料 |
| 雙品牌 anon 跨租戶攻擊 | Supabase anon key + 兩個品牌與成員測試資料 | 正式庫已完成匿名敏感表空陣列驗收；雙品牌跨租戶情境仍待 staging 資料 |
| 預約／報名最後名額競爭 | 正式 Supabase 兩連線平行請求已完成；仍可在獨立 staging 重跑 | 正式目標已通過；staging 重跑證據待建立 |
| 金流回呼與重送 | ECPay／NewebPay test merchant、回呼 URL | 需要第三方商店設定與測試回呼 |
| 訂金／報名付款逾時釋放 | staging DB、Cron、待付款預約／報名資料 | 本機無 PostgreSQL／Cron，尚未證明實際名額釋放 |
| LINE LIFF／Webhook | Channel、LIFF、destination mapping、secret | 需要品牌提供 LINE 設定 |
| Email／行銷投遞 | Resend provider、寄件網域、測試信箱 | 需要部署環境 secret 與寄件網域驗證 |
| Cron 重跑、LINE 額度與錯誤恢復 | Vercel Cron 或 Railway scheduler | 需要部署後的排程與 log |
| 自訂網址／HTTPS | DNS 控制權、TLS／反向代理 | 本機無法證明 DNS ownership 與正式 HTTPS |
| Railway production 頁面／API | `Reservation-System`／`production`／`Reservation-System`；公開 URL smoke 與 `/api/booking/config`、`/api/registration/events` | PASS；頁面 HTTP 200、兩個公開資料 API HTTP 200 且 `ok=true`、Cron HTTP 401；deployment `50168500-a41e-4b36-a694-5a03384f8d74` 為 `SUCCESS` |
| 行動 LIFF、嵌入元件與瀏覽器完整流程 | staging URL、手機或 Playwright 環境 | 本回合沒有實際第三方登入與資料庫資料 |
| 備份／還原演練 | Supabase backup 或等價 staging backup；本機已找到 PostgreSQL 16 `pg_dump.exe` | 尚缺可用的 Supabase DB connection string／password 與獨立還原目標 |

## 執行順序

正式 staging 的逐項操作、輸入資料與證據欄位，請同步依 [staging 驗收 runbook](staging-acceptance-runbook.md) 執行。

1. 新環境執行 `supabase/schema.sql`；既有環境依 README 的八支 migration 順序執行。
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
| Browser fallback appointment continuity | Signed browser token is persisted per brand, then used for appointment listing, cancel, reschedule, and deposit payment | Contract PASS; staging identity and cross-brand tests remain required |
