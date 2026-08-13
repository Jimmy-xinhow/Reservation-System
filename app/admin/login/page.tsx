"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { Brand } from "@/components/Brand";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [entry, setEntry] = useState<"brand" | "platform">("brand");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    if (!reason) return;

    const message = reason === "platform-access-required"
      ? "此帳號沒有系統管理後台權限。"
      : reason === "brand-access-required"
        ? "此帳號沒有品牌營運後台權限。"
        : "此帳號目前沒有可用的後台權限。";
    const supabase = createSupabaseBrowser();
    void supabase.auth.signOut().finally(() => {
      window.history.replaceState({}, "", "/admin/login");
    });
    setError(message);
  }, []);

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

      const accessResponse = await fetch(`/api/admin/access?entry=${entry}`, { cache: "no-store" });
      if (!accessResponse.ok) {
        await supabase.auth.signOut();
        setError("登入成功，但目前無法確認後台權限，請稍後再試。");
        return;
      }
      const access = (await accessResponse.json()) as { allowed?: boolean };
      if (access.allowed !== true) {
        await supabase.auth.signOut();
        setError(entry === "platform" ? "此帳號沒有系統管理後台權限。" : "此帳號沒有品牌營運後台權限。");
        return;
      }
      router.replace(entry === "platform" ? "/admin/platform" : "/admin/dashboard");
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
      <Brand align="center" size="lg" subtitle="系統管理與品牌營運共用入口" />
      <form onSubmit={onSubmit} className="card w-full max-w-sm p-6">
        <h1 className="text-lg font-bold text-slate-900">後台登入</h1>
        <p className="mt-1 text-sm leading-6 text-slate-500">選擇要前往的工作區；實際權限仍由帳號角色在伺服器端判定。</p>
        <div className="my-5 grid grid-cols-2 gap-2 rounded-xl bg-slate-100 p-1" role="group" aria-label="後台入口">
          <button
            type="button"
            aria-pressed={entry === "brand"}
            onClick={() => setEntry("brand")}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium transition ${entry === "brand" ? "bg-white text-brand-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            品牌營運後台
          </button>
          <button
            type="button"
            aria-pressed={entry === "platform"}
            onClick={() => setEntry("platform")}
            className={`min-h-11 rounded-lg px-3 text-sm font-medium transition ${entry === "platform" ? "bg-white text-indigo-700 shadow-sm" : "text-slate-500 hover:text-slate-800"}`}
          >
            系統管理後台
          </button>
        </div>
        <label htmlFor="admin-email" className="label">Email</label>
        <input
          id="admin-email"
          type="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          className="input mb-4"
          placeholder="you@example.com"
        />
        <label htmlFor="admin-password" className="label">密碼</label>
        <input
          id="admin-password"
          type="password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          className="input mb-5"
          placeholder="••••••••"
        />
        {error && (
          <p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}
        <button type="submit" disabled={loading} className="btn btn-primary w-full">
          {loading ? "登入中…" : `登入${entry === "platform" ? "系統管理後台" : "品牌營運後台"}`}
        </button>
        <p className="mt-4 text-center text-xs leading-5 text-slate-400">
          系統管理者負責跨品牌系統層；品牌管理者與員工只會看到獲授權的品牌資料。
        </p>
      </form>
    </main>
  );
}
