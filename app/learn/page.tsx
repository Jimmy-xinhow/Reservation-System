"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Brand } from "@/components/Brand";
import { safeLocalStorageGet } from "@/lib/browser-storage";

interface Unit {
  id: string;
  title: string;
  summary: string | null;
  unit_type: "video" | "link" | "download" | "text";
  content_url: string | null;
  body: string | null;
  completed_at: string | null;
}
interface Course { event_id: string; title: string; units: Unit[]; }
interface LearningData { patient: { name: string }; courses: Course[]; }

function scopeSuffix(): string {
  if (typeof window === "undefined") return "";
  const source = new URLSearchParams(window.location.search);
  const params = new URLSearchParams();
  const slug = source.get("clinic_slug")?.trim();
  const clinicId = source.get("clinic_id")?.trim();
  if (slug) params.set("clinic_slug", slug);
  else if (clinicId) params.set("clinic_id", clinicId);
  return params.toString() ? `?${params.toString()}` : "";
}

function storedToken(): string | null {
  if (typeof window === "undefined") return null;
  const source = new URLSearchParams(window.location.search);
  const scope = source.get("clinic_slug")?.trim() || source.get("clinic_id")?.trim() || "default";
  return safeLocalStorageGet(`customer_browser_token:${scope}`, `booking_browser_token:${scope}`, "membership_browser_token");
}

function unitLabel(type: Unit["unit_type"]): string {
  return { video: "觀看影片", link: "開啟教材", download: "下載教材", text: "閱讀內容" }[type];
}

export default function LearningPage() {
  const [data, setData] = useState<LearningData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<string | null>(null);

  const load = useCallback(async (action?: "complete" | "uncomplete", unitId?: string) => {
    const token = storedToken();
    if (!token) { setLoading(false); setError("需要先完成一次預約、報名或會員驗證，才能確認學員身分。"); return; }
    if (!action) setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/customer/learning${scopeSuffix()}`, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ browser_token: token, action, unit_id: unitId }) });
      const body = await response.json() as { ok?: boolean; data?: LearningData; error?: string };
      if (!response.ok || !body.ok || !body.data) throw new Error(body.error ?? "學習內容載入失敗");
      setData(body.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "學習內容載入失敗");
    } finally { setLoading(false); setSaving(null); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function toggle(unit: Unit) {
    setSaving(unit.id);
    await load(unit.completed_at ? "uncomplete" : "complete", unit.id);
  }

  return (
    <main className="mx-auto min-h-screen w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-10">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3"><Brand subtitle="學員專區" /><Link href={`/my${scopeSuffix()}`} className="text-sm text-brand-700 hover:underline">返回我的紀錄</Link></header>
      {loading && <p className="card p-8 text-center text-sm text-slate-500">載入學習內容…</p>}
      {!loading && error && <section className="card space-y-4 p-7 text-center"><h1 className="text-lg font-semibold text-slate-900">目前無法開啟學員專區</h1><p className="text-sm leading-6 text-slate-500">{error}</p><Link href={`/my${scopeSuffix()}`} className="btn btn-primary">前往我的紀錄</Link></section>}
      {!loading && data && <div className="space-y-6">
        <section className="rounded-2xl bg-gradient-to-br from-brand-700 to-brand-900 p-6 text-white"><p className="text-sm text-white/70">歡迎回來，{data.patient.name}</p><h1 className="mt-1 text-2xl font-bold">我的學習內容</h1><p className="mt-2 text-sm leading-6 text-white/80">只顯示已符合報名、付款或報到條件的教材。</p></section>
        {data.courses.length === 0 ? <section className="card p-8 text-center"><h2 className="font-semibold text-slate-900">目前沒有已開放教材</h2><p className="mt-2 text-sm leading-6 text-slate-500">完成課程要求後，教材會自動出現在這裡。</p></section> : data.courses.map((course) => {
          const completed = course.units.filter((unit) => unit.completed_at).length;
          return <section key={course.event_id} className="card overflow-hidden"><header className="border-b border-slate-100 p-5"><div className="flex items-end justify-between gap-3"><div><div className="eyebrow">已開放課程</div><h2 className="mt-1 text-xl font-bold text-slate-900">{course.title}</h2></div><span className="text-sm text-slate-500">{completed}／{course.units.length} 完成</span></div><div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${course.units.length ? Math.round((completed / course.units.length) * 100) : 0}%` }} /></div></header><div className="divide-y divide-slate-100">{course.units.map((unit, index) => <article key={unit.id} className="grid gap-4 p-5 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-start"><div className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-bold ${unit.completed_at ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{unit.completed_at ? "✓" : index + 1}</div><div className="min-w-0"><h3 className="font-semibold text-slate-900">{unit.title}</h3>{unit.summary && <p className="mt-1 text-sm leading-6 text-slate-500">{unit.summary}</p>}{unit.body && <div className="mt-3 whitespace-pre-wrap rounded-xl bg-slate-50 p-4 text-sm leading-7 text-slate-700">{unit.body}</div>}{unit.content_url && <a href={unit.content_url} target="_blank" rel="noreferrer" className="btn btn-secondary mt-3 inline-flex">{unitLabel(unit.unit_type)} ↗</a>}</div><button type="button" disabled={saving === unit.id} onClick={() => void toggle(unit)} className={`btn min-w-28 ${unit.completed_at ? "btn-secondary" : "btn-primary"}`}>{saving === unit.id ? "儲存中…" : unit.completed_at ? "標示未完成" : "標示完成"}</button></article>)}</div></section>;
        })}
      </div>}
    </main>
  );
}
