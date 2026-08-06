# 維運、觀測與復原手冊

## 1. 服務邊界

| 區域 | 目前責任 | 失敗時的可見性 |
|---|---|---|
| Next.js Web | 公開入口、後台、顧客 API、Server Actions | HTTP status、後台錯誤畫面、Railway application log |
| Supabase | 租戶資料、RLS、交易 RPC、Auth | SQL migration／Postgres error、Supabase logs |
| Railway Cron | 每小時提醒、報名付款逾時、CRM Lite 行銷 | `scripts/trigger-reminders.mjs` exit code 與各 endpoint response |
| LINE | LIFF 身份、Webhook、推播 | webhook signature／provider error、通知 delivery log |
| Email | 行前提醒與 CRM Lite Email | `appointment_notification_logs`、`crm_delivery_logs` |
| 金流 | 綠界／藍新標準付款與回呼 | `payment_status_events`、payment order 狀態與 webhook replay key |

## 2. 每次部署前

1. 確認 `git status` 只包含本次預期變更，確認 `.env` 與 server secrets 未進版控。
2. 先做正式 Supabase backup，再依 README 的既有 migration 順序套用新 migration。
3. 執行 `npm test`、`npm run typecheck`、`npm run build`。
4. 執行公開 smoke：首頁、瀏覽器預約、我的紀錄、活動報名、會員入口、後台登入與 Cron 未授權邊界。
5. 兩品牌驗證：同一登入者切換品牌後，公開 URL、顧客 token、後台查詢、CRM 與報表不能跨品牌。
6. 只有完成以上證據，才把 Railway `main` 的部署視為可驗收版本。

## 3. 事件與排查順序

### 顧客看不到預約／報名

1. 確認目前入口的品牌 slug／custom domain 是否正確。
2. 確認瀏覽器 token 尚未過期且沒有跨品牌使用。
3. 確認 `registrations.patient_id` migration 已套用；舊報名仍可用報名編號＋電話 fallback。
4. 再查 API response 與 Supabase service log，不直接把問題歸因於前端。

### 通知未發送

1. 查 `appointment_notification_logs` 或 `crm_delivery_logs` 的狀態、錯誤與去重鍵。
2. 確認顧客已同意行銷、渠道資料存在、品牌 Email／LINE 設定完成。
3. 確認 Railway Cron 最近一次 exit code 與三個 endpoint response。
4. 重跑前先確認 claimed／sent／failed 狀態，不能手動重送造成重複。

### 金流／報名狀態不一致

1. 以 payment order、provider event key 與 payment status event 對照。
2. 確認回呼的品牌、簽章與合法狀態轉移。
3. 不直接修改終態資料；使用既有 reconciliation／expiry 流程或保留稽核紀錄。

## 4. 備份與復原

- migration 前必須保留可還原的正式 DB backup，並記錄 backup 時間、migration 名稱與操作者。
- 任何資料修復先在 staging replay；不可用 `DELETE` 取代取消、停用或狀態修復。
- 若新 migration 失敗，停止部署並保留錯誤內容；不要略過外鍵、RLS 或 NOT NULL 驗證。
- 目前不引入額外觀測套件；以既有資料庫稽核表、投遞紀錄、結構化 endpoint log 與 Railway／Supabase 原生紀錄為第一層證據。

## 5. 七項加購能力的服務生命週期

七項清單（指定金流、退款與對帳、外部行事曆同步、外部 API／資料交換、進階白牌入口、多語系、產業客製模組）在平台後台的勾選只代表「合約／合作備註已確認」，不代表程式已交付或自動啟用。正式生命週期為：

`需求確認 → 報價 → 合約確認 → 開發／設定 → staging 驗收 → 正式交付 → 維護`

合約只提供系統維護，不包含清單外新功能的建立；任何新功能都必須重新確認範圍、驗收與報價。
