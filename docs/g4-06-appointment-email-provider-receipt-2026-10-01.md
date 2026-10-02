# G4-06 預約 Email 供應商收據候選（2026-10-01）

9/30 14:54 的 QA 預約確認 Email 在 staging `appointment_notification_logs` 停於 `sending`，嘗試 1 次、`sent_at` 與錯誤均空；同預約的 15:05 取消 Email 在 Resend 有獨立訊息 ID 且已送達。系統原本只保存站內通知 ID，無法把前一筆精確對到 Resend；其預約已取消，**不補寄、不回填為已送達**。

[Resend 官方冪等文件](https://resend.com/docs/dashboard/emails/idempotency-keys)確認 `POST /emails` 可用 `Idempotency-Key`，相同請求在 **24 小時**內回同一封 Email 的 ID；不同 payload 共用 key 會遭 409 拒絕。因此新預約 Email 的 key 使用「通知紀錄 ID + 嘗試次數」，同一嘗試可對帳，明確拒收後修正地址／寄件者的下一次嘗試會取得新 key。官方[寄信 API](https://resend.com/docs/api-reference/emails/send-email)成功回應含 `id`。

候選新增 `appointment_notification_logs.provider_message_id` 可空欄位；寄件成功須從 Resend 回應取得格式正確的 ID，才同一筆 DB 更新為 `sent` 並保存該 ID。缺少收據、網路或 DB 確認失敗，仍維持 `sending` 防止不明重送；422 明確拒收仍記 `failed`。此變更**沒有**自動重送或回填舊紀錄，也無法擴大 Resend 的 24 小時保護期。

`202610010001_appointment_email_provider_receipt.sql` 是僅加可空欄位的 migration，需**先在 staging 套用、後部署 Web**；正式 DB 與正式 Web 目前不變。本機定向 317/317、完整 `npm test` 1671/1671、typecheck、contracts、`next build` 均通過。這些只證明候選行為，**G4-06／主驗收 13/24 不變**。部署後仍需以新的隔離 QA 預約取得真實供應商 ID、同筆 DB `sent` 與 Resend `delivered`，完成按 ID 清理；不能以本機測試替代。
