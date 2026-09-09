# ADR-0005：LINE 原生互動優先，LIFF 承接必要表單

- 狀態：Accepted
- 日期：2026-09-09

## Context

產品入口雖從 LINE Rich Menu 開始，但過去每一格都以 URI 打開同一套顧客網站，造成操作被綁在網站導覽，也讓 LINE 官方帳號只扮演書籤。客服後台回覆亦只寫入資料庫，沒有推送回 LINE，形成介面顯示「已送出」但顧客實際收不到的斷點。

LINE webhook 可能重送同一事件；預約取消、會員綁定、客服訊息與員工打卡都是有副作用的操作，不能靠 UI 避免重複。

## Decision

1. Rich Menu 內建功能一律使用 postback，由品牌 destination 解析租戶後在 LINE 內回覆原生訊息；自訂 HTTPS 連結仍可使用 URI。
2. 預約先在 LINE 選服務與日期，活動、票券、會員、品牌資訊與客服優先直接回 LINE 卡片。只有時段、顧客必要資料、付款與報到碼等複雜或敏感步驟才開啟聚焦 LIFF。
3. 聚焦 LIFF 以 `task=1` 隱藏入口導覽，完成後以 `liff.closeWindow()` 回 LINE；瀏覽器備援仍保留完整導覽。
4. 所有 webhook 事件先以 `(clinic_id, webhookEventId)` 原子認領；完成、失敗及重試狀態留存。
5. LINE 客服狀態為短效 session；顧客訊息寫入品牌客服串，後台回覆必須呼叫 Messaging API 並記錄投遞狀態。
6. 會員綁定採 LINE 官方 Account Linking：link token 不落庫，服務只保存 10 分鐘 nonce 的 SHA-256 雜湊；accountLink webhook 在同一品牌內完成綁定。
7. 若品牌發布 `member`／`staff` Rich Menu alias，系統可依已驗證身分套用單一使用者選單；不存在時維持品牌預設選單。

## Consequences

- LINE 成為主要工作流而非網站捷徑，顧客少一次導覽與重複選擇。
- LIFF 仍負責不適合塞入聊天訊息的複雜表單，避免把 webhook 變成難以維護的完整表單引擎。
- 上線順序必須先套用資料庫 migration，再部署 webhook 程式；否則事件認領會 fail closed。
- 官方帳號、Messaging API channel、LINE Login channel 與 LIFF 仍為各品牌獨立設定，不因此共用憑證或會員資料。
