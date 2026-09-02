"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Brand } from "@/components/Brand";
import { createSupabaseBrowser } from "@/lib/supabase-browser";

export default function AcceptInvitePage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [checking, setChecking] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowser();

    async function loadInviteSession() {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          if (active) setError("邀請連結已失效或已使用，請管理者重新寄送邀請。");
          if (active) setChecking(false);
          return;
        }
      }

      const { data, error: sessionError } = await supabase.auth.getSession();
      if (!active) return;
      if (sessionError || !data.session?.user) {
        setError("找不到有效的邀請登入狀態，請從最新的邀請信重新開啟連結。");
      } else {
        setEmail(data.session.user.email ?? "");
      }
      setChecking(false);
    }

    void loadInviteSession();
    return () => {
      active = false;
    };
  }, []);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (password.length < 8) {
      setError("密碼至少需要 8 碼。");
      return;
    }
    if (password !== confirmPassword) {
      setError("兩次輸入的密碼不一致。");
      return;
    }

    setLoading(true);
    setError(null);
    const supabase = createSupabaseBrowser();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    if (updateError) {
      setError("密碼設定失敗，請重新開啟最新邀請信再試一次。");
      setLoading(false);
      return;
    }

    await supabase.auth.signOut();
    router.replace("/admin/login?invite=accepted");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-slate-50 p-6">
      <Brand align="center" size="lg" subtitle="完成後台帳號設定" />
      <section className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-bold text-slate-900">設定登入密碼</h1>
        <p className="mt-1 text-sm leading-6 text-slate-500">
          {checking ? "正在確認邀請連結…" : "請設定自己的密碼，之後即可登入後台。"}
        </p>
        {error ? <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
        {!checking && !error ? (
          <form onSubmit={onSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="invite-email" className="label">Email</label>
              <input id="invite-email" value={email} readOnly className="input bg-slate-100" />
            </div>
            <div>
              <label htmlFor="invite-password" className="label">新密碼</label>
              <input id="invite-password" type="password" required minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" className="input" />
            </div>
            <div>
              <label htmlFor="invite-confirm-password" className="label">再次輸入新密碼</label>
              <input id="invite-confirm-password" type="password" required minLength={8} value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" className="input" />
            </div>
            <button type="submit" disabled={loading} className="btn btn-primary w-full">
              {loading ? "儲存中…" : "設定密碼並前往登入"}
            </button>
          </form>
        ) : null}
      </section>
    </main>
  );
}
