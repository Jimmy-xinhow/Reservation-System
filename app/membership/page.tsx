"use client";

import { useEffect, useState } from "react";

interface Membership {
  membership_code: string;
  status: string;
  credits_total: number;
  credits_remaining: number;
  starts_at: string;
  expires_at: string | null;
  membership_plans: { name: string; description: string | null; price: number } | { name: string; description: string | null; price: number }[] | null;
}

interface Plan {
  id: string;
  name: string;
  description: string | null;
  price: number;
  credits_total: number;
  valid_days: number | null;
  usage_scope: "appointment" | "registration" | "both";
}

interface PaymentForm {
  action: string;
  fields: Record<string, string>;
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

function brandedPath(path: string): string {
  if (typeof window === "undefined") return path;
  const clinicSlug = new URLSearchParams(window.location.search).get("clinic_slug");
  return clinicSlug ? `${path}${path.includes("?") ? "&" : "?"}clinic_slug=${encodeURIComponent(clinicSlug)}` : path;
}

function formatPrice(price: number): string {
  return `NT$${price.toLocaleString("zh-TW")}`;
}

export default function MembershipPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [birthday, setBirthday] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      setToken(window.localStorage.getItem("membership_browser_token"));
    } catch {
      // localStorage 不可用時仍可用身分資料重新查詢。
    }
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(brandedPath("/api/membership/portal"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone, birthday }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: { browser_token: string; memberships: Membership[]; plans: Plan[] } } | null;
      if (!response.ok || !body?.ok || !body.data) throw new Error(body?.error ?? "會員資料查詢失敗");
      setToken(body.data.browser_token);
      setMemberships(body.data.memberships ?? []);
      setPlans(body.data.plans ?? []);
      try {
        window.localStorage.setItem("membership_browser_token", body.data.browser_token);
      } catch {
        // localStorage 不可用時不阻斷目前頁面的查詢結果。
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "會員資料查詢失敗");
    } finally {
      setLoading(false);
    }
  }

  async function purchase(plan: Plan) {
    if (!token) {
      setError("請先查詢會員資料，再購買套票。");
      return;
    }
    if (plan.price <= 0) {
      setError("免費或未定價方案請洽品牌櫃檯發放。");
      return;
    }
    setBuying(plan.id);
    setError(null);
    try {
      const response = await fetch(brandedPath("/api/payment/create"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ membership_plan_id: plan.id, browser_token: token, return_path: brandedPath("/membership") }),
      });
      const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; data?: { form: PaymentForm } } | null;
      if (!response.ok || !body?.ok || !body.data?.form) throw new Error(body?.error ?? "付款頁建立失敗");
      const form = document.createElement("form");
      form.method = "POST";
      form.action = body.data.form.action;
      form.style.display = "none";
      for (const [key, value] of Object.entries(body.data.form.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = key;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (purchaseError) {
      setError(purchaseError instanceof Error ? purchaseError.message : "付款頁建立失敗");
      setBuying(null);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <header>
        <p className="eyebrow">Membership</p>
        <h1 className="text-2xl font-bold text-slate-900">會員與套票</h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">查詢剩餘堂數、有效期限與可購買方案。資料只會回傳給通過身分驗證的顧客。</p>
      </header>

      <form onSubmit={submit} className="card grid gap-4 p-5 sm:grid-cols-3">
        <label className="text-sm"><span className="label">姓名</span><input className="input" value={name} onChange={(event) => setName(event.target.value)} required /></label>
        <label className="text-sm"><span className="label">電話</span><input className="input" value={phone} onChange={(event) => setPhone(event.target.value)} required /></label>
        <label className="text-sm"><span className="label">出生年月日</span><input type="date" className="input" value={birthday} onChange={(event) => setBirthday(event.target.value)} required /></label>
        <button className="btn btn-primary sm:col-span-3" disabled={loading}>{loading ? "查詢中…" : "查詢會員資料"}</button>
      </form>

      {error && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}

      <section className="space-y-3">
        <div><h2 className="text-lg font-semibold text-slate-900">可購買套票</h2><p className="mt-1 text-sm text-slate-500">付款完成後，套票會自動發放到目前驗證的顧客帳戶。</p></div>
        {plans.length === 0 ? <div className="card p-6 text-center text-sm text-slate-400">查詢後顯示品牌目前開放的套票方案。</div> : <div className="grid gap-4 md:grid-cols-2">{plans.map((plan) => <article key={plan.id} className="card flex flex-col gap-4 p-5"><div><h3 className="font-semibold text-slate-900">{plan.name}</h3><p className="mt-1 text-sm text-slate-500">{plan.description || "可用於品牌開放的預約或活動報名。"}</p></div><div className="flex items-end justify-between gap-3"><div><p className="text-2xl font-bold text-slate-950">{formatPrice(plan.price)}</p><p className="text-xs text-slate-500">{plan.credits_total} 堂{plan.valid_days ? ` · ${plan.valid_days} 天有效` : " · 不限期"}</p></div><button type="button" className="btn btn-secondary" disabled={!token || buying === plan.id || plan.price <= 0} onClick={() => void purchase(plan)}>{buying === plan.id ? "前往付款…" : plan.price <= 0 ? "洽櫃檯" : "購買套票"}</button></div></article>)}</div>}
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold text-slate-900">我的套票</h2>
        {memberships.length === 0 ? <div className="card p-6 text-center text-sm text-slate-400">尚無會員套票資料。</div> : memberships.map((membership) => { const plan = one(membership.membership_plans); return <article key={membership.membership_code} className="card space-y-3 p-5"><div className="flex items-start justify-between gap-3"><div><h3 className="font-semibold text-slate-900">{plan?.name ?? "會員方案"}</h3><p className="mt-1 font-mono text-xs text-slate-400">{membership.membership_code}</p></div><span className={`badge ${membership.status === "active" ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{membership.status}</span></div><div className="flex items-end justify-between"><div><p className="text-xs text-slate-500">剩餘堂數</p><p className="mt-1 text-2xl font-bold text-slate-950">{membership.credits_remaining}<span className="ml-1 text-sm font-normal text-slate-400">/ {membership.credits_total}</span></p></div><p className="text-right text-xs text-slate-500">{membership.expires_at ? `到期：${new Date(membership.expires_at).toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" })}` : "不限期"}</p></div></article>; })}
      </section>
    </main>
  );
}
