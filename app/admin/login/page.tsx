"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createSupabaseBrowser } from "@/lib/supabase-browser";
import { setActiveClinicAction } from "../actions";

export default function AdminLoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [entry, setEntry] = useState<"brand" | "platform">("brand");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [accessDenied, setAccessDenied] = useState(false);
  const [brandId, setBrandId] = useState<string | null>(null);
  const [brandName, setBrandName] = useState<string | null>(null);
  const [brandLoading, setBrandLoading] = useState(true);
  const [brandError, setBrandError] = useState<string | null>(null);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("brand");
    if (!requested) {
      setBrandLoading(false);
      return;
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(requested)) {
      setBrandError("品牌入口無效，請從系統管理的品牌清單重新進入。");
      setBrandLoading(false);
      return;
    }
    let cancelled = false;
    void fetch(`/api/admin/brand-entry?brand=${encodeURIComponent(requested)}`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("品牌入口目前無法使用，請確認品牌已啟用。");
        return response.json() as Promise<{ id: string; name: string }>;
      })
      .then((brand) => {
        if (cancelled) return;
        if (brand.id !== requested) throw new Error("品牌入口資料不一致，請重新進入。");
        setBrandId(brand.id);
        setBrandName(brand.name);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setBrandError(cause instanceof Error ? cause.message : "無法確認品牌入口。");
      })
      .finally(() => { if (!cancelled) setBrandLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("reason");
    const inviteAccepted = new URLSearchParams(window.location.search).get("invite") === "accepted";
    if (!reason && !inviteAccepted) return;

    const message = inviteAccepted
      ? "密碼已設定完成，請使用新密碼登入。"
      : reason === "platform-access-required"
        ? "此帳號沒有系統管理後台權限。"
        : reason === "brand-access-required"
          ? "此帳號沒有品牌營運後台權限。"
          : "此帳號目前沒有可用的後台權限。";
    if (inviteAccepted) {
      const supabase = createSupabaseBrowser();
      void supabase.auth.signOut().finally(() => {
        window.history.replaceState({}, "", "/admin/login");
      });
    } else {
      // 拒絕工作區存取不應撤銷同帳號在其他工作區的有效登入。
      // 保留 reason，讓 middleware 顯示原因而不自動轉址。
      setAccessDenied(true);
    }
    setError(message);
  }, []);

  async function enterSelectedBrand(id: string) {
    const form = new FormData();
    form.set("clinic_id", id);
    await setActiveClinicAction(form);
  }

  async function continueCurrentAccount() {
    if (!brandId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/access?entry=brand&brand=${encodeURIComponent(brandId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("目前無法確認品牌權限，請稍後再試。");
      const access = (await response.json()) as { allowed?: boolean };
      if (!access.allowed) {
        setError("目前登入的帳號不是此品牌成員，請使用此品牌的管理者或員工帳號登入。");
        return;
      }
      await enterSelectedBrand(brandId);
    } catch {
      setError("目前無法確認品牌權限，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (brandLoading || brandError) return;
    setLoading(true);
    setError(null);
    try {
      const supabase = createSupabaseBrowser();
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        const isBadCredential = /invalid login credentials/i.test(error.message);
        setError(isBadCredential ? "帳號或密碼錯誤。" : "登入服務目前無法使用，請稍後再試；若持續發生，請聯絡系統管理者。");
        return;
      }

      const accessResponse = await fetch(`/api/admin/access?entry=${entry}${brandId ? `&brand=${encodeURIComponent(brandId)}` : ""}`, { cache: "no-store" });
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
      if (brandId) {
        await enterSelectedBrand(brandId);
      } else {
        router.replace(entry === "platform" ? "/admin/platform" : "/admin/dashboard");
        router.refresh();
      }
    } catch {
      setError("目前無法連線至登入服務，請檢查網路後再試一次。");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="admin-login-shell">
      <aside className="admin-login-aside">
        <div className="flex items-center gap-3 text-xs font-semibold tracking-[.08em]">
          <span className="grid h-8 w-8 place-items-center border border-white/40 font-mono text-[10px]">XH</span>
          XINHOW OPERATIONS
        </div>
        <div>
          <h1>把今天要處理的事，放在同一個工作區。</h1>
          <p>品牌營運人員處理預約、報名與顧客；系統管理人員負責跨品牌開通、權限與服務健康。登入後只會看到帳號獲授權的範圍。</p>
        </div>
        <span className="text-[10px] tracking-[.08em] text-[#91a29a]">BOOKING · EVENTS · CUSTOMER OPERATIONS</span>
      </aside>
      <section className="admin-login-main">
        <form onSubmit={onSubmit} className="admin-login-form">
          <header className="admin-login-form-header">
            <p className="mb-2 text-[11px] font-semibold tracking-[.08em] text-emerald-800">安全登入</p>
            <h2>{brandName ? `登入「${brandName}」後台` : "選擇工作區並登入"}</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">{brandId ? "請使用此品牌獲授權的帳號；登入後會直接切換至此品牌。" : "同一組帳號可依授權進入品牌營運或系統管理。"}</p>
          </header>
          {brandError && <p role="alert" className="admin-login-error">{brandError}</p>}
          {!brandId && <div className="admin-login-switch" role="group" aria-label="後台入口">
          <button
            type="button"
            aria-pressed={entry === "brand"}
            onClick={() => setEntry("brand")}
          >
            品牌營運後台
          </button>
          <button
            type="button"
            aria-pressed={entry === "platform"}
            onClick={() => setEntry("platform")}
          >
            系統管理後台
          </button>
          </div>}
          {brandId && <button type="button" onClick={continueCurrentAccount} disabled={loading} className="btn btn-secondary mt-3 w-full">以目前帳號進入此品牌</button>}
          <div className="admin-login-fields">
            <label htmlFor="admin-email"><span className="label">Email</span><input id="admin-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" className="input" placeholder="name@company.com" /></label>
            <label htmlFor="admin-password"><span className="label">密碼</span><input id="admin-password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" className="input" placeholder="輸入登入密碼" /></label>
          </div>
          {error && <p role="alert" className="admin-login-error">{error}</p>}
          {accessDenied && <a href="/admin" className="mt-3 block text-sm text-emerald-800 underline">返回已授權工作區</a>}
          <button type="submit" disabled={loading || brandLoading || Boolean(brandError)} className="btn btn-primary mt-5 w-full">
            {loading ? "正在確認帳號…" : `進入${entry === "platform" ? "系統管理" : "品牌營運"}`}
          </button>
          <p className="mt-4 text-xs leading-5 text-slate-500">實際權限仍由帳號角色在伺服器端判定；選錯工作區不會讓帳號取得額外資料。</p>
        </form>
      </section>
    </main>
  );
}
