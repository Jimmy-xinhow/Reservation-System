"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Brand } from "@/components/Brand";
import { formatAmount, formatEventDate, type PublicEvent } from "@/lib/registration";
import { createQrSvg } from "@/lib/qr";
import { trackFunnelEvent } from "@/lib/funnel-client";

interface EventSummary {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  cover_url: string | null;
  registration_open_at: string | null;
  registration_close_at: string | null;
}

interface RegistrationResult {
  registration_id: string;
  registration_no: string;
  registration_status: string;
  payment_status: string;
  amount: number;
  checkin_token: string;
  browser_token: string;
}

async function readApi<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as { ok?: boolean; data?: T; error?: string } | null;
  if (!body?.ok) throw new Error(body?.error ?? "伺服器回應異常");
  return body.data as T;
}

export default function RegisterPage() {
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [event, setEvent] = useState<PublicEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RegistrationResult | null>(null);
  const [clinicSlug, setClinicSlug] = useState<string | null>(null);
  const [clinicId, setClinicId] = useState<string | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const eventId = query.get("event");
    const requestedClinicSlug = query.get("clinic_slug");
    const requestedClinicId = query.get("clinic_id");
    const requestedAccessToken = query.get("access_token");
    trackFunnelEvent("registration_view");
    setClinicSlug(requestedClinicSlug);
    setClinicId(requestedClinicId);
    setAccessToken(requestedAccessToken);
    const load = async () => {
      try {
        if (eventId) {
          const params = new URLSearchParams();
          if (requestedClinicSlug) params.set("clinic_slug", requestedClinicSlug);
          else if (requestedClinicId) params.set("clinic_id", requestedClinicId);
          if (requestedAccessToken) params.set("access_token", requestedAccessToken);
          const suffix = params.toString() ? "?" + params.toString() : "";
          const data = await readApi<{ event: PublicEvent }>("/api/registration/events/" + encodeURIComponent(eventId) + suffix);
          setEvent(data.event);
        } else {
          const scope = requestedClinicSlug
            ? "clinic_slug=" + encodeURIComponent(requestedClinicSlug)
            : requestedClinicId
              ? "clinic_id=" + encodeURIComponent(requestedClinicId)
              : "";
          const listUrl = scope ? "/api/registration/events?" + scope : "/api/registration/events";
          const data = await readApi<{ events: EventSummary[] }>(listUrl);
          setEvents(data.events);
        }
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "活動讀取失敗");
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  if (loading) return <Centered>載入活動中…</Centered>;
  if (error) return <Centered tone="error">{error}</Centered>;
  if (result) return <Success result={result} clinicSlug={clinicSlug} clinicId={clinicId} accessToken={accessToken} />;

  if (!event) {
    return (
      <Shell>
        <header className="mb-5"><div className="eyebrow">Registration</div><h1 className="text-2xl font-bold text-slate-900">課程與活動</h1><p className="mt-1 text-sm leading-6 text-slate-500">選擇活動後，依場次與票種完成報名。</p></header>
        {events.length === 0 ? <div className="card p-8 text-center text-sm text-slate-400">目前沒有公開活動。</div> : <div className="space-y-3">{events.map((item) => <a key={item.id} href={`/register?event=${encodeURIComponent(item.id)}${clinicSlug ? `&clinic_slug=${encodeURIComponent(clinicSlug)}` : clinicId ? `&clinic_id=${encodeURIComponent(clinicId)}` : ""}`} className="card block p-5 transition hover:border-brand-300 hover:bg-brand-50"><h2 className="font-semibold text-slate-900">{item.title}</h2>{item.description && <p className="mt-2 line-clamp-2 text-sm leading-6 text-slate-500">{item.description}</p>}<p className="mt-3 text-xs text-slate-400">{item.registration_close_at ? `報名至 ${formatEventDate(item.registration_close_at)}` : "報名時間依活動公告"}</p></a>)}</div>}
      </Shell>
    );
  }
  return <RegistrationForm event={event} clinicSlug={clinicSlug} clinicId={clinicId} accessToken={accessToken} onSuccess={setResult} />;
}

function RegistrationForm({ event, clinicSlug, clinicId, accessToken, onSuccess }: { event: PublicEvent; clinicSlug: string | null; clinicId: string | null; accessToken: string | null; onSuccess: (result: RegistrationResult) => void }) {
  const [sessionId, setSessionId] = useState(event.sessions[0]?.id ?? "");
  const [ticketId, setTicketId] = useState(event.ticket_types[0]?.id ?? "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [discountCode, setDiscountCode] = useState("");
  const [membershipCode, setMembershipCode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const selectedTicket = useMemo(() => event.ticket_types.find((ticket) => ticket.id === ticketId) ?? null, [event.ticket_types, ticketId]);

  async function submit() {
    const missing = event.fields.find((field) => {
      const value = answers[field.field_key];
      return field.required && (value === undefined || value === "" || value === false);
    });
    if (missing) {
      setError(`請填寫${missing.label}`);
      return;
    }
    if (event.terms_text && !termsAccepted) {
      setError("請先閱讀並同意活動條款");
      return;
    }
    setSubmitting(true);
    trackFunnelEvent("registration_start", { event_id: event.id });
    setError(null);
    try {
      const registerUrl = clinicSlug
        ? "/api/registration/register?clinic_slug=" + encodeURIComponent(clinicSlug)
        : clinicId
          ? "/api/registration/register?clinic_id=" + encodeURIComponent(clinicId)
          : "/api/registration/register";
      const data = await readApi<RegistrationResult>(registerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event_id: event.id, session_id: sessionId, ticket_type_id: ticketId || null, name, phone, email, marketing_opt_in: marketingOptIn, terms_accepted: termsAccepted, answers, access_token: accessToken || undefined, discount_code: discountCode || undefined, membership_code: membershipCode || undefined }) });
      trackFunnelEvent("registration_success", { event_id: event.id });
      onSuccess(data);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "報名失敗");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Shell>
      <Link href={clinicSlug ? "/register?clinic_slug=" + encodeURIComponent(clinicSlug) : clinicId ? "/register?clinic_id=" + encodeURIComponent(clinicId) : "/register"} className="mb-4 inline-block text-sm text-slate-500 hover:text-brand-700">← 返回活動列表</Link>
      <article className="card overflow-hidden">
        {event.cover_url && <img src={event.cover_url} alt="" className="h-44 w-full object-cover" />}
        <div className="space-y-5 p-5 sm:p-7">
          <div><div className="eyebrow">{event.clinic_name}</div><h1 className="text-2xl font-bold text-slate-900">{event.title}</h1>{event.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{event.description}</p>}</div>
          <div className="space-y-4 border-t border-slate-100 pt-5">
            <label className="block text-sm"><span className="label">場次</span><select className="input" value={sessionId} onChange={(e) => setSessionId(e.target.value)}>{event.sessions.map((session) => <option key={session.id} value={session.id}>{session.name} · {formatEventDate(session.start_at)} · 容量 {session.capacity}</option>)}</select></label>
            {event.ticket_types.length > 0 && <label className="block text-sm"><span className="label">票種</span><select className="input" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>{event.ticket_types.map((ticket) => <option key={ticket.id} value={ticket.id}>{ticket.name} · {formatAmount(ticket.price)}</option>)}</select></label>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2"><label className="text-sm"><span className="label">姓名</span><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label><label className="text-sm"><span className="label">電話</span><input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" autoComplete="tel" /></label></div>
            <label className="block text-sm"><span className="label">Email（選填）</span><input className="input" value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" autoComplete="email" /></label>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className="text-sm"><span className="label">優惠碼（選填）</span><input className="input uppercase" value={discountCode} onChange={(e) => { setDiscountCode(e.target.value.toUpperCase()); setMembershipCode(""); }} autoComplete="off" /></label>
              <label className="text-sm"><span className="label">套票序號（選填）</span><input className="input uppercase" value={membershipCode} onChange={(e) => { setMembershipCode(e.target.value.toUpperCase()); setDiscountCode(""); }} autoComplete="off" /></label>
            </div>
            {(discountCode || membershipCode) && <p className="rounded-xl bg-brand-50 p-3 text-xs leading-5 text-brand-800">套票序號會扣除一堂額度；優惠碼會依活動票種規則折抵，兩者不可同時使用。</p>}
            {event.fields.map((field) => <RegistrationField key={field.id} field={field} value={answers[field.field_key]} onChange={(value) => setAnswers((current) => ({ ...current, [field.field_key]: value }))} />)}
            {event.terms_text && <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6 text-slate-600"><p className="font-medium text-slate-900">活動條款 v{event.terms_version}</p><p className="mt-2 whitespace-pre-wrap">{event.terms_text}</p><label className="mt-3 flex items-start gap-2"><input type="checkbox" className="mt-1.5" checked={termsAccepted} onChange={(e) => setTermsAccepted(e.target.checked)} />我已閱讀並同意活動條款</label></div>}
            <label className="flex items-start gap-2 text-sm leading-6 text-slate-600"><input type="checkbox" className="mt-1.5" checked={marketingOptIn} onChange={(e) => setMarketingOptIn(e.target.checked)} />同意接收品牌的活動與回訪訊息</label>
            {selectedTicket && selectedTicket.price > 0 && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">本票種需付款 {formatAmount(selectedTicket.price)}；送出報名後將進入標準金流付款。</p>}
            {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
            <button type="button" disabled={submitting || !sessionId || !name.trim() || !phone.trim()} onClick={() => void submit()} className="btn btn-primary w-full">{submitting ? "送出中…" : "送出報名"}</button>
          </div>
        </div>
      </article>
    </Shell>
  );
}

function RegistrationField({ field, value, onChange }: { field: PublicEvent["fields"][number]; value: unknown; onChange: (value: unknown) => void }) {
  const label = `${field.label}${field.required ? " *" : ""}`;
  if (field.field_type === "checkbox") return <label className="flex items-start gap-2 text-sm leading-6 text-slate-600"><input type="checkbox" className="mt-1.5" checked={value === true} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
  if (field.field_type === "textarea") return <label className="block text-sm"><span className="label">{label}</span><textarea className="input" rows={3} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /></label>;
  if (field.field_type === "select") return <label className="block text-sm"><span className="label">{label}</span><select className="input" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}><option value="">請選擇</option>{field.options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>;
  return <label className="block text-sm"><span className="label">{label}</span><input type={field.field_type === "date" ? "date" : "text"} className="input" value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} /></label>;
}

function Success({ result, clinicSlug, clinicId, accessToken }: { result: RegistrationResult; clinicSlug: string | null; clinicId: string | null; accessToken: string | null }) {
  return <Shell><SuccessCard result={result} clinicSlug={clinicSlug} clinicId={clinicId} accessToken={accessToken} /></Shell>;
}

function SuccessCard({ result, clinicSlug, clinicId, accessToken }: { result: RegistrationResult; clinicSlug: string | null; clinicId: string | null; accessToken: string | null }) {
  const [paying, setPaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qrSvg = useMemo(() => createQrSvg(result.checkin_token), [result.checkin_token]);

  useEffect(() => {
    try {
      window.localStorage.setItem(`registration:${result.registration_id}`, JSON.stringify({
        registration_no: result.registration_no,
        checkin_token: result.checkin_token,
      }));
      const scope = clinicSlug || clinicId || "default";
      window.localStorage.setItem(`customer_browser_token:${scope}`, result.browser_token);
      window.localStorage.setItem("membership_browser_token", result.browser_token);
    } catch {
      // 私密瀏覽或瀏覽器禁用儲存時，仍可使用目前頁面完成後續流程。
    }
  }, [result, clinicSlug, clinicId]);

  async function pay() {
    setPaying(true);
    setError(null);
    try {
      const paymentScope = clinicSlug
        ? "?clinic_slug=" + encodeURIComponent(clinicSlug)
        : clinicId
          ? "?clinic_id=" + encodeURIComponent(clinicId)
          : "";
      const data = await readApi<{ form: { action: string; fields: Record<string, string> } }>(`/api/payment/create${paymentScope}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ registration_id: result.registration_id, checkin_token: result.checkin_token, return_path: window.location.pathname + window.location.search }),
      });
      const form = document.createElement("form");
      form.method = "POST";
      form.action = data.form.action;
      form.style.display = "none";
      for (const [name, value] of Object.entries(data.form.fields)) {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      }
      document.body.appendChild(form);
      form.submit();
    } catch (payError) {
      setError(payError instanceof Error ? payError.message : "付款頁開啟失敗");
      setPaying(false);
    }
  }

  const brandHref = clinicSlug ? "/register?clinic_slug=" + encodeURIComponent(clinicSlug) : clinicId ? "/register?clinic_id=" + encodeURIComponent(clinicId) : "/register";
  const backHref = brandHref + (accessToken ? (brandHref.includes("?") ? "&" : "?") + "access_token=" + encodeURIComponent(accessToken) : "");
  const myHref = clinicSlug ? "/my?clinic_slug=" + encodeURIComponent(clinicSlug) : clinicId ? "/my?clinic_id=" + encodeURIComponent(clinicId) : "/my";
  return <div className="card overflow-hidden"><div className="bg-gradient-to-br from-brand-600 to-brand-800 p-7 text-center text-white"><div className="text-3xl">✓</div><h1 className="mt-2 text-xl font-bold">報名資料已送出</h1><p className="mt-1 text-sm text-white/80">報名編號與報到憑證已建立，也可在「我的紀錄」查看。</p></div><div className="space-y-4 p-6 text-center"><div className="rounded-xl bg-slate-50 p-4"><div className="text-xs text-slate-500">報名編號</div><div className="mt-1 font-mono text-xl font-bold text-slate-900">{result.registration_no}</div></div>{result.registration_status !== "waitlisted" && result.payment_status !== "pending" && <div className="mx-auto w-52 rounded-xl border border-slate-200 bg-white p-3" dangerouslySetInnerHTML={{ __html: qrSvg }} />}{result.registration_status !== "waitlisted" && <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50 p-4 text-left"><div className="text-xs text-brand-700">報到憑證（請勿轉傳）</div><code className="mt-2 block break-all text-xs text-slate-700">{result.checkin_token}</code></div>}{result.payment_status === "pending" && <div className="space-y-2"><button type="button" onClick={() => void pay()} disabled={paying} className="btn btn-primary w-full">{paying ? "正在前往付款…" : `前往付款（${formatAmount(result.amount)}）`}</button>{error && <p className="rounded-xl bg-red-50 p-3 text-left text-sm text-red-700">{error}</p>}</div>}<p className="text-sm text-slate-500">目前狀態：{result.registration_status === "waitlisted" ? "候補中" : result.payment_status === "pending" ? "待付款" : "已確認"}</p><Link href={myHref} className="btn btn-primary w-full">查看我的紀錄</Link><Link href={backHref} className="btn btn-secondary w-full">返回活動列表</Link></div></div>;
}

function Shell({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto min-h-screen w-full max-w-2xl px-4 py-6 sm:px-6 sm:py-10"><header className="mb-6"><Brand subtitle="課程與活動報名" /></header>{children}</main>;
}

function Centered({ children, tone }: { children: React.ReactNode; tone?: "error" }) {
  return <main className="flex min-h-screen items-center justify-center p-6 text-center"><p className={tone === "error" ? "text-red-600" : "text-slate-500"}>{children}</p></main>;
}
