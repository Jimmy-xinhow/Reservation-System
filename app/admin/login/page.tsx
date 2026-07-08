"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { Brand } from "@/components/Brand";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowser();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        // 顯示真實原因以利診斷(帳密錯誤 / 專案暫停 / 金鑰失效 / 連線問題…)
        const reason = error.message || "未知錯誤";
        const isBadCred = /invalid login credentials/i.test(reason);
        setError(isBadCred ? "帳號或密碼錯誤。" : `登入失敗:${reason}`);
        return;
      }
      router.replace("/admin");
      router.refresh();
    } catch (err) {
      // 連 Supabase 都連不上(專案暫停 / 網路 / 環境變數錯誤)會走到這裡
      setError("無法連線至驗證伺服器:" + (err instanceof Error ? err.message : "請稍後再試"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-6">
      <Brand align="center" size="lg" subtitle="櫃檯後台" />
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-6">
        <h1 className="mb-5 text-lg font-bold text-slate-900">後台登入</h1>
        <label className="label">Email</label>
        <input
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="input mb-4"
          placeholder="you@clinic.com"
        />
        <label className="label">密碼</label>
        <input
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mb-5"
          placeholder="••••••••"
        />
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        <button type="submit" disabled={loading} className="btn btn-primary w-full">
          {loading ? "登入中…" : "登入"}
        </button>
      </form>
    </main>
  );
}
