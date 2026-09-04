# 擴充功能評估（2026-09-04）

本文件是第 5 階段的決策紀錄，不代表外部服務已完成串接。評估原則是先沿用既有多品牌、顧客、訂單、點數與排程資料，再接外部服務；不另外建立平行系統。

## 成熟系統參照

| 參照系統 | 採用的做法 | 不直接複製的原因 |
| --- | --- | --- |
| [Cal.com](https://github.com/calcom/cal.com)／[官方說明](https://cal.com/docs/availability) | 可用時間、外部日曆衝突、OAuth 授權與同步失效後重建 | 專案採 AGPL；只參照流程與資料邊界，不搬入程式碼 |
| [ERPNext](https://github.com/frappe/erpnext)／[Loyalty Program](https://docs.frappe.io/erpnext/v13/user/manual/en/accounts/loyalty-program) | 採購、收貨、盤點、銷售單、點數異動帳與等級門檻 | ERP 範圍遠大於本產品；保留預約 SaaS 所需的精簡流程 |
| [Moodle](https://github.com/moodle/moodle)／[Activity completion](https://docs.moodle.org/38/en/Activity_completion) | 單元完成條件、測驗自動判分、作業審核、完課狀態 | 不導入完整 LMS；只保留報名後實際需要的學習流程 |

以上專案皆為 GPL／AGPL 類授權。本專案只參照資訊架構、操作流程與驗收條件，不直接複製受授權限制的原始碼。

## 擴充項目決策

| 順序 | 項目 | 建議 | 目前可沿用 | 正式接入前必要條件 |
| --- | --- | --- | --- | --- |
| P1 | Google Calendar 雙向同步 | 下一階段優先 | 預約、服務人員、排程、例外日期 | Google Cloud OAuth Client、授權範圍、每位人員同意、衝突處理規則、Webhook 公開網址 |
| P1 | 台灣電子發票 | 付款穩定後接入 | 結帳單、付款紀錄、顧客 Email | 決定加值中心或 Turnkey、營業人資料、測試帳號、字軌、作廢與折讓規則 |
| P2 | 多店／總部分店 | 先做需求確認再開發 | 多品牌隔離、帳號切換、跨品牌系統報表 | 確認總部是否可看跨店顧客、庫存是否共用、會員權益是否跨店、資料同意範圍 |
| P2 | 推薦獎勵 | 可沿用點數帳本 | 顧客、點數 ledger、訂單 | 獎勵觸發點、雙方獎勵、退款追回、同裝置／同電話防濫用規則 |
| P2 | 簡訊通知 | LINE／Email 穩定後再接 | 訊息範本、通知去重、失敗重試 | 簡訊供應商帳號、單價、發送時段、退訂與個資告知 |

## Google Calendar 實作邊界

Google 官方建議先做完整同步並保存 `syncToken`，後續使用增量同步；token 失效收到 HTTP 410 時必須重做完整同步。即時更新要用 HTTPS Webhook 的 push notification channel。參考：[增量同步](https://developers.google.com/workspace/calendar/api/guides/sync)、[Push notifications](https://developers.google.com/workspace/calendar/api/guides/push)。

預計資料：每個服務人員一筆 OAuth connection、calendar id、加密 refresh token、sync token、watch channel、到期時間與最後錯誤。Google 行程只作外部忙碌來源；本系統仍是預約真實來源。外部刪除行程不得直接刪除預約，必須建立待處理衝突。

## 電子發票實作邊界

財政部 Turnkey 分測試與正式環境，且正式申請涉及營業人設定與連線條件；兩個環境不可混用。參考：[Turnkey 使用說明](https://www.einvoice.nat.gov.tw/static/ptl/ein_upload/attachments/1536138040171_2.pdf)。

預計狀態：待開立、已開立、開立失敗、已作廢、已折讓。付款成功只建立「待開立」工作，不讓金流 Webhook 等待發票供應商；發票回應另以冪等鍵保存，避免重複開立。

## 明確不在本輪假裝完成

- Google Calendar、電子發票、LINE、Email 與藍新／綠界正式接入都需要外部帳號或憑證；未取得前只標示為「待接入」。
- 多店資料共享和推薦獎勵會改變個資與商業規則；未確認規則前不新增 schema。
- 不導入完整 ERP、完整 LMS、會計、薪資或完整退款對帳。
