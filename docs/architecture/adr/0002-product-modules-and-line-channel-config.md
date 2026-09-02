# ADR-0002：標準模組啟用與品牌級 LINE Channel 設定

## Status

Accepted

## Context

v3 的標準功能全數可用，但目前後台把所有標準功能永久顯示；`public_booking_enabled` 與 `public_registration_enabled` 又同時被當成產品啟用與公開發布狀態。LINE webhook 已用 `clinics.line_destination` 對應品牌，LINE Login Channel 與 LIFF ID 則仍只有部署層單一環境變數，無法清楚表達共享渠道與品牌獨立渠道。

## Decision

1. 在 `clinic_settings` 增加 `events_enabled`、`memberships_enabled`、`crm_automation_enabled`、`line_channel_enabled`。這些是品牌是否使用標準模組的設定，不是收費 entitlement。
2. `public_booking_enabled`／`public_registration_enabled` 只控制顧客公開入口；模組可先啟用並完成內容設定，再公開發布。
3. 建立 `clinic_line_channels` 保存非機密的 provider、Messaging API Channel、LINE Login Channel、LIFF ID、連線模式與驗證狀態。
4. webhook destination 繼續以 `clinics.line_destination` 作為相容且唯一的品牌路由鍵，不在新表複製。
5. channel secret 與 access token 繼續只存在 server environment；資料庫不得增加 secret 欄位。
6. 單品牌 `LINE_LOGIN_CHANNEL_ID`／`NEXT_PUBLIC_LIFF_ID` 保留為相容 fallback。正式多品牌流程優先讀取品牌設定，無法對應時 fail closed。

## Consequences

- 標準功能仍全部可啟用，但未啟用模組不佔用日常導覽。
- 新品牌預設以預約核心開始；活動、會員、CRM 自動化與 LINE 渠道由啟用中心開啟。
- 舊品牌依現有公開設定與資料回填，避免升級後入口消失。
- M3 必須同時在導覽與 server guard 落實模組狀態；不能只做前端隱藏。
- M5 驗證 LIFF token 前必須先解析品牌，再使用該品牌的 Login Channel ID。

