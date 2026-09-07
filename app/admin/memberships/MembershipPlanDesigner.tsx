"use client";

import { useMemo, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";

export interface MembershipPlanDesign {
  id: string;
  name: string;
  description: string | null;
  price: number;
  credits_total: number;
  valid_days: number | null;
  usage_scope: string;
  service_id: string | null;
  card_image_url: string | null;
  card_theme: string;
  card_accent: string;
  redeem_channels: string[];
  redemption_note: string | null;
}

interface ServiceOption { id: string; name: string; }
const THEMES: Record<string, { background: string; color: string; muted: string }> = {
  forest: { background: "linear-gradient(135deg,#12362f,#1d6a58)", color: "#f6f3e9", muted: "#c8ddd5" },
  ink: { background: "linear-gradient(135deg,#172033,#34415c)", color: "#f8fafc", muted: "#cbd5e1" },
  clay: { background: "linear-gradient(135deg,#824f43,#c27a64)", color: "#fff8f3", muted: "#f1d6cd" },
  sand: { background: "linear-gradient(135deg,#d7c29f,#f2eadb)", color: "#29261f", muted: "#665f53" },
};
const DEFAULT_CHANNELS = ["appointment", "registration"];

export function MembershipPlanDesigner({ plans, services, action }: { plans: MembershipPlanDesign[]; services: ServiceOption[]; action: (fd: FormData) => Promise<void> }) {
  const empty = useMemo<MembershipPlanDesign>(() => ({ id: "", name: "", description: "", price: 0, credits_total: 8, valid_days: 90, usage_scope: "both", service_id: "", card_image_url: "", card_theme: "forest", card_accent: "#176B57", redeem_channels: DEFAULT_CHANNELS, redemption_note: "" }), []);
  const [draft, setDraft] = useState<MembershipPlanDesign>(empty);
  const theme = THEMES[draft.card_theme] ?? THEMES.forest;
  const channels = draft.redeem_channels.length ? draft.redeem_channels : DEFAULT_CHANNELS;
  const update = <K extends keyof MembershipPlanDesign>(key: K, value: MembershipPlanDesign[K]) => setDraft((current) => ({ ...current, [key]: value }));
  const toggleChannel = (channel: string) => setDraft((current) => ({ ...current, redeem_channels: current.redeem_channels.includes(channel) ? current.redeem_channels.filter((item) => item !== channel) : [...current.redeem_channels, channel] }));
  const choose = (id: string) => setDraft(id ? plans.find((plan) => plan.id === id) ?? empty : empty);

  return <section className="admin-section overflow-hidden">
    <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">套票外觀與使用設計</h2><p className="mt-0.5 text-xs text-slate-500">左側修改內容，右側立即預覽顧客看到的卡面。</p></div></div>
    <div className="grid gap-0 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
      <form action={action} className="grid gap-3 border-b border-slate-200 p-4 sm:grid-cols-2 xl:border-b-0 xl:border-r">
        <label className="text-sm sm:col-span-2"><span className="label">新增或編輯</span><select className="input" value={draft.id} onChange={(event) => choose(event.target.value)}><option value="">建立新套票</option>{plans.map((plan) => <option key={plan.id} value={plan.id}>編輯：{plan.name}</option>)}</select></label>
        <input type="hidden" name="plan_id" value={draft.id} />
        <label className="text-sm sm:col-span-2"><span className="label">方案名稱</span><input name="name" required className="input" value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：私人課 8 堂套票" /></label>
        <label className="text-sm"><span className="label">價格</span><input name="price" type="number" min="0" required className="input" value={draft.price} onChange={(event) => update("price", Number(event.target.value))} /></label>
        <label className="text-sm"><span className="label">可兌換次數</span><input name="credits_total" type="number" min="1" required className="input" value={draft.credits_total} onChange={(event) => update("credits_total", Number(event.target.value))} /></label>
        <label className="text-sm"><span className="label">有效天數</span><input name="valid_days" type="number" min="1" className="input" value={draft.valid_days ?? ""} onChange={(event) => update("valid_days", event.target.value ? Number(event.target.value) : null)} /></label>
        <label className="text-sm"><span className="label">自動扣抵範圍</span><select name="usage_scope" className="input" value={draft.usage_scope} onChange={(event) => update("usage_scope", event.target.value)}><option value="both">預約與活動報名</option><option value="appointment">僅預約</option><option value="registration">僅活動報名</option></select></label>
        <label className="text-sm sm:col-span-2"><span className="label">指定服務（選填）</span><select name="service_id" className="input" value={draft.service_id ?? ""} onChange={(event) => update("service_id", event.target.value)}><option value="">所有服務</option>{services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}</select></label>
        <label className="text-sm sm:col-span-2"><span className="label">方案說明</span><textarea name="description" rows={2} className="input" value={draft.description ?? ""} onChange={(event) => update("description", event.target.value)} /></label>
        <fieldset className="sm:col-span-2"><legend className="label">可使用場景</legend><div className="grid gap-2 sm:grid-cols-3">{[["appointment","預約服務"],["registration","活動報名"],["course","課程購買"],["product","商品兌換"],["offline","線下兌換"]].map(([value,label]) => <label key={value} className="flex items-center gap-2 border border-slate-200 px-3 py-2 text-sm"><input type="checkbox" name="redeem_channels" value={value} checked={channels.includes(value)} onChange={() => toggleChannel(value)} />{label}</label>)}</div><p className="help-text mt-1 block">預約與報名可自動扣抵；課程、商品及線下用途由營運人員在套票清單記錄兌換。</p></fieldset>
        <label className="text-sm"><span className="label">卡面風格</span><select name="card_theme" className="input" value={draft.card_theme} onChange={(event) => update("card_theme", event.target.value)}><option value="forest">深綠</option><option value="ink">墨藍</option><option value="clay">陶土</option><option value="sand">暖沙</option></select></label>
        <label className="text-sm"><span className="label">識別色</span><input name="card_accent" type="color" className="input h-11 p-1" value={draft.card_accent} onChange={(event) => update("card_accent", event.target.value)} /></label>
        <label className="text-sm sm:col-span-2"><span className="label">卡面圖片網址（選填）</span><input name="card_image_url" type="url" className="input" value={draft.card_image_url ?? ""} onChange={(event) => update("card_image_url", event.target.value)} placeholder="https://..." /></label>
        <label className="text-sm sm:col-span-2"><span className="label">兌換說明（選填）</span><input name="redemption_note" className="input" value={draft.redemption_note ?? ""} onChange={(event) => update("redemption_note", event.target.value)} placeholder="例如：商品兌換請洽櫃檯" /></label>
        <div className="sm:col-span-2"><SubmitButton className="btn btn-primary">{draft.id ? "儲存套票變更" : "建立套票方案"}</SubmitButton></div>
      </form>
      <div className="flex items-center justify-center bg-slate-50 p-5">
        <div className="relative aspect-[1.58/1] w-full max-w-md overflow-hidden rounded-[22px] p-6 shadow-[0_18px_45px_rgba(15,23,42,.18)]" style={{ background: theme.background, color: theme.color }}>
          {draft.card_image_url && <div className="absolute inset-0 bg-cover bg-center opacity-25" style={{ backgroundImage: `url(${draft.card_image_url})` }} />}
          <div className="relative flex h-full flex-col justify-between"><div className="flex items-start justify-between gap-4"><div><span className="text-[10px] font-semibold tracking-[.18em]" style={{ color: draft.card_accent }}>MEMBERSHIP PASS</span><h3 className="mt-3 text-xl font-semibold leading-tight">{draft.name || "套票方案名稱"}</h3></div><span className="border px-2 py-1 text-xs" style={{ borderColor: `${draft.card_accent}99` }}>{draft.credits_total || 0} 次</span></div><div><p className="line-clamp-2 text-sm leading-6" style={{ color: theme.muted }}>{draft.description || "在這裡預覽方案說明與品牌卡面。"}</p><div className="mt-4 flex items-end justify-between gap-3"><strong className="text-lg">NT${Number(draft.price || 0).toLocaleString("zh-TW")}</strong><span className="text-xs" style={{ color: theme.muted }}>{draft.valid_days ? `${draft.valid_days} 天有效` : "不限期"}</span></div></div></div>
        </div>
      </div>
    </div>
  </section>;
}
