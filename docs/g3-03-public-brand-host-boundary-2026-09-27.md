# G3-03／G4-03：公開頁品牌主機來源

2026-09-27；隔離候選基線 `461411f6`，本文件所述首頁／進度頁修補尚未推送或部署。staging 與正式環境沒有本批寫入。

公開 API 的 `resolvePublicClinicId(req, …)` 已明確採 `req.nextUrl.host`／`Host`，註解禁止使用用戶可偽造的 forwarded host 選租戶；但首頁 `app/page.tsx` 與公開服務進度頁 `app/q/page.tsx` 仍優先讀 `X-Forwarded-Host`。受控 SSR 測試以 `Host=reservation-system-staging-staging.up.railway.app`、`X-Forwarded-Host=attacker.example` 開啟指定品牌 slug，修補前兩頁傳入品牌解析器的主機都錯成 `attacker.example`（失敗單項 2/2）。這證明應用程式的選擇邏輯有偏差，不聲稱 Railway 公開代理一定讓外部流量設定該標頭。

本候選兩頁都只使用實際 `Host` 作品牌主機來源。失敗單項 2/2 修正後通過；連同公開 SSR 與舊進度頁相關測試合計 **46/46**，`next build`、`tsc --noEmit` 通過。起初相關舊測試有 10 項因上一提交新增的 `publicRequestOrigin()` 沒有注入模組而報錯；只補該受控測試依賴後，原失敗檔 **26/26**、四檔合計 46/46，沒有為測試改產品行為。

本批無品牌、Auth、顧客或網域測資，清理數 0。需要後續 staging 同版定向驗證首頁與服務進度入口；真正自訂網域仍須可控 DNS／TLS 與手機環境，使用者已暫緩。因此 G3-03、G4-03 及主驗收 **10/24** 都維持待驗證。
