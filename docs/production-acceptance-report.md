# Reservation System v3 驗收證據報告

更新日期：2026-08-06

本報告記錄目前已取得的程式、正式 Supabase 資料庫與併發驗收證據。沒有外部服務設定或備份／還原證據的項目，仍維持未完成，不宣稱正式上線完成。

## 已完成

### 程式與提交

- `npm test`：PASS，契約測試包含租戶隔離、RLS、預約／報名／付款／CRM Lite 與 SQL 回歸檢查。
- `npm run typecheck`：PASS。
- `npm run build`：PASS。現有 lint warning 只涉及 custom font 與 `<img>`，不阻擋 build。
- `npm run smoke:public`：PASS；本機 production server 的四個公開頁回 200，三支 Cron 未授權回 401。
- 簡報視覺 token：深青／天藍／金色與 Noto Sans TC／Inter 字體基線已同步，`accent-700` CSS class 已由 production build 產生。
- client static output 掃描：未發現 `SUPABASE_SERVICE_ROLE_KEY`、金流／Email／LINE secrets 或 `service_role`／敏感資料欄位標記。
- GitHub `main` 已同步，並包含管理員成員密碼重設流程的錯誤訊息亂碼修正與本報告更新。
- 已保留 smoke 與 Supabase CLI 暫存目錄，未納入提交。

### 正式 Supabase

- 專案：`Reservation system`。
- Project ref：`cmoacgcbxllfpwhiidsx`。
- 已依既有資料庫順序套用 CRM Lite、報名／付款、v3 hardening、會員／優惠券與 v4 role matrix。
- 目前 `public` 有 47 張資料表，全部啟用 RLS。
- 系統目錄檢查沒有 anon／public policy；核心預約與報名 RPC 僅 service role 可執行。
- anon REST 對 `clinics`、`patients`、`appointments`、`registrations` 的唯讀結果均為空集合。

### 正式資料庫交易驗收

使用單一 transaction 建立暫時資料並 rollback，已通過：

- 時間制預約：同日重複顧客拒絕、跨品牌 doctor／patient 綁定拒絕。
- 號次制預約：號次遞增與容量封頂。
- 活動報名：容量、候補、QR 報到與重複 QR 報到冪等。
- 會員方案：報名扣點、預約扣點、餘額與 ledger 一致。
- 折扣碼：折扣金額、報名綁定、redemption audit 與使用次數一致。
- CRM Lite：標籤分眾刷新、投遞 claim 去重與跨品牌拒絕。
- 兩連線併發：容量 1 的預約最後只成功 1 筆；容量 1 的活動最後為 1 筆 `confirmed` 與 1 筆 `waitlisted`。
- 併發 fixture 清理後，clinic、doctor、patient、appointment、event、registration 殘留數均為 0。

## 尚未完成的外部驗收

- 備份／還原演練：本機沒有 Docker Desktop 或 `pg_dump`，尚未取得可還原 backup 證據。
- LINE LIFF、Rich Menu、webhook signature、destination mapping：需要品牌 Channel 設定與 secret。
- Email／行銷投遞：需要 Email provider、寄件網域與測試信箱。
- ECPay／NewebPay：需要 test merchant、金流設定與可接收的 callback URL。
- Cron 重跑：需要部署 URL 與 `CRON_SECRET`。
- 自訂網域／HTTPS：需要 DNS 控制權與正式 TLS／反向代理設定。

以上項目不是以程式碼推測代替實測；完成前不標記整體目標為 complete。
