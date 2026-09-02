# ADR-0004：預約候補使用獨立狀態機與容量保留預約

## Status

Accepted

## Context

v3 要求時間制與場次制預約都有候補、遞補、通知及追蹤。目前 `waitlist_entries` 只屬活動報名；直接共用會混淆 event session 與 appointment slot 的容量鎖、狀態與通知。`appointments.status` 又被 v3 限定為 `booked / confirmed / cancelled / done / no_show`，不能增加不相容的 `held` 狀態。

## Decision

1. 建立 `appointment_waitlist_entries`、事件與通知紀錄，和活動候補完全分離。
2. 每筆候補保存時間制／場次制、服務、人員、場次、日期／時間、首次／再次、必要答案快照與穩定 `target_key`。
3. 候補順位與遞補使用 `clinic_id + target_key` advisory lock。
4. 遞補時在同一交易內呼叫既有 booking RPC 建立 `booked` 預約，該預約立即佔用容量，並由候補列保存 `offer_expires_at`。
5. 顧客接受後將候補列改為 `booked`；未接受或取消時，原子取消保留預約並遞補下一位。
6. 不在候補階段預扣套票或優惠；顧客接受後再依既有付款／會員規則處理，避免長時間保留或錯誤扣抵。
7. 所有顧客操作只能由已驗證 LINE／瀏覽器身分呼叫 server route；資料庫 RPC 只授權 service role。

## Consequences

- 預約與活動候補的容量鎖、狀態及報表可分別驗收。
- 系統不需擴張 appointment status enum，也不會出現已通知但容量未保留的競爭窗口。
- M3 需提供後台候補工作區；M5 需提供顧客加入、接受與取消入口；M6 需執行逾期與通知 worker。
- 正式完成前必須以兩連線競爭測試證明同一空缺只會遞補一人。

