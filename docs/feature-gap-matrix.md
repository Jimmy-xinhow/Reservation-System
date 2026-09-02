# xinhow Booking SaaS 功能落差矩陣

更新日期：2026-08-13

本表以 `C:\Users\User\Downloads\xinhow-booking-saas-service-brief.html` 的 70 項標準功能、目前程式碼與 `clinic-booking-spec-v3.md` 對照。狀態只代表目前可從 repo 驗證到的程度；外部帳號、金流商店號、LINE／Email 憑證與網域 DNS 不在程式碼內，另列為「外部待驗收」，不宣稱已完成。

狀態定義：

- **已實作**：repo 中已有完整主要流程，可進入驗收。
- **部分**：已有資料或流程，但缺少簡報要求的完整管理能力、頁面、欄位或驗收狀態。
- **未完成**：目前沒有足夠的可操作實作。
- **外部待驗收**：程式已具備，但需要正式第三方設定或真實資料才能驗證。

## 2026-08-13 產品重整校正

原表主要核對 70 項簡報功能是否已有程式入口，不能證明平台資訊架構、模組啟用與 Rich Menu 生命週期已完成。本次以 `docs/product-restructure-baseline.md` 與 `docs/product-information-architecture.md` 補上產品層基線，並修正以下判定：

| v3／本次目標要求 | 校正後狀態 | 缺口 |
|---|---|---|
| 時間制／場次制預約候補 | Staging PASS | 已具獨立資料表、額滿目標查詢、原子加入／遞補／接受／取消／逾時、顧客 LIFF 與瀏覽器操作、後台追蹤，以及 LINE／Email 原子 claim、重試與去重 worker；linked staging 已完成 migration、競態與通知生命週期驗收。 |
| 六個工作區與設定中心 | 已實作 | 後台導覽已依工作流程收斂，並依品牌模組啟用狀態與成員角色顯示或阻擋功能。 |
| 權限首頁 | Staging PASS | 產品身份只有系統管理者與品牌管理者；兩層管理者可新增員工並授予工作權限，staging 已驗證導覽、直接網址、server action 與 RLS。 |
| 七步品牌啟用中心 | 已實作 | 品牌、服務、排程、入口、訊息、收款與上線檢查已納入後台啟用流程；第 7 步只會顯示待驗收，不會因設定齊全就誤標完成。 |
| 多品牌 LINE／LIFF | 程式完成／外部待驗收 | destination、LINE Login Channel、LIFF ID 與 endpoint 可由品牌後台保存；secret／access token 維持 server-only mapping。後台可驗證 Bot 身分、destination 與 webhook 後寫回 ready／error；正式品牌 channel、手機 LIFF 與實際訊息仍待驗收。 |
| Rich Menu 發布生命週期與第二批優化 | 程式與 staging DB 完成／外部待驗收 | 已具草稿、版本、模板、實圖熱區疊合、逐格瀏覽器／LIFF 連結測試、圖片與 action 驗證、發布、下架、回復、完整 label、品牌深連結及失敗補償；另完成 Alias、台北時間排程、版本複製／比較與 Insights。正式 channel 正向流程仍待驗收。 |
| 統一 LIFF 顧客中心 | 已實作 | `/book` 已用單一品牌 LIFF 與 `view` 契約提供預約、紀錄、活動、票券、會員、客服、品牌七個任務，並支援同一 LINE 身分切換連結顧客。 |

