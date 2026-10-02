# G4-02 正式站圖文選單錯誤綠燈重現（2026-10-03）

狀態：正式環境唯讀重現；本機候選 `bfd269fc5ea7b00e0388bd568daf9e02b8985b2d` 尚未推送或部署。主驗收 17/24，G4-02 待驗證。

- 2026-10-02 20:53 UTC，以既有品牌管理者 Chrome 工作階段開啟正式站 `https://www.laihowke.com/admin/richmenu`，目前品牌為「高雄慈愛中醫」。頁面同時顯示品牌訊息授權／正式連線檢查未完成，以及線上版本「已發布」。
- 目前已發布的 LINE 圖文選單預覽 `<img>` 載入完成但 `naturalWidth=0`，其來源路徑是 `/api/admin/richmenu-image`。
- 對同頁做一次受控重新載入並監看瀏覽器 Network：相同路徑的已登入 GET 回 **HTTP 503**；重新載入後預覽仍為破圖。沒有讀取或保存回應本文、LINE 憑證、顧客資料或完整頁面。
- 這將先前無品牌識別的 Railway 503 日誌，補成同一品牌登入畫面上的直接重現；並與正式 Supabase 唯讀狀態相符：該品牌有舊 `published_id`，但沒有 `line_destination`，渠道驗證 pending，版本無 `image_storage_path`。

候選修補把缺少品牌目的地的舊發布紀錄顯示為「發布狀態待確認」，不載入預覽或顯示不能安全執行的取消發布按鈕；直接圖片 API 回 409 且不取全域 LINE token。共用圖文選單動作入口也先要求品牌 destination，再允許取 token，避免舊版全域 fallback 作用於取消、回復、發布或排程。即使同版 staging 回測通過，品牌 OA 的長期歸屬與自助發布仍須另驗，不能據此簽 G4-02。

定向圖文選單測試 12/12、契約、typecheck 與 Next build 通過；僅為本機候選，尚未取得 staging 同版證據。
