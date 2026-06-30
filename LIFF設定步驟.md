# 建立 LIFF(病患預約入口)逐步清單 — 慈愛中醫診所

> 目的:讓 `/book` 能在 LINE 內開啟、取得並驗證病患的 LINE 身分。
> 重點:LIFF 現在**只能建在「LINE Login 頻道」**(不能掛在 Messaging API 頻道)。
> 完成後會得到兩個值:`NEXT_PUBLIC_LIFF_ID` 與 `LINE_LOGIN_CHANNEL_ID`。

先準備:你的公開網域(部署後的網址)。可在後台 `/admin/line` 看到實際的 Webhook/LIFF 網址,
以下用 `https://<你的網域>` 代表。

---

## A. 建立 LINE Login 頻道

- [ ] 1. 進 **LINE Developers Console**(developers.line.biz)登入。
- [ ] 2. 選到**和 Messaging API 同一個 Provider**(慈愛中醫診所那個)。
- [ ] 3. **Create a new channel → 選「LINE Login」**。
- [ ] 4. 填寫:
  - Channel name:例「慈愛中醫診所預約」
  - Region:Taiwan
  - App types:勾 **Web app**
- [ ] 5. 建立完成。

## B. 在該頻道下新增 LIFF app

- [ ] 6. 進剛建的 **LINE Login 頻道 → 上方「LIFF」分頁 → Add**。
- [ ] 7. 設定:
  - LIFF app name:例「線上預約」
  - Size:**Full**(全螢幕,預約頁較好用)
  - **Endpoint URL:`https://<你的網域>/book`**
  - **Scopes:勾 `openid` 和 `profile`**(⚠️ 一定要勾 `openid`,否則拿不到 ID token,後端驗證會失敗)
  - Bot link feature:可選「On (Aggressive)」並連到你的官方帳號 → 登入時可順便加好友
- [ ] 8. 新增後,複製這個 LIFF app 的 **LIFF ID**(長得像 `2010xxxxxx-xxxxxxxx`)。
  - → 這就是 **`NEXT_PUBLIC_LIFF_ID`**

## C. 取得 Login 頻道 ID,並連結官方帳號

- [ ] 9. 在 LINE Login 頻道 → **Basic settings → Channel ID**(純數字)。
  - → 這就是 **`LINE_LOGIN_CHANNEL_ID`**(注意:**不是** Messaging API 的 `2010483361`)
- [ ] 10.(建議)Basic settings 裡把 **Linked Official Account** 連到「慈愛中醫診所官方帳號」,登入體驗較一致。

## D. 設定 Railway 環境變數並重新部署

- [ ] 11. Railway → 你的服務 → **Variables**,新增/更新:
  - `NEXT_PUBLIC_LIFF_ID` = 第 8 步的 LIFF ID
  - `LINE_LOGIN_CHANNEL_ID` = 第 9 步的 Channel ID
- [ ] 12. **重新部署**(`NEXT_PUBLIC_*` 是 build 時嵌入,改值一定要重新 deploy 才生效)。

## E. 把入口接到 LINE

- [ ] 13. **Rich Menu(圖文選單)**:LINE 官方帳號管理後台 → 主頁 → 圖文選單 → 建立:
  - 動作類型:**連結**
  - URL:`https://liff.line.me/<你的 LIFF ID>`
  - 病患點選單即可在 LINE 內開啟預約頁。
- [ ] 14.(公開頁)首頁的「加入 LINE · 線上預約」已會用你的 LINE ID 產生加好友連結;
  加好友後用 Rich Menu 或歡迎訊息的「立即預約」按鈕進預約。

## F. 測試

- [ ] 15. 用手機 LINE 開 `https://liff.line.me/<你的 LIFF ID>`(或點 Rich Menu):
  - 應出現 LINE 登入授權 → 同意後載入 `/book`。
- [ ] 16. 首次會看到**「先綁定」**(填一次姓名+電話)→ 完成後即可選醫師/時段預約。
- [ ] 17. 預約成功後,看診前會收到 LINE 提醒;在 LINE 輸入「查詢」可看到並取消預約。

---

## 常見卡點

- **拿不到身分 / 驗證失敗**:多半是 LIFF 沒勾 `openid`,或 `LINE_LOGIN_CHANNEL_ID` 填成 Messaging API 的 id。兩者要對應到「LIFF 所屬的那個 LINE Login 頻道」。
- **改了 LIFF ID 沒反應**:`NEXT_PUBLIC_LIFF_ID` 要重新部署才生效。
- **歡迎訊息/查詢沒反應**:那是 Messaging API 那邊的事——回應模式要設「Bot」並開 webhook(與 LIFF 各自獨立)。
- **Endpoint 必須是 HTTPS**:Railway 預設就是 https,直接用。

## 對照:env 變數總表(LINE 相關)

| 變數 | 來源 |
|---|---|
| `NEXT_PUBLIC_LIFF_ID` | LINE Login 頻道 → LIFF 分頁 → LIFF ID |
| `LINE_LOGIN_CHANNEL_ID` | LINE Login 頻道 → Basic settings → Channel ID |
| `LINE_CHANNEL_ACCESS_TOKEN` | Messaging API 頻道 → Issue 的 token |
| `LINE_CHANNEL_SECRET` | Messaging API 頻道 → Channel secret |
