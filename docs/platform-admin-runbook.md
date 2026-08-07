# SaaS 總後台操作與部署規範

## 權限邊界

`platform_admins` 是平台級權限表，RLS 開啟且不提供 `anon` 或一般 `authenticated` policy。平台總後台所有跨品牌讀寫都由 server-only service role 執行；品牌成員仍只透過 `clinic_members` 讀寫自己的品牌資料。

## 平台控制台與品牌後台邊界

平台管理員使用獨立的 XINHOW PLATFORM 系統擁有者控制台：

- `/admin/platform`：平台總覽、品牌租戶、開通交付與方案狀態。
- `/admin/platform/admins`：平台 owner 管理平台 owner／admin 帳號；品牌成員不在此管理。
- `/admin/platform/operations`：平台營運健康、通知失敗、金流回呼與 server-only 部署能力狀態。
- `/admin/platform/reports`：跨品牌聚合使用量；只顯示數字，不開放跨品牌顧客明細。
- `/admin/platform/audit`：跨品牌預約、報名與付款狀態異動稽核。
- `/admin/platform/settings`：平台層級規則與部署能力說明。
- `/admin` 及 `/admin/settings`：目前品牌的日常營運與品牌設定，不屬於平台控制台。

同一登入帳號即使同時擁有平台與品牌權限，進入 `/admin/platform` 時也必須看到平台外框與平台選單；只有返回 `/admin` 後才切換為品牌後台。

## 品牌開通流程

平台管理員與品牌負責人是兩個不同角色，請依以下順序操作：

1. 平台管理員進入 `/admin/platform`，建立品牌並填入品牌負責人 Email。
2. 系統建立品牌、預設設定與 owner 權限；新帳號會收到 Supabase 登入邀請。
3. 將 `/admin/login` 交給品牌負責人，由負責人完成登入。
4. 品牌負責人進入自己的 `/admin`，依序完成品牌公開資訊、服務與服務排程；若需要活動，再建立活動、場次與票種。
5. 平台管理員回到「XINHOW PLATFORM → 品牌租戶」查看開通檢查；品牌資料與其他品牌維持隔離。

品牌後台的「新增品牌」只適合同一登入帳號管理多個品牌；替其他使用者開通品牌，必須使用平台總管理流程。

## 首次啟用

1. 先套用 `supabase/migration_saas_platform.sql` 與 `supabase/migration_saas_core_gaps.sql`。
2. 在 Supabase Auth 建立或確認平台管理員帳號。
3. 以 SQL Editor 執行：

```sql
insert into public.platform_admins (user_id, role)
values ('<auth_user_id>', 'owner')
on conflict (user_id) do update set role = excluded.role, active = true;
```

4. 重新登入後，左側選單會出現「XINHOW PLATFORM」平台營運群組；品牌後台功能不會混入平台頁面。

也可在 Railway server environment 設定 `PLATFORM_ADMIN_USER_IDS`（逗號分隔 UUID）作為緊急 bootstrap；不可使用 `NEXT_PUBLIC_` 前綴。

## 品牌建立

平台管理員輸入品牌名稱、品牌代號與負責人 Email。若 Email 尚未有 Supabase Auth 使用者，系統會寄出邀請；資料庫交易會同時建立品牌預設設定、方案權限與 owner 成員。

## 方案與加購

標準方案與七項加購權限只記錄在 `brand_entitlements.feature_flags`，不會自動新增功能或變更合約。七項加購為：指定金流串接、退款與對帳、外部行事曆同步、外部 API／資料交換、進階白牌入口、多語系介面、產業客製模組。

金流交易驗證與正式網域 DNS 驗證目前依專案決策暫緩，不作為程式部署阻塞條件。
