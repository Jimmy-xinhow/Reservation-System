# 維運、觀測與復原手冊

## 1. 服務邊界

| 區域 | 目前責任 | 失敗時的可見性 |
|---|---|---|
| Next.js Web | 公開入口、後台、顧客 API、Server Actions | HTTP status、後台錯誤畫面、Railway application log |
| Supabase | 租戶資料、RLS、交易 RPC、Auth | SQL migration／Postgres error、Supabase logs |
| Railway Cron | 提醒、會員提醒、報名付款逾時、CRM Lite、指定回訪、Rich Menu、會籍凍結 | `scripts/trigger-reminders.mjs` exit code 與各 endpoint response |
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
3. 確認 Railway Cron 最近一次 exit code 與七個工作結果與最後一次 cron_run 成功時間。
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

## G3-06 排程實際運作驗證（2026-09-20）

staging 實查僅有 Web service，cronSchedule／nextCronRunAt 皆為 null。近 24 小時可取得的 648 筆 HTTP logs 中，七筆 Cron 都是 smoke 401，沒有成功執行紀錄。此結果不排除專案外部排程，不能把未授權 smoke 當成排程執行成功。見 [本輪證據](g3-06-evidence-2026-09-20.md)。

2026-09-24 已在 staging 加入 `cron_job_runs` 心跳及系統管理「最近全域排程」視圖。只把 `mode=global` 的最新七類實際 worker 結果算作健康；`mode=scoped` 的隔離測試不會抵銷缺漏。`CRON_HEALTH_ENABLED=1` 須在真正排程 worker 上明確設定，且以 `CRON_SECRET` 授權寫入；Web 或 DB 有欄位不代表排程已啟動。staging 實際見七類全域均「尚無紀錄」，仍須先核對 scheduler 服務和 `nextCronRunAt`，再看心跳時間及安全結果碼。[相符驗證](g3-06-cron-heartbeat-evidence-2026-09-24.md)。

