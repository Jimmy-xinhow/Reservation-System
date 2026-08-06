# xinhow Booking SaaS 功能落差矩陣

更新日期：2026-08-06

本表以 `C:\Users\User\Downloads\xinhow-booking-saas-service-brief.html` 的 70 項標準功能、目前程式碼與 `clinic-booking-spec-v3.md` 對照。狀態只代表目前可從 repo 驗證到的程度；外部帳號、金流商店號、LINE／Email 憑證與網域 DNS 不在程式碼內，另列為「外部待驗收」，不宣稱已完成。

狀態定義：

- **已實作**：repo 中已有完整主要流程，可進入驗收。
- **部分**：已有資料或流程，但缺少簡報要求的完整管理能力、頁面、欄位或驗收狀態。
- **未完成**：目前沒有足夠的可操作實作。
- **外部待驗收**：程式已具備，但需要正式第三方設定或真實資料才能驗證。

## 一、預約功能（16）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 服務項目建立與分類 | 部分 | `app/admin/services` 可建立服務，但沒有分類欄位與分類篩選。 |
| 2 | 服務人員、場地、設備資源設定 | 部分 | `doctors` 與指派已存在；場地／設備資源模型與衝突檢查尚未完成。 |
| 3 | 每週營業時段設定 | 已實作 | `schedule_templates` 支援同一人同一週日多段時段。 |
| 4 | 例外日期與休假設定 | 已實作 | `schedule_exceptions` 與後台頁面已存在。 |
| 5 | 時間制預約 | 已實作 | booking mode `time`、空檔與原子訂位流程已存在。 |
| 6 | 號次制預約 | 已實作 | booking mode `number`、`serving_numbers` 與 queue 流程已存在。 |
| 7 | 服務時長與緩衝時間 | 未完成 | `services` 目前沒有 duration／buffer 欄位，預約 RPC 仍以門診模板時段為主。 |
| 8 | 同時段容量上限 | 已實作 | 模板容量與原子化 RPC 已存在。 |
| 9 | 最短前置預約時間 | 已實作 | `clinic_settings.min_lead_minutes` 已接入。 |
| 10 | 最長可預約天數 | 已實作 | `clinic_settings.max_advance_days` 已接入。 |
| 11 | 顧客自助取消 | 已實作 | public cancel route 與歷史保留流程已存在。 |
| 12 | 顧客自助改期 | 已實作 | public reschedule 流程已存在。 |
| 13 | 取消與改期規則設定 | 部分 | 可取消／改期流程存在，但管理設定頁尚未提供獨立的期限、費用與規則欄位。 |
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
| 7 | 同意條款版本留存 | 部分 | 有表單版本，但 registration 沒有明確的條款版本與同意快照欄位。 |
| 8 | 多票種（免費與付費） | 已實作 | `event_ticket_types` 與報名流程。 |
| 9 | 售票期間與票種庫存 | 部分 | 票種庫存存在；每一票種的 sale_start／sale_end 欄位與檢查尚未完成。 |
| 10 | 名額上限 | 已實作 | session／ticket capacity。 |
| 11 | 候補名單 | 已實作 | waitlist status 與容量流程。 |
| 12 | 候補轉正與自動通知 | 已實作 | promotion 與 registration notification 流程已存在。 |
| 13 | 個人報名查詢頁 | 部分 | 有取消／付款 token 流程，尚未形成完整的個人報名查詢入口與多筆報名檢視。 |
| 14 | 專屬報到 QR code | 已實作 | registration token hash／encrypted token 與 QR 入口。 |
| 15 | QR 掃描報到 | 已實作 | `/admin/checkin` 與 checkin RPC。 |
| 16 | 姓名搜尋手動報到 | **本次完成** | 報到頁增加姓名／電話／報名編號搜尋與操作入口。 |
| 17 | 即時報到名單與名單匯出 | 部分 | registrations CSV 已有；報到頁原本只有掃描，不是即時名單檢視。 |

