# SaaS 總後台操作與部署規範

## 權限邊界

`platform_admins` 是平台級權限表，RLS 開啟且不提供 `anon` 或一般 `authenticated` policy。平台總後台所有跨品牌讀寫都由 server-only service role 執行；品牌成員仍只透過 `clinic_members` 讀寫自己的品牌資料。

## 系統總控台與品牌後台邊界

系統管理者使用獨立的 XINHOW PLATFORM 系統總控台：

- `/admin/platform`：系統總覽、品牌租戶、開通交付與方案狀態。
- `/admin/platform/admins`：系統管理者管理其他系統管理者，或新增系統員工並逐項配置權限；品牌人員不在此管理。
- `/admin/platform/operations`：平台營運健康、通知失敗、金流回呼與 server-only 部署能力狀態。
- `/admin/platform/reports`：跨品牌聚合使用量；只顯示數字，不開放跨品牌顧客明細。
- `/admin/platform/audit`：跨品牌預約、報名與付款狀態異動稽核。
- `/admin/platform/settings`：系統層級規則與部署能力說明。
- `/admin` 及 `/admin/settings`：目前品牌的日常營運與品牌設定，不屬於系統總控台。

同一登入帳號即使同時擁有系統與品牌權限，進入 `/admin/platform` 時也必須看到系統外框與系統選單；只有返回 `/admin` 後才切換為品牌後台。

產品管理身份只有兩種：

- 系統管理者：管理整個 SaaS 與系統人員權限。
- 品牌管理者：管理已授權品牌與品牌人員權限。

系統員工與品牌員工是權限接受者，不是第三種管理身份。員工只能使用管理者勾選的工作權限，不能管理人員、替自己加權限或提升自己為管理者。舊版 `owner / admin / staff / provider` 僅作資料庫與 RLS 相容映射，不再顯示為產品角色。

## 品牌開通流程

系統管理者與品牌管理者是兩個不同層級，請依以下順序操作：

1. 系統管理者進入 `/admin/platform`，建立品牌並填入品牌管理者 Email。
2. 系統建立品牌、預設設定與品牌管理者權限；新帳號會收到 Supabase 登入邀請。
3. 將 `/admin/login` 交給品牌管理者，由品牌管理者完成登入。
4. 品牌管理者進入自己的 `/admin`，依序完成品牌公開資訊、服務與服務排程；若需要活動，再建立活動、場次與票種。
5. 系統管理者回到「XINHOW PLATFORM → 品牌租戶」查看開通檢查；品牌資料與其他品牌維持隔離。

品牌後台的「新增品牌」只適合同一登入帳號管理多個品牌；替其他使用者開通品牌，必須使用平台總管理流程。

## 首次啟用

1. 先套用 `supabase/migration_saas_platform.sql` 與 `supabase/migration_saas_core_gaps.sql`。
2. 在 Supabase Auth 建立或確認系統管理者帳號。
3. 以 SQL Editor 執行：

```sql
insert into public.platform_admins (user_id, role, access_type, permissions)
values ('<auth_user_id>', 'owner', 'system_admin', '{}')
on conflict (user_id) do update
set role = excluded.role,
    access_type = excluded.access_type,
    permissions = excluded.permissions,
    active = true;
```

4. 重新登入後，左側選單會出現「XINHOW PLATFORM」系統管理群組；品牌後台功能不會混入系統頁面。

也可在 Railway server environment 設定 `PLATFORM_ADMIN_USER_IDS`（逗號分隔 UUID）作為緊急 bootstrap；不可使用 `NEXT_PUBLIC_` 前綴。

## 品牌建立

系統管理者輸入品牌名稱、品牌代號與品牌管理者 Email。若 Email 尚未有 Supabase Auth 使用者，系統會寄出邀請；資料庫交易會同時建立品牌預設設定、方案權限與品牌管理者成員。

## 方案與加購

標準方案與七項加購權限只記錄在 `brand_entitlements.feature_flags`，不會自動新增功能或變更合約。七項加購為：指定金流串接、退款與對帳、外部行事曆同步、外部 API／資料交換、進階白牌入口、多語系介面、產業客製模組。

金流交易驗證與正式網域 DNS 驗證目前依專案決策暫緩，不作為程式部署阻塞條件。
