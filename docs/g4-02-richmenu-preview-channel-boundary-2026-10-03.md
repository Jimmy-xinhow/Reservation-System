# G4-02 圖文選單預覽：品牌未接通 LINE 的邊界（2026-10-03）

狀態：本機候選；尚未推送或部署。商用主驗收維持 **17/24**，G4-02 待驗證。

## 實際觀察

- Railway production HTTP 記錄於 2026-10-02 15:08:17 UTC 有一筆已登入後台 `GET /api/admin/richmenu-image` 回 503。HTTP 記錄沒有品牌或版本參數，不能把該請求直接歸因到某個品牌。
- 正式 Supabase 唯讀交易：四個品牌有 `line_richmenu.published_id`；其中三個有 `clinics.line_destination` 且渠道驗證為 ready，另一個保留已發布紀錄但 `line_destination` 為空、驗證 pending、發布版本沒有 `image_storage_path`。沒有讀取 LINE 金鑰、顧客資料或圖片。
- 正式 Web 同時設有 LINE 目的地映射變數及舊版全域變數。舊頁在沒有品牌 destination 時仍呼叫 `lineAccessTokenForDestination(undefined)`；映射模式會拋錯並讓預覽 API 回 503，若退回舊版全域憑證則有跨品牌取圖風險。頁面卻顯示綠色「已發布」並請瀏覽器載入預覽。

## 窄修與界線

- 頁面沒有品牌 destination 就不取 token、不請求圖片，把發布紀錄標為「發布狀態待確認」，提示完成 LINE 設定及連線檢查。保留選單紀錄，不取消真正 LINE 選單。
- 直接呼叫圖片 API 時，沒有品牌 destination 先回 409，不接觸全域 LINE 憑證或圖片 API。正常有 destination 路徑保留原行為。
- 單項回歸 11/11、`npm run typecheck`、`npm run build` 通過；未做整套 release gate。沒有 DB 寫入、訊息發送或測試資料。
- 真實 OA 上的選單狀態與該品牌如何重新接通仍待品牌渠道歸屬確認；此修補不能把 G4-02 或 24 項主驗收判為完成。正式那筆 503 的品牌歸屬仍未由日誌證明。
