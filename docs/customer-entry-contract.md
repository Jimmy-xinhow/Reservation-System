# 統一顧客入口與深連結契約

更新日期：2026-09-02
適用版本：產品重整 M2 起；2026-09 顧客中心整合

## 目的

所有 LINE Rich Menu、歡迎訊息、通知及品牌網站入口，必須使用同一組品牌深連結語意。入口只描述顧客要完成的任務，不直接耦合後台頁面或資料表名稱。

## 標準入口

| key | 顧客名稱 | LIFF view | 瀏覽器備援 | 啟用條件 |
|---|---|---|---|---|
| `home` | 服務首頁 | `home` | `/` | 永遠可用 |
| `booking` | 立即預約 | `booking` | `/book/browser` | `public_booking_enabled` |
| `appointments` | 我的預約 | `appointments` | `/my` | 預約模組可用 |
| `events` | 活動／課程 | `events` | `/register` | `events_enabled` 且 `public_registration_enabled` |
| `tickets` | 我的票券 | `tickets` | `/my` | `events_enabled` |
| `membership` | 會員／套票 | `membership` | `/membership` | `memberships_enabled` |
| `support` | LINE 客服 | `support` | `/`（品牌聯絡資訊） | `line_channel_enabled` |
| `brand` | 品牌資訊 | `brand` | `/` | 永遠可用 |

LIFF URL 固定為 `https://liff.line.me/{brand_liff_id}?clinic_slug={slug}&view={view}`。一般瀏覽器 URL 以品牌公開 origin 加上備援路徑及 `clinic_slug`。若品牌採獨立渠道，禁止回退其他品牌或全域 LIFF ID。

程式中的唯一來源是 `lib/customer-entry.ts`；Rich Menu、webhook 與顧客中心不得各自維護另一份路徑表。

## 身分與租戶規則

1. URL 的 `clinic_slug` 只用於解析公開品牌，不代表已授權。
2. LIFF ID token 必須用該品牌解析出的 LINE Login Channel ID 向 LINE 驗證。
3. 驗證後的 `sub` 仍須在 `clinic_id` 範圍內尋找顧客，不可跨品牌共用查詢結果。
4. 瀏覽器備援 token 必須包含並比對 `clinicId`。
5. 未啟用領域不產生按鈕；直接存取時 server route 仍須拒絕。

## 狀態與相容界線

- M2 已完成入口 key、品牌參數、LIFF view、瀏覽器備援及模組條件契約。
- M5 已由 `/book` 統一解讀八個 `view`；現有 `tab=my`／`tab=chat` 仍保留相容。
- 2026-09 起，未指定 `view` 時先顯示服務首頁，集中呈現目前已啟用的預約、活動、票券、會員、客服與品牌捷徑；停用的模組不會出現在首頁或導覽列。
- 活動 LIFF 報名會把品牌驗證後的 ID token 送到 server；票券與會員依該 LINE 身分下的已綁定顧客切換，不跨品牌共用。
- 暫停新增預約不會隱藏「我的預約」；暫停公開活動列表不會隱藏既有票券。
- Rich Menu 只有在目標 view、模組狀態、圖片與 LINE 渠道驗證全部通過後才可發布。
- `legacy_progress_enabled=false` 時，入口集合永遠不包含舊版服務進度。
