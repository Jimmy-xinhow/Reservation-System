-- 讓報名／候補通知在第一次傳送失敗後仍能重試。
-- 內容由 Next.js server 以 REGISTRATION_TOKEN_ENCRYPTION_KEY 加密；資料庫不保存明文憑證。
alter table registrations add column if not exists checkin_token_encrypted text;
