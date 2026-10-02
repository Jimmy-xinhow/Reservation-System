# G2-03 藍新原始回呼受控取證候選（2026-10-03）

狀態：**僅本機候選，未推送、未部署、未刷卡；G2-03／G1-04 待驗證，主表 15/24 不變。**

## 已確認的問題

- Railway production 正式 Web 實際部署 `a8d0e060`，其 TradeSha 採官方的 `HashKey={key}&{TradeInfo}&HashIV={iv}`；9/29 修補 `89247531` 已在該提交祖先中。主要工作目錄仍有舊版未提交內容，不作為正式版依據。
- [藍新測試區 MPG 2.0 官方文件](https://cwww.newebpay.com/website/Page/content/download_api) 指出未送 `EncryptType` 時為 AES-256-CBC／PKCS7。五筆信用卡交易的原始 Notify 都在驗簽後發生 CBC padding 失敗，現有日誌僅有形狀分類，沒有可獨立重播的同筆加密內容。官方查詢證明交易成功，不能替代原始 Notify 200 與冪等回呼。
- 因原始密文不存在於目前可讀紀錄，不能根據 `cbc_bad_padding` 推定 GCM、任意更換密鑰、放寬驗簽或對錯誤回呼回 200。重查同一商店頁／日誌或盲刷卡不會增加可判定證據。

## 候選行為

`lib/newebpay-forensics.ts` 預設完全關閉，且同時要求 Railway 環境名稱為 `staging`、四項專用設定齊全、隔離 QA 品牌與測試商店精確相符、實際回呼 TradeSha 正確。只有既有處理器判定 `cbc_bad_padding` 時才執行；其結果不改 HTTP 400、付款狀態或稽核。

它把外層 `MerchantID/Status/Version/EncryptType` 與原始 `TradeInfo/TradeSha` 放進程序記憶體，以一次性 AES-256-GCM 金鑰加密，再以 RSA-OAEP-SHA256 公鑰包裹該金鑰。Railway 日誌只收到雙重加密封套與固定診斷字樣，不收到明文、藍新金鑰、卡號或顧客資料。私鑰不部署到 Railway。

本機已建立 3072-bit RSA 一次性公私鑰。公鑰在 Git 忽略的 `E:\Reservation System\tmp\g203-forensic-20261003\public.spki.b64`；私鑰只以目前 Windows 使用者 DPAPI 加密存於同資料夾的 `private.pkcs8.dpapi`，未產生明文私鑰檔，DPAPI 解密／公鑰一致性已在記憶體核對。

## 部署後唯一取證窗口

1. 先取得新提交的具名公開推送授權，只推 `codex/staging-source-baseline`；三個 staging 服務同版成功後，驗正式環境沒有下列變數。
2. 只在 staging Web 設 `NEWEBPAY_FORENSIC_CLINIC_ID`、`NEWEBPAY_FORENSIC_MERCHANT_ID` 與 `NEWEBPAY_FORENSIC_PUBLIC_KEY_SPKI_B64`；準備好單筆隔離 QA 測試預約後才設 `NEWEBPAY_FORENSIC_CAPTURE=1`。公鑰不是金鑰原文，但仍不貼在對話；QA 私鑰始終只在本機。
3. 如果既有信用卡交易能由官方提供原始 Notify 重送，就用該筆；目前官方文件與商店畫面都沒有證明 CREDIT 可重送。否則需明確同意**一筆**新的藍新測試卡交易，先確保來源、時段、金額與清理程序，再由使用者完成支付，不使用真卡。
4. 取得第一筆 SHA 有效且 CBC 解碼失敗的加密封套後，立即把 staging `NEWEBPAY_FORENSIC_CAPTURE` 改回 `0`；只在本機程序記憶體解開 DPAPI 私鑰與封套，對同一原始密文核對官方 CBC 範例、外層版本與可能的傳輸編碼。僅將固定分類、雜湊及根因寫入報告，不落地或輸出明文。
5. 根因確認後只修實際失敗點，再驗原始 Notify HTTP 200、同筆重送不重複入帳，以及取消返回；按建立的 QA ID 清理未付測資，已付交易的交易／付款稽核依既定保留規則處理。若取證仍無法判定，停止新增交易並明列外部資料需求。

這份候選不會把合成加密測試、typecheck、build 或部署成功算作 G2-03／G1-04 主驗收通過。
