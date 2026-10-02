# G3-03／G4-02：帶權連結與渠道設定網址來源

2026-09-27；隔離候選基線 `e495abe3`，本文件所述修補尚未推送或部署。正式環境未改動。

`/admin/documents` 原本直接用 `X-Forwarded-Host` 和 `X-Forwarded-Proto` 組合一次性文件簽署 URL；`/admin/line` 也用同一方式顯示供店家複製的 Webhook／LIFF Endpoint。受控 SSR 測試在已登入頁面提供 `APP_URL=https://trusted.example`、`X-Forwarded-Host=attacker.example`，修補前文件頁實際輸出 `https://attacker.example/sign/canary-token`，且沒有固定公開網址時仍輸出該可疑連結。這證明程式會採用該標頭；目前沒有聲稱 Railway 公開代理允許外部客戶任意指定此標頭。

本候選改用既有 `publicRequestOrigin()`，只從部署設定取得對外來源；正式環境缺少有效公開來源時拒絕產生簽署連結。LINE 設定頁同樣改用該來源，避免複製錯誤的渠道網址。唯讀核對 Railway staging Web 已設定 `APP_URL=https://reservation-system-staging-staging.up.railway.app`，所以目前部署具備修補所需設定。

定向 SSR 3/3：偽造轉發主機時文件 token URL 只指向設定的公開網址；正式模式沒有公開網址時封閉失敗；LINE 頁 Webhook 與 LIFF Endpoint 都只顯示設定的公開網址。`next build`、`tsc --noEmit` 通過。沒有建立品牌、顧客、文件、LINE 訊息或 Auth 測資，故本批清理數為 0。

這是本機受控的來源修補，**不是公開 staging 同版真瀏覽器證據，也不使 G3-03／G4-02 整項或 10/24 主驗收分子增加**。推送／部署後只需定向回測這兩頁，不因本文改動重跑七項或整套 release gate。
