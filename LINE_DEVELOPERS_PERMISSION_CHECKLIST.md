# LINE Developers 權限交付清單

這些權限必須由該 Provider 的管理員在 LINE Developers Console 邀請指定帳號；專案程式碼無法代為授權。

請管理員在 Provider 的成員／角色設定中，對負責串接的工程帳號授予：

- **Providers Roles**：僅在需要管理 Provider 或 Channel 結構時提供。
- **Messaging API Roles**：Webhook、推播、Rich Menu、訊息素材與 Channel 設定所需。
- **LINE Login API Roles**：LIFF、LINE Login Channel 與 ID Token 驗證設定所需。

交付後請確認：

1. 工程帳號已接受邀請，且三組角色都顯示有效。
2. 不要以聊天訊息或 commit 傳送 Channel Access Token、Channel Secret、LIFF Secret。
3. 本機 token 撤銷後重新產生，並只放在部署平台的環境變數。
4. Webhook URL、LIFF URL、Channel ID 與實際環境逐一核對。
