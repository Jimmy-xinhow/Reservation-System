# Staging 完整驗收紀錄（2026-08-12～2026-08-13）

環境：`https://reservation-system-staging-staging.up.railway.app`

應用部署：`4c909311-e0b8-4081-907f-9a96e864c36c`（Railway `staging`，SUCCESS）

資料庫：linked staging 已套用至 `202608130004_brand_configuration_permission_boundaries.sql`；最後一次 linked DB lint 為 0 error／0 warning。

本輪優先範圍：系統管理者、品牌管理者、可追加權限的系統／品牌員工，以及 LINE／LIFF／Rich Menu 完整流程。外部渠道憑證未設定，因此本文嚴格區分「平台流程已驗證」與「正式外部渠道尚未驗證」。

## 發布與基礎閘門

| 驗收 | 結果 |
|---|---|
| `npm test` | PASS |
| `npm run typecheck` | PASS |
| `npm run build` | PASS；僅保留既有 `<img>` 與 custom font 非阻塞 warning |
| `git diff --check` | PASS；僅 CRLF 提示 |
| `npm run smoke:public`（部署後） | PASS；14 個公開頁 HTTP 200，5 支未授權 Cron HTTP 401 |
| 無簽章 POST `/api/line/webhook` | PASS；HTTP 401 `invalid signature` |

## 角色、導覽與權限

以四個臨時 staging Auth 帳號與一個臨時品牌實測，完成後帳號、品牌、草稿與關聯資料均已刪除。

| 角色／範圍 | 實測結果 |
|---|---|
| 共用登入入口 | `/admin/login` 可選「品牌營運後台」或「系統管理後台」，登入後由伺服器依實際角色導向 |
| 系統管理者 | 顯示中文「系統管理者」；可見總覽、人員與權限、營運健康、跨品牌報表、稽核、設定共 6 個平台入口 |
| 系統員工（僅 `platform.overview`） | 顯示中文「系統員工」；只看見系統總覽；直接開 admins／operations／reports／audit／settings 全部導回 `/admin/platform` |
| 品牌管理者 | 顯示中文「品牌管理者」；可進服務、資源、排程、例外日期、團隊、稽核、LINE 與 Rich Menu |
| 品牌員工（僅 `operations.manage`） | 顯示中文「品牌員工」；保留日常預約、顧客與營運流程；空狀態不再顯示新增排程 CTA |
| 品牌設定 direct route | 品牌員工直接開 schedules／services／resources／exceptions／audit／users／richmenu 全部導回 `/admin`；品牌管理者同一批頁面全部正常開啟 |
| 品牌設定資料寫入 | RLS 實測：營運員工不可新增服務提供者、修改服務或新增排程；品牌管理者可建立服務、人員與排程 |
| 雙後台切換 | 同時有兩個工作區的系統管理者：品牌頁顯示「系統總控台」，系統頁顯示「返回品牌後台」（手機版短標籤「品牌後台」） |
| 按鈕顯示時機 | 純品牌管理者／品牌員工不顯示系統總控台；純系統員工不顯示返回品牌後台 |
| 響應式 | 390 × 844 的品牌頁、系統頁及全部設定頁 `horizontalOverflow=0`，Application error = 0 |

## LINE、LIFF 與 Rich Menu

| 流程 | 實測結果 |
|---|---|
| LINE 後台設定 | 可設定共享／獨立渠道、destination、Login Channel ID、LIFF ID 與 endpoint；secret／token 僅顯示是否存在 |
| 未就緒安全失敗 | 缺 destination、token、Login Channel、LIFF ID 與正式渠道驗證時，發布、Alias、排程、Insights 全部 disabled |
| Rich Menu 草稿 | 實際建立 v1、複製 v2、再由「預約型」模板另存 v3；畫面顯示「草稿版本已儲存」，線上版本仍為「未發布」 |
| 模組邊界 | 活動模組關閉時，把第 3 格改成「活動／課程」並另存，server 以 `第 3 格使用了未開放的活動入口` 拒絕，版本數不變 |
| 版本比較 | 實際開啟 v3 對 v2 的比較網址，頁面正常顯示比較內容，Application error = 0 |
| 背景與熱區預覽 | 實際上傳圖片後，背景與 6 個點擊熱區疊合顯示；逐格瀏覽器測試連結共 6 個，第一格正確開啟 `/book/browser?clinic_slug=staging-test` |
| 手機版 | Rich Menu 390 × 844 無水平溢位，瀏覽器 console 0 errors／0 warnings |
| Webhook | 無 `x-line-signature` 的請求確實被拒絕為 HTTP 401 |
| LIFF／瀏覽器備援 | 缺 LIFF 設定時顯示未就緒並提供 browser fallback；公開備援路由 smoke 為 HTTP 200；Rich Menu 的瀏覽器目標不再誤進 LIFF shell |
| 跨網域嵌入 | 由 `data:` 外部頁面嵌入 `/embed/book?clinic_slug=staging-test`，第三方儲存空間遭拒時仍完整顯示預約表單，console 0 errors |

