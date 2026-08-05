# ADR-0001：保留 `clinic_id` 作為 SaaS 租戶鍵

## Status

Accepted

## Context

現有預約、提醒、LINE 與 RLS schema 已以 `clinic_id` 建模。產品方向已確認要支援多品牌 SaaS，但直接把欄位改名成 `tenant_id` 會同時影響既有資料、RPC、policy、API 與部署流程。

## Decision

v3 保留 `clinic_id` 作為資料庫相容租戶鍵，產品與文件使用「品牌／租戶」語意。新增功能一律帶 `clinic_id`，後台以 `clinic_members` 與 active brand context 決定可用範圍；`NEXT_PUBLIC_CLINIC_ID` 只作為單品牌相容 fallback，不作為 SaaS 隔離機制。

## Consequences

- 可保留既有資料與預約流程，採增量 migration。
- 未來若要改名，可先建立 adapter／view，再分階段遷移，不阻擋目前開發。
- 所有新 API 與報表必須避免把欄位名稱誤解成「只能有診所」；租戶隔離測試需覆蓋多品牌。

