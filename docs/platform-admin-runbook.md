# SaaS 總後台操作與部署規範

## 權限邊界

`platform_admins` 是平台級權限表，RLS 開啟且不提供 `anon` 或一般 `authenticated` policy。平台總後台所有跨品牌讀寫都由 server-only service role 執行；品牌成員仍只透過 `clinic_members` 讀寫自己的品牌資料。

## 首次啟用

1. 先套用 `supabase/migration_saas_platform.sql` 與 `supabase/migration_saas_core_gaps.sql`。
2. 在 Supabase Auth 建立或確認平台管理員帳號。
3. 以 SQL Editor 執行：

```sql
insert into public.platform_admins (user_id, role)
values ('<auth_user_id>', 'owner')
on conflict (user_id) do update set role = excluded.role, active = true;
```

4. 重新登入後，左側選單會出現「SaaS 平台 → 品牌總管理」。

也可在 Railway server environment 設定 `PLATFORM_ADMIN_USER_IDS`（逗號分隔 UUID）作為緊急 bootstrap；不可使用 `NEXT_PUBLIC_` 前綴。

## 品牌建立

平台管理員輸入品牌名稱、品牌代號與負責人 Email。若 Email 尚未有 Supabase Auth 使用者，系統會寄出邀請；資料庫交易會同時建立品牌預設設定、方案權限與 owner 成員。

## 方案與加購

標準方案與七項加購權限只記錄在 `brand_entitlements.feature_flags`，不會自動新增功能或變更合約。七項加購為：指定金流串接、退款與對帳、外部行事曆同步、外部 API／資料交換、進階白牌入口、多語系介面、產業客製模組。

金流交易驗證與正式網域 DNS 驗證目前依專案決策暫緩，不作為程式部署阻塞條件。

