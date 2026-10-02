# G2-03 藍新測試區原始 Notify 取證（2026-10-03）

主驗收仍為 **15/24**；G2-03 與 G1-04 均為待驗證。本頁記錄一筆使用者親自完成的藍新測試卡付款，以及同筆三次原始 Notify。付款結果成功不代表 Notify 已通過。

- 環境：Railway staging Web `46d13e4d6e6b8a67494d786bfb1bd525d0baa478`；隔離品牌 `qa-line-openroom-20260929`、藍新測試商店 `MS357444779`。正式站與正式資料庫未改。
- 使用者以藍新測試卡完成唯一一筆 NT$100 交易。商店單 `APTMURAQB4T9BEB0ACE`，站內付款單 `4f8bb26d-d8f2-4d87-ba10-c239fe32f531`、預約 `16e74caa-9338-475d-8543-f3d591b2afea`。站內後來是 paid／confirmed，唯一已處理回呼事件來源為 `QUERY_RECONCILE`；這是 Return 的官方查詢補正，不能當作原始 Notify 入帳證據。
- staging Web 同一筆原始 Notify 連續收到 3 次，均 HTTP 400。一次性公鑰取證僅加密記錄並在本機記憶體解密；三次 `TradeInfo` 完全相同，SHA-256 摘要 `38f1d614e70662c425309b2b29e677b8d3cb06db9b2e6683dce8d3aeeb6756`，密文 512 bytes。外層 `Version=2.0`，沒有 `EncryptType`。用 staging Vault 的 32／16-byte 金鑰驗 `TradeSha` 成功；AES-256-CBC 原文前段為合法 JSON，含相符商店、商店單與 NT$100，但末尾 PKCS7 檢查失敗。獨立 Python 解密也得到相同結果：JSON 後有 30 bytes，前 14 bytes 均為 `0x1e`，最後一塊不是合法 PKCS7。
- [藍新官方 MPG v2.0 手冊](https://cwww.newebpay.com/website/Page/download_file?name=Online+Payment-Foreground+Scenario+API+Specification_NDNF-1.0.8.pdf) 指定缺省 `EncryptType` 為 AES/CBC/PKCS7。實收的簽章內容與此格式不一致；現有證據只能證明格式不符，不能推定是哪一端產生尾段。
- 本機候選僅在 **test** 商店、`Version=2.0`、缺省／0 加密模式、TradeSha 已通過且標準解密發生 `ERR_OSSL_BAD_DECRYPT` 時，嘗試辨識 17–32 bytes 的此類尾段；只接受嚴格 UTF-8、完整 JSON 與結構化結果。production 仍要求標準 PKCS7。實收加密回呼在本機經候選程式驗簽、解出正確訂單與金額；定向付款測試 23/23、typecheck、contracts、build 通過。尚未推送或 staging 部署，不能說 Notify 已修復。
- 擷取旗標已關閉，staging Web 還原部署 `cbfacad8-bd2d-4f38-8883-c8d5a39aafb0` SUCCESS 且唯一 active，隔離品牌訂金已恢復 `false／0／self_pay`。第一次表單逾時、未輸卡的合成測資已按 ID 清零。本筆 **已付款**預約、付款單與稽核依法保留；合成顧客沒有 Email／LINE 收件地址，不做刪除或補寄。

下一步只需在部署候選後，對**同一份藍新已簽章原始回呼**做 staging 200／重送冪等與資料庫狀態不變的定向驗證；若官方不再重試，新卡交易仍須獨立授權。藍新取消返回與其他主驗收條件仍獨立待驗，不能以此局部修補提升 15/24。