## 三、會員、CRM Lite 與規則式行銷（8）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 會員制度與登入專區 | 部分 | 會員資料與後台管理已存在；顧客端會員登入／專區尚未完整落地。 |
| 2 | 會員等級與專屬價格 | 未完成 | 有方案與發放會員，但沒有 level／price rule 的完整模型與前台結算。 |
| 3 | 套票與堂數包販售 | 部分 | plan／credits／ledger 有資料模型；前台販售與付款閉環仍需補強。 |
| 4 | 點數餘額與扣點紀錄 | 已實作 | membership ledger 與預約扣點流程已存在。 |
| 5 | 預約時自動扣除堂數 | 已實作 | booking／membership consumption 流程已存在。 |
| 6 | 餘額不足與效期到期提醒 | 部分 | 有效期資料存在；提醒 cron／通知驗收尚未形成完整閉環。 |
| 7 | 優惠碼與禮券 | 部分 | discount code／redemption 已存在；禮券獨立生命週期尚未完成。 |
| 8 | 回購回訪分眾、CRM Lite、規則式行銷 | 已實作 | `/admin/crm`、segments、automations、LINE／Email delivery log 已存在；第三方投遞仍需外部憑證驗收。 |

## 四、金流（5）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 綠界、藍新標準串接 | 外部待驗收 | provider adapter／設定頁已有；正式商店號與憑證尚未在 repo 內，不能視為正式交易完成。 |
| 2 | 線上收款與訂金設定 | 部分 | 訂金與 payment settings 已有；正式付款頁／第三方交易需正式帳號驗收。 |
| 3 | 付款完成自動確認預約或報名 | 已實作 | payment webhook／status flow 已存在，需正式交易測試。 |
| 4 | 未付款自動釋放名額 | 已實作 | payment expiry／release flow 已存在，需排程與正式資料驗收。 |
| 5 | 收款紀錄與訂單對照 | 已實作 | payment transaction／registration order 對照資料已存在。 |

## 五、訊息與入口（9）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | LINE 身分驗證 | 外部待驗收 | LIFF ID token server 驗證流程已實作；需正式 LIFF／LINE channel 驗證。 |
| 2 | Rich Menu 入口串接 | 外部待驗收 | `/admin/richmenu` 與 API 已存在；需正式 channel 發布驗收。 |
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
| 2 | 專屬預約網址 | 部分 | clinic slug route 已存在；正式品牌網址需實際 tenant 資料驗收。 |
| 3 | 自訂網域 | 外部待驗收 | add／TXT verify flow 已存在；DNS 與實際 domain routing 尚需外部驗收。 |
| 4 | 官網嵌入式預約元件 | 部分 | embed route 已存在；需以實際第三方網站驗證跨來源、尺寸與錯誤回復。 |

## 七、管理與報表（7）

| # | 簡報功能 | 現況 | 證據／缺口 |
|---:|---|---|---|
| 1 | 團隊成員邀請 | 已實作 | `/admin/users` 與 invite flow。 |
| 2 | 擁有者、管理員、櫃檯、服務提供者分級權限 | 已實作 | role matrix、RLS、provider assignment。 |
| 3 | 顧客資料管理 | 已實作 | `/admin/patients`、tags、notes、timeline。 |
| 4 | 操作紀錄與異動稽核 | 部分 | DB audit／status event 已有，但後台尚未提供統一的稽核查詢頁。 |
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

1. **P0（本次已完成）**：工程後台左側導覽、預約日曆、姓名／電話／報名編號手動報到、日曆與列表的操作入口一致化。
2. **P1（下一階段）**：服務分類／時長／緩衝；取消改期規則設定；票種售票期間；報到名單即時檢視；統一稽核查詢頁。
3. **P2（需先定義資料與驗收規則）**：場地／設備資源衝突、會員等級價格、顧客會員專區、完整禮券、完整報名條款快照。
4. **外部驗收**：ECPay／NewebPay 正式交易、LINE／LIFF／Rich Menu、Email provider、自訂網域 DNS、第三方 embed。

本次不把既有舊版 queue／叫號功能刪除；它與 v3 scope 有衝突，先保留並在導覽中歸類為既有營運功能，待產品範圍確認後再決定是否隱藏或移除。
