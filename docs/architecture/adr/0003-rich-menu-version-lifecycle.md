# ADR-0003：Rich Menu 採版本化發布生命週期

## Status

Accepted

## Context

現行 `line_richmenu` 每品牌只有一筆設定與一個 `published_id`。已發布品牌儲存動作設定時會立即重建線上選單，無法安全預覽、驗證或回復；圖片及 LINE 驗證錯誤也沒有可追溯版本。

## Decision

1. 保留 `line_richmenu` 作為相容的品牌指標列，新增草稿版與正式版指標。
2. 新增 `line_richmenu_versions` 保存不可覆寫的版本編號、模板、版型、按鈕、圖片中繼資料、驗證錯誤與 LINE Rich Menu ID。
3. 新增 `line_richmenu_publication_events` 保存驗證、發布、失敗、回復及移除事件。
4. 草稿保存不呼叫 LINE；只有通過 server 驗證的版本可進入發布流程。
5. LINE 發布失敗時保留目前正式版；成功後才在同一資料庫 transaction 切換正式指標並封存舊版。
6. 圖片由 server 驗證 MIME、檔案大小與精確尺寸後上傳 LINE；版本保存 sha256、尺寸與 LINE Rich Menu ID，預覽經品牌授權 server route 讀取，不保存任意外部 secret URL。
7. Alias 以品牌範圍資料列保存，`(clinic_id, version_id)` 使用複合外鍵，並以 `(channel_destination, alias_id)` 保證共享 LINE channel 的名稱不互撞；既有遠端 Alias 若沒有本品牌所有權紀錄，禁止接管。LINE Alias 同步失敗不更新本機，資料庫寫入失敗則補償還原遠端狀態。
8. 顯示期間以 `timestamptz` 保存、後台以 `Asia/Taipei` 輸入；Cron 先原子 claim、執行 LINE 切換，再以 success／failure RPC 完成，最多重試 5 次並避免覆蓋後續人工發布。
9. 成效檢視按需讀取 LINE 官方 Rich Menu Insights；平台只在 `funnel_events` 保存匿名版本與格號，不加入姓名、電話、patient ID 或 LINE user ID。

## Consequences

- 管理者可預覽、比較及回復，而不會因儲存草稿改變線上選單。
- 每品牌同一時間最多一個 `published` 版本。
- M4 server action 必須使用版本 RPC 與事件紀錄，不再直接覆寫 `line_richmenu.slots` 後自動發布。
- 舊 `published_id` 在遷移期間保留；完成 M4 後只作相容讀取。
- Alias 只能綁定同一 LINE channel 內已建立的 Rich Menu；新頁籤需先取得可用的 LINE Rich Menu ID。
- LINE Insights 未達官方隱私門檻時不會有統計明細，後台必須顯示受抑制狀態，不能推算或補造數字。