## 一、預約功能（16）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 服務項目建立與分類 | 已實作 | `/admin/services` 可建立、分類、編輯、啟停服務。 |
| 2 | 服務人員、場地、設備資源設定 | 已實作 | `/admin/resources` 可管理資源、綁定服務，時間制／號次制預約會檢查資源容量。 |
| 3 | 每週營業時段設定 | 已實作 | `schedule_templates` 支援同一人同一週日多段時段。 |
| 4 | 例外日期與休假設定 | 已實作 | `schedule_exceptions` 與後台頁面已存在。 |
| 5 | 時間制預約 | 已實作 | booking mode `time`、空檔與原子訂位流程已存在。 |
| 6 | 號次制預約 | 已實作 | booking mode `number`、`serving_numbers` 與 queue 流程已存在。 |
| 7 | 服務時長與緩衝時間 | 已實作 | `services.duration_minutes`／`buffer_minutes` 已接入可用時段、時間制與號次制預約。 |
| 8 | 同時段容量上限 | 已實作 | 模板容量與原子化 RPC 已存在。 |
| 9 | 最短前置預約時間 | 已實作 | `clinic_settings.min_lead_minutes` 已接入。 |
| 10 | 最長可預約天數 | 已實作 | `clinic_settings.max_advance_days` 已接入。 |
| 11 | 顧客自助取消 | 已實作 | public cancel route 與歷史保留流程已存在。 |
| 12 | 顧客自助改期 | 已實作 | public reschedule 流程已存在。 |
| 13 | 取消與改期規則設定 | 已實作 | 品牌設定頁可管理取消／改期提前分鐘數，公開 API 會強制檢查。 |
| 14 | 後台日曆檢視 | **本次完成** | 原 `/admin` 是列表；新增 `/admin/calendar` 工程後台日曆。 |
| 15 | 預約列表與條件搜尋 | 已實作 | `/admin` 支援日期、人員、狀態篩選。 |
| 16 | 報到、完成、未到狀態管理 | 已實作 | 後台 status actions 與 queue 流程已存在。 |

## 二、活動／課程報名（17）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 活動與課程建立 | 已實作 | `/admin/events`。 |
| 2 | 梯次與場次管理 | 已實作 | `event_sessions` 與後台表單。 |
| 3 | 公開或私密報名頁 | 已實作 | public／private access mode 與 private token。 |
| 4 | 報名截止時間設定 | 已實作 | event open／close 欄位與公開頁檢查。 |
| 5 | 自訂表單欄位 | 已實作 | `registration_forms`／`registration_form_fields`。 |
| 6 | 必填欄位設定 | 已實作 | form field `required`。 |
| 7 | 同意條款版本留存 | 已實作 | 活動條款文字、版本、同意時間已在原子報名交易中留存。 |
| 8 | 多票種（免費與付費） | 已實作 | `event_ticket_types` 與報名流程。 |
| 9 | 售票期間與票種庫存 | 已實作 | 後台可設定每一票種售票期間，公開報名會拒絕期間外票種。 |
| 10 | 名額上限 | 已實作 | session／ticket capacity。 |
| 11 | 候補名單 | 已實作 | waitlist status 與容量流程。 |
| 12 | 候補轉正與自動通知 | 已實作 | promotion 與 registration notification 流程已存在。 |
| 13 | 個人報名查詢頁 | 已實作 | `/register/my` 以報名編號／電話查詢，回傳租戶範圍內的多筆報名摘要。 |
| 14 | 專屬報到 QR code | 已實作 | registration token hash／encrypted token 與 QR 入口。 |
| 15 | QR 掃描報到 | 已實作 | `/admin/checkin` 與 checkin RPC。 |
| 16 | 姓名搜尋手動報到 | **本次完成** | 報到頁增加姓名／電話／報名編號搜尋與操作入口。 |
| 17 | 即時報到名單與名單匯出 | 已實作 | `/admin/checkin` 每 10 秒更新當日名單，保留 QR／姓名搜尋與 CSV 匯出。 |

## 三、會員、CRM Lite 與規則式行銷（8）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 會員制度與登入專區 | 已實作 | `/membership` 以顧客身分查詢會員與套票，使用獨立瀏覽器 token。 |
| 2 | 會員等級與專屬價格 | 已實作 | `/admin/membership-levels` 管理等級、顧客指派與方案專屬價格規則。 |
| 3 | 套票與堂數包販售 | 外部待驗收 | `/membership` 可列出方案並建立付款訂單；付款成功由 webhook 冪等發放套票，正式金流交易仍待外部驗收。 |
| 4 | 點數餘額與扣點紀錄 | 已實作 | membership ledger 與預約扣點流程已存在。 |
| 5 | 預約時自動扣除堂數 | 已實作 | booking／membership consumption 流程已存在。 |
| 6 | 餘額不足與效期到期提醒 | 已實作 | `/api/cron/membership` 依門檻發送 LINE／Email，通知 log 具唯一視窗去重。 |
| 7 | 優惠碼與禮券 | 已實作 | `/admin/memberships` 可建立優惠碼或單次禮券、記錄發放對象、啟停與核銷狀態；共用核銷與付款失敗釋放流程。 |
| 8 | 回購回訪分眾、CRM Lite、規則式行銷 | 已實作 | `/admin/crm`、segments、automations、LINE／Email delivery log 已存在；第三方投遞仍需外部憑證驗收。 |

