# G2-06：Email 明確拒收後的受控補送候選

2026-09-30（Asia/Taipei）。從 staging 已部署的 `b57751c0` 建立隔離候選，尚未推送、部署或套用資料庫 migration。新後台 `/admin/notifications` 只列品牌內 Resend 已明確拒收的預約通知與行前提醒；操作者須核對或修正顧客 Email 並勾選單筆確認。登入與 `operations.manage`／`brand.manage`、資料庫成員檢查同時生效。

`202609300003_rejected_email_redrive.sql` 把地址修正、對精確 `failed / delivery_error:provider_rejected` 紀錄的原子領取、操作者稽核放在同一交易；已送出、`sending` 與結果不明的紀錄不能重領。寄送前由稽核紀錄做 `claimed → delivering` 的條件更新，防止同一領取被兩個請求同時寄出；寄送時再核對顧客地址仍等於操作者確認的地址與預約狀態。成功與再次 422 分別落 `sent`／`rejected`；傳輸或資料庫確認不明則停在不可自動重送狀態並標成 `uncertain`。行前提醒只在原排程時間窗且預約仍有效時開放。頁面會顯示最近 20 筆補送結果及人工核對警示。`supabase/schema.sql` 已同步。

本機 `npm run typecheck`、`npm run build`、`npm run verify:contracts` 均通過；定向通知／提醒／錯誤隱私測試 **225/225**。在獨立 Supabase QA `hicbevwrfhlnhgegxaei`，單一 `BEGIN ... ROLLBACK` 真資料測試編譯新 migration，實際對確認信與提醒各領取一筆，檢查操作者、地址修正、嘗試紀錄、重複領取拒絕、跨品牌拒絕、無權帳號拒絕、anon 表讀／RPC 執行均拒絕；回滾後新表不存在、測資零殘留。此交易沒有呼叫 Resend，正式與現有 staging 都沒有寫入。

**主驗收仍待驗證。** 需在獲准的同版 staging 部署與 migration 套用後，以隔離品牌真實操作完成 422 → 地址修正 → 單筆補送 → 收件匣實收 → 重複操作拒絕 → 逐 ID 清理；LINE 提醒與完整時間窗也仍缺。不得以本機或 QA 回滾結果替代 G2-06 整項通過。