`GET /api/cron/health` 是供獨立監測用的只讀查詢，先驗 `CRON_SECRET`，再依平台健康頁相同的七類全域工作和各自期限判斷。七類都新鮮且成功才回 HTTP 200；缺紀錄、失敗、逾時或時間異常回 503，只輸出工作名稱與固定狀態，不回傳顧客、品牌或密鑰。DB 讀取故障也回 503。`scripts/monitor-cron-health.mjs` 以 `APP_URL` 與 `CRON_SECRET` 呼叫，對 503、401、無效回應及連線錯誤均非零退出，日誌不輸出回應原文。`deploy/cron/health-monitor.json` 是每五分鐘執行的獨立 Railway service 候選設定，worker 不需 Supabase service-role、LINE 或 Email 密鑰。真正建立持續服務前，須確認全域七類 worker、告警收件端與 [Railway Cron](https://docs.railway.com/cron-jobs)／[Webhooks](https://docs.railway.com/observability/webhooks) 設定；目前只讀監測程式不等於告警已送達。

### 工作失敗處理

1. 找 `cron_run` 的執行時間與 status，再看同次七個 `cron_job` 的 job、status、http_status、duration_ms。
2. 401：核對 worker 與 Web 的 CRON_SECRET 是否匹配；不要把 secret 貼入日誌或工單。
3. http_failed／invalid_or_failed_result：核對 HTTP 狀態與對應 server 錯誤 ID；200 的 HTML 或 ok:false 也屬失敗。
4. partial_failure：依通知紀錄與去重鍵查 sent／failed／processing；先確認是否已被供應商接受，不盲目重送。
5. timeout／request_failed：視為結果不明，先查資料庫狀態，再使用既有冪等流程恢復；worker 本身不自動重送。
6. 完全沒有 cron_run：先核對服務是否真的配置 schedule、服務命令及下次執行時間，不能因「零筆失敗」判斷健康。

### 啟用與告警尚需實測

- 獨立 Cron worker 的 build／start command、CRON_SECRET、APP_URL 與 UTC 排程需與目標環境一致。現有 Railway 文件的一小時週期不等同 Vercel 五分鐘的報名／Rich Menu 處理週期，須在正式採用前確認可接受的延遲。
- 平台告警至少涵蓋 worker 非零退出、連續未執行及 Web 不可達；需要指定實際告警收件人與漏跑門檻，保存故障／恢復送達證據。結構化日誌本身不是告警送達。
- 啟用前先確認工作範圍與待發佇列。七個 endpoint 的 GET 是全域工作，POST 支援指定品牌與紀錄；測試使用明確 scoped worker，不把「staging」當作任意發訊的授權。
- 維持通知唯一鍵與已送出紀錄，不以刪除 sent 紀錄重試。實際去重／重試與外部送達仍依 G2-06 的渠道驗收。

## 結果不明與通知積壓檢查（2026-09-21）

預約／報名狀態通知的 `sending` 代表已領取且可能送出，時間經過不能證明失敗。供應商呼叫後發生連線例外、寫回失敗或回應遺失，保留原狀態；不能改成 `failed` 或刪除去重紀錄。再次遇到 `sending` 時保留未處理事件並回報異常，不在十分鐘後自動重送。`failed` 聚合計數包含待查情況，不等同資料庫可重試狀態。

人工處置依序查相同品牌、通知紀錄、時間與供應商請求／投遞證據：

1. 已確定供應商接受：以受控修復確認原通知，保存證據與操作者，再執行指定紀錄的佇列；不可新建同一通知。
2. 已確定未接受且原執行程序已結束：才可評估可重試狀態，先核對當前預約／報名及渠道是否仍有效。
3. 無法判斷：維持待查，不能以逾時或沒有本機成功日誌推定未送出。

以上是維運判斷流程，尚未提供通用管理者核銷 API／UI；不提供能任意清空待查狀態的自動腳本。歷史 `failed` 資料可能由舊程式的模糊結果產生，不能直接批次重送。

`scripts/check-delivery-health.mjs` 補足「Cron 成功但通知卡住」的盲點：

```powershell
node scripts/check-delivery-health.mjs --clinic-ids=<品牌UUID,品牌UUID> --max-age-minutes=15
```

由有 server-only 環境的維運程序執行。它對七類通知表做八組 `HEAD` 精確計數，每組都限定品牌；僅輸出表名、狀態及數量，不回傳收件者、訊息、紀錄 ID 或供應商錯誤。涵蓋逾時進行中、失敗、逾期尚未執行的 LINE／Email 回訪；人工／電話回訪不計入自動排程積壓。查詢錯誤、數量不可用或不合法範圍一律非零退出，不解讀成零筆。

應由獨立監測器同時檢查 Cron 新鮮度及投遞積壓，連接實際告警接收渠道。這兩個 CLI 不是常駐監測服務，`healthy` 也不證明訊息送達。目前尚未部署長期監測／告警。202609210004 已移除提醒及候補的逾時重領；提醒、候補、行銷、會員的供應商呼叫後例外保留 sending／claimed／pending／sent，不改成 failed。候補略過既有 claimed 時，單次 Cron 可以成功，因此必須另查投遞積壓，不能只看 Cron 成功。真實渠道送達仍需另外驗證。

## 平台健康頁與 staging 現況（2026-09-23）

平台「營運健康」頁已改為八組匿名計數，包含 `sending`、`claimed`、`failed` 和逾期 LINE／Email 回訪；查詢失敗不顯示零。此頁是人工查看入口，不是常駐監測器。即使八組皆零，仍明示「排程健康尚未接入監測」；排程金鑰已設定不等於 worker 已啟用。

本次 Railway staging 拓撲只有 Web，`cronSchedule` 與 `nextCronRunAt` 都是 null。一次性隔離系統員工登入驗證頁面能顯示逾期回訪 0→1→0，合成品牌與帳號已按 ID 清理。長期排程、漏跑／恢復告警接收及真實 LINE／Email 送達未啟用；不可據此把 G3-06 標成通過。見 [線上證據](g3-06-platform-health-2026-09-23.md)。