## 四、金流（5）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 綠界、藍新標準串接 | 外部待驗收 | provider adapter／設定頁已有；正式商店號與憑證尚未在 repo 內，不能視為正式交易完成。 |
| 2 | 線上收款與訂金設定 | 外部待驗收 | 訂金、付款設定、公開付款頁與內部狀態生命週期已完成；正式第三方交易需測試商店驗收。 |
| 3 | 付款完成自動確認預約或報名 | 已實作 | payment webhook／status flow 已存在，需正式交易測試。 |
| 4 | 未付款自動釋放名額 | Staging PASS | 預約與報名的逾時取消、名額／優惠／套票釋放及重送冪等均已以 staging 資料驗證。 |
| 5 | 收款紀錄與訂單對照 | 已實作 | payment transaction／registration order 對照資料已存在。 |

## 五、訊息與入口（9）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | LINE 身分驗證 | 程式完成／外部待驗收 | LIFF ID token 一律由 server 依品牌 LINE Login Channel 驗證；正式 LIFF／LINE channel 憑證與真實裝置流程尚待驗收。 |
| 2 | Rich Menu 入口串接 | 程式與 staging DB 完成／外部待驗收 | `/admin/richmenu` 已具草稿、版本、模板、實圖熱區與逐格連結預覽、發布前驗證、發布／下架／回復、Alias、顯示排程、版本複製／比較、成效洞察、完整品牌 LIFF 深連結與失敗補償；正式 channel 發布與 Insights 資料尚待驗收。 |
| 3 | 預約與報名確認通知 | 已實作 | notification modules 與 delivery logs。 |
| 4 | 取消與改期通知 | 已實作 | appointment／registration status notification。 |
| 5 | 候補轉正通知 | 已實作 | registration promotion notification。 |
| 6 | 行前提醒通知 | 已實作 | cron／reminder logs，需正式排程觀察。 |
| 7 | 通知去重與投遞紀錄 | 已實作 | unique delivery／reminder logs。 |
| 8 | 瀏覽器連結備援入口 | 已實作 | public booking／registration routes。 |
| 9 | Email 通知（選用） | 外部待驗收 | code 與設定存在；需正式 SMTP／provider 憑證。 |

## 六、品牌與多入口（4）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 品牌名稱、色系與識別 | 已實作 | clinic profile／brand settings。 |
| 2 | 專屬預約網址 | 已實作 | `clinic_slug` 租戶解析與瀏覽器預約流程已存在；正式品牌自訂 host 仍歸 DNS 外部驗收。 |
| 3 | 自訂網域 | 外部待驗收 | add／TXT verify flow 已存在；DNS 與實際 domain routing 尚需外部驗收。 |
| 4 | 官網嵌入式預約元件 | 程式完成／外部待驗收 | `/embed/book` 與 `/embed/register` 共用正式瀏覽器流程；仍需以實際第三方網站驗證跨來源、尺寸與錯誤回復。 |

## 七、管理與報表（7）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 團隊成員邀請 | 已實作 | `/admin/users` 與 invite flow。 |
| 2 | 系統管理者、品牌管理者與員工工作權限 | Staging PASS | 產品身份收斂為兩種管理者；兩層員工使用可配置權限，已驗證導覽、direct route、server action、RLS 與 provider assignment。 |
| 3 | 顧客資料管理 | 已實作 | `/admin/patients`、tags、notes、timeline。 |
| 4 | 操作紀錄與異動稽核 | 已實作 | `/admin/audit` 統一查詢預約、報名、付款狀態異動。 |
| 5 | 時區設定 | 已實作 | default `Asia/Taipei` 與 clinic settings。 |
| 6 | 營運報表 | 已實作 | `/admin/reports` 與 acceptance contract。 |
| 7 | 資料匯出 | 已實作 | appointments／registrations／patients／check-in CSV 路徑。 |

