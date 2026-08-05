import { requireNonProvider } from "@/lib/admin";
import { SubmitButton } from "@/components/SubmitButton";
import { formatAmount, formatEventDate, type EventStatus } from "@/lib/registration";
import { addRegistrationFieldAction, createEventAction, createEventSessionAction, createTicketTypeAction, regeneratePrivateEventLinkAction, setEventStatusAction } from "./actions";

export const dynamic = "force-dynamic";

interface EventRow {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: EventStatus;
  access_mode: "public" | "private";
}
interface SessionRow {
  id: string;
  event_id: string;
  name: string;
  start_at: string;
  end_at: string;
  venue: string | null;
  capacity: number;
  waitlist_enabled: boolean;
}
interface TicketRow {
  id: string;
  event_id: string;
  name: string;
  price: number;
  capacity: number | null;
  membership_plan_id: string | null;
}
interface MembershipPlanRow { id: string; name: string; credits_total: number; }
interface FormRow { id: string; event_id: string; version: number; status: string; }
interface FieldRow { id: string; form_id: string; field_key: string; label: string; field_type: string; required: boolean; options: string[]; }

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ private_event?: string; private_token?: string }> }) {
const { supabase, clinicId, role } = await requireNonProvider();
  const query = await searchParams;
  const [{ data: events, error: eventsError }, { data: sessions, error: sessionsError }, { data: tickets, error: ticketsError }, { data: forms, error: formsError }, { data: fields, error: fieldsError }, { data: clinicData, error: clinicError }, { data: membershipPlans, error: membershipPlansError }] = await Promise.all([
    supabase.from("events").select("id, slug, title, description, status, access_mode").eq("clinic_id", clinicId).order("created_at", { ascending: false }),
    supabase.from("event_sessions").select("id, event_id, name, start_at, end_at, venue, capacity, waitlist_enabled").eq("clinic_id", clinicId).order("start_at"),
    supabase.from("event_ticket_types").select("id, event_id, name, price, capacity, membership_plan_id").eq("clinic_id", clinicId).eq("active", true).order("price"),
    supabase.from("registration_forms").select("id, event_id, version, status").eq("clinic_id", clinicId).eq("status", "published").order("version", { ascending: false }),
    supabase.from("registration_form_fields").select("id, form_id, field_key, label, field_type, required, options").eq("clinic_id", clinicId).order("sort_order"),
    supabase.from("clinics").select("slug").eq("id", clinicId).maybeSingle(),
    supabase.from("membership_plans").select("id, name, credits_total").eq("clinic_id", clinicId).eq("active", true).order("name"),
  ]);
  if (eventsError || sessionsError || ticketsError || formsError || fieldsError || clinicError) throw new Error(eventsError?.message ?? sessionsError?.message ?? ticketsError?.message ?? formsError?.message ?? fieldsError?.message ?? clinicError?.message ?? "活動資料讀取失敗");
  if (membershipPlansError) throw new Error(membershipPlansError.message);
  const eventRows = (events ?? []) as EventRow[];
  const sessionRows = (sessions ?? []) as SessionRow[];
  const ticketRows = (tickets ?? []) as TicketRow[];
  const formRows = (forms ?? []) as FormRow[];
  const fieldRows = (fields ?? []) as FieldRow[];
  const membershipPlanRows = (membershipPlans ?? []) as MembershipPlanRow[];
  const canEdit = role === "owner" || role === "admin";
  const clinicSlug = typeof clinicData?.slug === "string" ? clinicData.slug : null;
  const privateLink = query.private_event && query.private_token
    ? `/register?event=${encodeURIComponent(query.private_event)}${clinicSlug ? `&clinic_slug=${encodeURIComponent(clinicSlug)}` : ""}&access_token=${encodeURIComponent(query.private_token)}`
    : null;

  return (
    <div className="space-y-6">
      <div>
        <div className="eyebrow">Registration</div>
        <h1 className="text-2xl font-bold text-slate-900">課程與活動報名</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">建立活動、場次與票種；公開後，顧客可從瀏覽器、LIFF 或嵌入入口完成報名。</p>
      </div>

      {privateLink && <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><p className="font-medium">私密報名連結已產生</p><p className="mt-1 break-all text-xs leading-5">請只分享給指定對象；重新產生後，舊連結會失效。</p><a href={privateLink} className="mt-3 inline-block font-medium underline" target="_blank" rel="noreferrer">開啟私密報名頁</a></div>}

      {canEdit && (
        <section className="card space-y-4 p-5">
          <div><h2 className="font-semibold text-slate-900">建立活動</h2><p className="mt-1 text-sm text-slate-500">先建立草稿，再補場次與票種，確認內容後才發布。</p></div>
          <form action={createEventAction} className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="text-sm"><span className="label">活動名稱</span><input name="title" required className="input" placeholder="例如：春季體驗課" /></label>
            <label className="text-sm"><span className="label">網址代稱</span><input name="slug" required className="input" placeholder="spring-class" /></label>
            <label className="text-sm"><span className="label">報名頁</span><select name="access_mode" className="input"><option value="public">公開活動</option><option value="private">私密連結活動</option></select></label>
            <label className="text-sm"><span className="label">開放報名（選填）</span><input name="registration_open_at" type="datetime-local" className="input" /></label>
            <label className="text-sm"><span className="label">截止報名（選填）</span><input name="registration_close_at" type="datetime-local" className="input" /></label>
            <label className="text-sm md:col-span-2"><span className="label">活動說明</span><textarea name="description" rows={3} className="input" placeholder="活動內容、注意事項與參加說明" /></label>
            <div className="md:col-span-2"><SubmitButton className="btn btn-primary">建立草稿</SubmitButton></div>
          </form>
        </section>
      )}

      <div className="space-y-5">
        {eventRows.length === 0 ? <div className="card p-8 text-center text-sm text-slate-400">尚未建立活動。</div> : eventRows.map((event) => {
          const eventSessions = sessionRows.filter((session) => session.event_id === event.id);
          const eventTickets = ticketRows.filter((ticket) => ticket.event_id === event.id);
          const eventForm = formRows.find((form) => form.event_id === event.id);
          const eventFields = eventForm ? fieldRows.filter((field) => field.form_id === eventForm.id) : [];
          return (
            <section key={event.id} data-membership-plan-count={membershipPlanRows.length} className="card overflow-hidden">
              <div className="border-b border-slate-100 p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-semibold text-slate-900">{event.title}</h2><StatusBadge status={event.status} /><span className="badge bg-slate-100 text-slate-600">{event.access_mode === "private" ? "私密連結" : "公開"}</span></div><p className="mt-1 text-xs text-slate-400">/{event.slug}</p>{event.description && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{event.description}</p>}</div>
                  <div className="flex flex-wrap gap-2">
                    {event.status === "published" && event.access_mode === "public" && <a className="btn btn-secondary text-xs" href={`/register?event=${encodeURIComponent(event.id)}${clinicSlug ? `&clinic_slug=${encodeURIComponent(clinicSlug)}` : ""}`}>查看報名頁</a>}
                    {canEdit && event.access_mode === "private" && <form action={regeneratePrivateEventLinkAction}><input type="hidden" name="id" value={event.id} /><SubmitButton className="btn btn-secondary text-xs">重新產生私密連結</SubmitButton></form>}
                    {canEdit && event.status !== "archived" && <form action={setEventStatusAction}><input type="hidden" name="id" value={event.id} /><input type="hidden" name="status" value={event.status === "published" ? "draft" : "published"} /><SubmitButton className="btn btn-secondary text-xs">{event.status === "published" ? "取消發布" : "發布活動"}</SubmitButton></form>}
                  </div>
                </div>
              </div>
              <div className="grid gap-5 p-5 lg:grid-cols-2">
                <div><h3 className="mb-3 font-medium text-slate-800">場次</h3>{eventSessions.length === 0 ? <p className="text-sm text-slate-400">尚未建立場次。</p> : <div className="space-y-2">{eventSessions.map((session) => <div key={session.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm"><div className="font-medium text-slate-800">{session.name}</div><div className="mt-1 text-slate-500">{formatEventDate(session.start_at)}－{formatEventDate(session.end_at)}</div><div className="mt-1 text-xs text-slate-400">{session.venue || "未設定地點"} · 容量 {session.capacity} · {session.waitlist_enabled ? "開放候補" : "不開放候補"}</div></div>)}</div>}
                  {canEdit && <form action={createEventSessionAction} className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-dashed border-slate-200 p-3 sm:grid-cols-2"><input type="hidden" name="event_id" value={event.id} /><input name="name" required className="input text-sm" placeholder="場次名稱" /><input name="venue" className="input text-sm" placeholder="地點" /><input name="start_at" type="datetime-local" required className="input text-sm" /><input name="end_at" type="datetime-local" required className="input text-sm" /><input name="capacity" type="number" min="1" defaultValue="20" required className="input text-sm" /><label className="flex items-center gap-2 text-sm text-slate-600"><input name="waitlist_enabled" type="checkbox" defaultChecked />開放候補</label><div className="sm:col-span-2"><SubmitButton className="btn btn-secondary text-xs">新增場次</SubmitButton></div></form>}
                </div>
                <div><h3 className="mb-3 font-medium text-slate-800">票種</h3>{eventTickets.length === 0 ? <p className="text-sm text-slate-400">未建立票種時，報名頁會使用免費預設票種。</p> : <div className="space-y-2">{eventTickets.map((ticket) => <div key={ticket.id} className="flex items-center justify-between rounded-xl border border-slate-100 bg-slate-50 p-3 text-sm"><span className="font-medium text-slate-800">{ticket.name}</span><span className="text-slate-500">{formatAmount(ticket.price)} · {ticket.capacity ? `限 ${ticket.capacity} 人` : "依場次容量"}</span></div>)}</div>}
                  {canEdit && <form action={createTicketTypeAction} className="mt-4 grid grid-cols-1 gap-2 rounded-xl border border-dashed border-slate-200 p-3 sm:grid-cols-3"><input type="hidden" name="event_id" value={event.id} /><input name="name" required className="input text-sm" placeholder="票種名稱" /><input name="price" type="number" min="0" defaultValue="0" className="input text-sm" placeholder="價格" /><input name="capacity" type="number" min="1" className="input text-sm" placeholder="票種上限（選填）" /><select name="membership_plan_id" className="input text-sm"><option value="">不限套票方案</option>{membershipPlanRows.map((plan) => <option key={plan.id} value={plan.id}>{plan.name}（{plan.credits_total} 堂）</option>)}</select><div className="sm:col-span-3"><SubmitButton className="btn btn-secondary text-xs">新增票種</SubmitButton></div></form>}
                </div>
              </div>
              <div className="border-t border-slate-100 p-5"><h3 className="mb-2 font-medium text-slate-800">報名表單 · v{eventForm?.version ?? 1}</h3>{eventFields.length === 0 ? <p className="text-sm text-slate-400">目前只有姓名、電話與 Email 基本欄位。</p> : <div className="mb-3 flex flex-wrap gap-2">{eventFields.map((field) => <span key={field.id} className="badge bg-brand-50 text-brand-700">{field.label}{field.required ? " · 必填" : ""}</span>)}</div>}{canEdit && <form action={addRegistrationFieldAction} className="grid grid-cols-1 gap-2 rounded-xl border border-dashed border-slate-200 p-3 sm:grid-cols-5"><input type="hidden" name="event_id" value={event.id} /><input name="field_key" required className="input text-sm" placeholder="欄位 key" /><input name="label" required className="input text-sm" placeholder="顯示名稱" /><select name="field_type" className="input text-sm"><option value="text">文字</option><option value="textarea">長文字</option><option value="date">日期</option><option value="select">選單</option><option value="checkbox">勾選</option></select><input name="options" className="input text-sm" placeholder="選單選項（逗號分隔）" /><label className="flex items-center gap-2 text-sm text-slate-600"><input name="required" type="checkbox" />必填</label><div className="sm:col-span-5"><SubmitButton className="btn btn-secondary text-xs">新增欄位並建立新版本</SubmitButton></div></form>}</div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: EventStatus }) {
  const labels: Record<EventStatus, string> = { draft: "草稿", published: "已發布", archived: "已封存" };
  return <span className={`badge ${status === "published" ? "bg-accent-500/10 text-accent-700" : status === "archived" ? "bg-slate-100 text-slate-500" : "bg-amber-50 text-amber-700"}`}>{labels[status]}</span>;
}
