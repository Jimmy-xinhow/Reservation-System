# XINHOW 外部渠道設定與驗收

版本：2026-08-13。品牌後台中的「啟用」是產品開關，不代表外部渠道已可用。所有 secret、token、HashKey、HashIV 與 API key 只可放在部署環境變數。

## LINE Messaging API 與 LIFF

1. 在 LINE Developers 建立或確認 Messaging API Channel 與 LINE Login Channel。
2. 從實際 webhook payload 取得 `destination`，填入品牌 LINE 設定；不可猜測。
3. 填 LINE Login Channel ID、LIFF ID 與 endpoint path。顧客預約通常使用 `/book`；瀏覽器備援使用品牌 slug。
4. 共享渠道在 server environment 設定單一 fallback；多品牌獨立渠道以 destination 對應 `LINE_CHANNEL_SECRETS_JSON` 與 `LINE_CHANNEL_ACCESS_TOKENS_JSON`。
5. Webhook URL 指向 `/api/line/webhook`，確認 LINE 平台驗證成功。
6. 回到「渠道測試中心」執行全部測試；Messaging API、LIFF ID、Login Channel、endpoint 與後端渠道驗證需分項通過。
7. 用真實 LINE 手機完成登入、預約、我的預約與訊息收件。伺服器檢查不能取代手機 LIFF 測試。

## Rich Menu

1. 先在 XINHOW 建立草稿，不直接改線上選單。
2. 依版型上傳 PNG／JPEG；系統檢查 MIME、尺寸與檔案大小。
3. 每格填顯示名稱、無障礙標籤與標準顧客任務；特殊 URI 仍須屬於正確品牌。
4. 用瀏覽器逐格測試，再執行草稿驗證。
5. 發布後以手機 LINE 重新開啟聊天室檢查圖片、熱區與品牌路由。
6. 另建立回復前一版的驗收證據；若使用 Alias／排程，確認同一 channel、Asia/Taipei 時間與結束後回復。

## Email

1. 在寄件服務驗證網域與寄件人。
2. 在 server environment 設定品牌可解析的 API key／from mapping。
3. 品牌後台開啟 Email 提醒，再執行渠道測試中心。
4. 用測試顧客完成預約，確認實際收件、台北時間、重試與同一預約同渠道不重複。
5. 未通過時關閉 Email；LINE 仍應獨立工作。

## 綠界／藍新

1. 品牌後台選 provider 與測試／正式環境，保存 Merchant ID。
2. HashKey／HashIV 只設定於 server environment，不回填畫面。
3. 在測試環境完成預約或報名付款、return、notify callback 與狀態查詢。
4. 重送同一 webhook，確認冪等且不會把 terminal 狀態降級。
5. 驗證待付款逾時會釋放容量、套票／優惠碼並推進候補。
6. 測試完成前不切換正式環境；完整退款與對帳仍屬另行報價。

## 平台短網址、自訂網域與嵌入

1. 平台共用 host 必須列入 `PUBLIC_SHARED_HOSTS`；品牌短網址為 `/book/browser?clinic_slug=<slug>`。
2. 渠道測試中心必須實際確認 host 與 slug 可解析到目前品牌，不能只顯示網址字串。
3. 自訂網域需保存 hostname、DNS 驗證 token、`verified_at` 與 active 狀態；未驗證網域不可路由。
4. 驗證 HTTPS、錯誤 slug、host spoof、跨品牌 slug／host 組合與 iframe allowlist。
5. 瀏覽器第三方儲存遭拒時必須安全降級，不得繞過顧客 token 或租戶邊界。

## 渠道結果判讀

| 狀態 | 意義 | 下一步 |
|---|---|---|
| 通過 | 可由伺服器確認的設定與解析已完成 | 繼續手機收件／付款等真實外部 smoke test |
| 待完成 | 品牌尚未啟用或該渠道非必要 | 確認商業需求後再設定，不視為系統故障 |
| 失敗 | 已啟用但缺設定、憑證或品牌解析 | 依卡片指引修復，重跑並保存新結果 |

