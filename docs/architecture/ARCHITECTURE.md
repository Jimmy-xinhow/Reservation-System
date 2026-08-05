# 預約與報名 SaaS 平台架構

本文件對應 `clinic-booking-spec-v3.md`，描述目前程式庫的目標架構與資料責任。產品保留 `clinic_id` 作為相容租戶鍵，產品語意稱為品牌／租戶。

## Context

```mermaid
flowchart LR
  Customer[顧客：LINE LIFF／瀏覽器／嵌入元件] --> Web[Next.js App Router]
  Staff[品牌成員：後台] --> Web
  Web --> DB[(Supabase Postgres + RLS)]
  Web --> Auth[Supabase Auth]
  Web --> Line[LINE Messaging API]
  Web --> Pay[綠界／藍新]
  Web --> Email[Email Provider]
  Cron[Vercel Cron／排程] --> Web
```

## Containers and ownership

| 元件 | 責任 | 不負責 |
|---|---|---|
| 顧客端頁面 | 表單、選擇、狀態顯示、最小資料回傳 | 直接連 Supabase、決定租戶權限 |
| 後台頁面／Server Actions | 成員操作、設定、預約／報名／CRM 管理 | 取代 RLS 或把密鑰送到瀏覽器 |
| API routes | 顧客端寫入、外部 webhook、身份驗證、租戶邊界 | 由 query string 直接信任 `clinic_id` |
| Supabase DB／RPC | 原子名額、狀態機、RLS、冪等、資料保存 | 發送外部訊息 |
| Cron | 提醒、CRM 自動化投遞 | 無租戶範圍地掃描全庫 |
| LINE／金流／Email adapter | 對外請求、回呼驗證、錯誤轉換 | 修改未授權租戶資料 |

## Data boundaries

- 所有業務表帶 `clinic_id`。
- 預約、報名、付款、CRM 投遞與報到分屬不同資料域，不把報名硬塞到 `appointments`。
- 外部回呼先以外部事件識別做冪等，再更新內部狀態。
- 取消／停用保留歷史；不得以 hard delete 取代狀態異動。

## Request flows

### 顧客預約／報名

1. 顧客從 LIFF、瀏覽器或嵌入入口取得公開品牌／活動資料。
2. API 以活動／品牌資料庫關聯決定實際 `clinic_id`，不採信任意前端租戶欄位。
3. LINE 身分以 ID token 驗證；非 LINE 流程使用必要的顧客資料與一次性 token。
4. API 呼叫受保護的 SQL transaction／RPC 完成名額與狀態變更。
5. 回傳最小必要結果；付款、通知與報到憑證使用不可猜測識別。

### 後台

1. Supabase Auth 取得 session。
2. `clinic_members` 決定可用品牌與角色；active brand context 必須被 server 驗證。
3. Server Component／Server Action 使用 authenticated client 走 RLS；需要跨表整合時仍必須顯式帶 `clinic_id`。

### 外部回呼

1. 驗證 LINE／金流簽章與必要欄位。
2. 以外部 event id 或訂單號建立冪等紀錄。
3. 只在事件屬於正確品牌且狀態轉移合法時更新資料。
4. 失敗寫入可查詢的錯誤紀錄，回傳外部服務可接受的結果，不讓整批排程中斷。

## Non-functional targets

- RLS、跨品牌拒絕、service-role 不出現在 client 是 P0 安全門檻。
- 預約／報名最後一個名額不得超賣；同一回呼重送不得重複付款確認或通知。
- 顧客端手機優先；表單與互動控制項至少 44px 觸控區域。
- 預設時區 `Asia/Taipei`；資料庫使用 `timestamptz`。
- build、typecheck、migration replay、核心 API smoke path 與 Playwright UI path 必須通過後才能宣稱完成。