## 八、安全與隔離（4）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 各品牌資料完全隔離 | 已實作 | tenant scope、RLS 與 service route scope；已完成前次 security acceptance。 |
| 2 | 顧客端不直接連資料庫 | 已實作 | public／LIFF 使用 Next.js API 與 server-side service client。 |
| 3 | QR 憑證不含個資 | 已實作 | token hash／encrypted token 設計。 |
| 4 | 名額原子化不超賣 | 已實作 | booking RPC lock／capacity checks。 |

## 優先開發順序

1. **M0／M1**：以產品重整基線及資訊架構契約凍結範圍、路由、角色與模組啟用規則。
2. **M2**：完成預約候補、多品牌 LINE／LIFF、統一顧客入口與 Rich Menu 版本資料契約。
3. **M3／M4／M5**：依契約重整後台、啟用中心、Rich Menu 與 LIFF 顧客中心。
4. **M6／M7**：完成自動化、資安、跨租戶與正式外部渠道驗收。

目前狀態：M0 至 M6 的程式、契約與本機介面已完成；M4 第二批 Rich Menu 優化的契約、type-check、production build、實圖熱區與逐格連結瀏覽器驗收均已通過。linked staging 已套用至 `202608130004_brand_configuration_permission_boundaries.sql`，DB lint 為零問題；Railway staging deployment `4c909311-e0b8-4081-907f-9a96e864c36c` 已成功，14 個公開入口及 5 支 Cron 未授權邊界全 PASS。共用登入頁的品牌／平台入口已拆分呈現，同一個真實 staging 測試帳號已驗證可分別導向 `/admin` 與 `/admin/platform`；跨網域 `/embed/book` 在第三方儲存遭拒時也能正常降級。正式 LINE、金流、Email、網域及手機 LINE WebView 驗收由品牌完成後台設定後執行。

既有 queue／叫號資料與相容程式保留，但 `legacy_progress_enabled` 預設關閉；標準預約、報名與後台導覽不依賴也不顯示這個舊版流程。
# 2026-08-06 開發盤點更新

本段是依目前簡報 70 項功能、SaaS 技術規格 v3 與程式庫現況更新的驗收狀態；原有盤點內容保留，不以外部帳號尚未驗證冒充已完成。

## 已完成並已接入流程

- SaaS 總後台：系統管理者可建立／停用品牌、邀請品牌管理者、設定方案與七項加購權益；品牌後台仍以 `clinic_id` 作為相容的租戶鍵。
- 預約：服務分類、服務時長、緩衝時間、取消／改期提前限制已接到可用時段與預約寫入；場地／設備資源可建立、綁定服務並在時間制與號次制預約檢查容量。
- 課程／活動：票種銷售期間、條款版本與同意時間快照、個人報名查詢、今日即時報到工作台、集中稽核頁。
- 會員／CRM Lite：會員資料入口、套票／堂數查看、會員預約扣點既有流程；低餘額與效期提醒 cron、LINE／Email 去重紀錄已加入。
- 品牌入口：LINE Rich Menu → LIFF 為主，並保留瀏覽器備援、品牌範圍網址、嵌入式預約與嵌入式報名入口。

## 暫不列為本次阻塞

- 金流交易驗證：保留綠界／藍新標準串接與付款狀態程式，但目前不執行正式商店驗證、真實交易或對帳驗收。
- 自訂網域 DNS 驗證：保留品牌網域資料與驗證流程，但目前不執行正式 DNS／憑證切換。
- LINE／Email 外部憑證：程式已保留多品牌隔離與失敗降級，需各品牌提供正式憑證後才能做外部投遞驗收。

## 仍需列入後續驗收的外部條件

- 以系統管理者帳號完成第一次 bootstrap，建立第一個品牌與品牌管理者。
- 正式 Supabase 專案已於 2026-08-06 套用 `migration_saas_platform.sql` 與 `migration_saas_core_gaps.sql`，並以只讀查詢確認新表、RPC 與 RLS。
- Railway 以 GitHub `main` 自動部署後，使用真實品牌範圍重跑公開入口、後台登入、提醒 cron 與資源容量測試。

## 目前明確保留的資料與授權事項

- 正式資料庫既有租戶資料仍保留；程式碼預設已改為通用 SaaS，不擅自刪除或改名既有品牌資料。
- 正式資料庫目前尚未指定系統管理者 bootstrap 帳號；未擅自把既有品牌帳號升級為總控台，以避免未授權擴大權限。