上述 v1～v3 是臨時品牌的驗收草稿，清理時已一併刪除，從未發布到 LINE，也未變更任何正式 Rich Menu。

## 自動化全流程驗收

以下腳本均強制要求 `RAILWAY_ENVIRONMENT_NAME=staging`，使用獨立臨時資料並在完成後清除：

| 腳本 | 已驗證內容 | 結果 |
|---|---|---|
| `audit:staging-security` | anon PII、跨租戶讀寫、營運寫入、品牌設定寫入拒絕、品牌管理者正向設定 | PASS |
| `audit:staging-booking` | time／number 最後名額競態、初診 45 分鐘、兩種候補、跨服務共用資源容量、免指定人員改期與回滾、訂金待付與逾時、provider RLS、歷程 | PASS |
| `audit:staging-commerce` | 私人活動 token、活動容量與候補、表單／條款快照、QR 與錯誤 QR、套票、優惠碼互斥、報名付款逾時釋放、付款 event 冪等 | PASS |
| `audit:staging-notifications` | 同日提醒、Cron 授權、LINE fail-closed、提醒重試／去重、三種 CRM 自動化、opt-in、雙渠道事件游標 | PASS |
| `audit:staging-browser-identity` | signed token 建立、本人預約清單、同品牌他人取消／改期拒絕、跨品牌 token、URL slug 切換與 token 竄改拒絕 | PASS |

2026-08-13 以 `railway run npm run audit:staging-core` 對目前 staging 重新串行執行公開 smoke 與上述五支 domain audit；6／6 gate 全部 PASS。此總控入口從 `RAILWAY_PUBLIC_DOMAIN` 推導實際 staging URL，且任一 gate 失敗便停止，不會以後續結果掩蓋失敗。

另以隔離 PostgreSQL 16 對 `supabase/schema.sql` 完成全新資料庫建立與第二次重跑，兩次皆成功；建立 63 張 public table、全部啟用 RLS、anon policy 為 0。再以 custom-format dump 還原至另一個全新資料庫，還原後上述結構與安全計數一致。這是本機全新環境與 logical backup／restore 證據，不取代真實 staging 資料庫備份。

## 本輪找出並修正的問題

1. 系統員工直接開未授權頁會出現 server error，現統一安全導回總覽。
2. 品牌報表匿名漏斗改由已驗證的 server boundary 依 `clinic_id` 讀取。
3. 零權限但仍有有效 Auth session 的帳號不再觸發後台 HTTP 500。
4. 服務型預約不再依賴未寫入的 `appointments.template_id`。
5. provider 顧客 RLS 的 policy recursion 已消除。
6. 活動報名流水號不再誤把日期當流水號。
7. 不同服務共用同一容量資源時，加入每資源 advisory lock，最後名額只會成功一次。
8. 預約訂金逾時所需的 `deposit_status='failed'` 已補進資料庫約束。
9. 品牌營運員工原可繞網址修改服務／資源／排程；現頁面 guard、server action 與 RLS 三層都要求 `brand.manage`。
10. staging 角色 fixture 的 Rich Menu 清理順序已修正，避免版本外鍵造成 QA 資料殘留。
11. 品牌開通中心第 7 步不再把缺少外部 LINE／付款／Email 設定誤標為完成。
12. Rich Menu 的「立即預約」瀏覽器測試目標由 LIFF shell 修正為 `/book/browser`。
13. 嵌入頁在第三方 iframe 禁用 `localStorage` 時不再出現 Application error，改以安全儲存存取降級。

## 測試資料清理

- 角色驗收臨時品牌：已刪除 1 個。
- 角色驗收臨時 Auth 帳號：已刪除 4 個。
- 角色驗收 Rich Menu 草稿：已隨臨時品牌刪除。
- Playwright 瀏覽器工作階段：`close-all` 後確認為 0。
- 五支 staging audit 各自回報臨時資料與 Auth 帳號清理成功。
- 2026-08-13 `audit:staging-core` fresh 重跑後再次確認五支資料型 audit 均完成清理。

## 尚未完成的外部驗收

本輪 staging 能力檢查結果：LINE channel token mapping = false、共享 LINE token = false、Email provider = false、payment secrets = false。因此以下項目尚不能做正向驗收：

- Bot／destination／webhook ready 的正式正向驗證。
- 真實手機 LINE WebView、LIFF ID token 與多人顧客切換。
- Rich Menu 正式發布、回復、下架、Alias 雙向切換、台北時間排程、重試與官方 Insights。
- 真實 LINE push／reply 與點擊後預約、報名轉換。
- Resend Email 真實送達。
- 綠界／藍新測試商店建立付款與正式回呼。
- 自訂網域 DNS／TLS。

未取得上述外部證據前，不將 M7 或正式渠道標示為完成。
