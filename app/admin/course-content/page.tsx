import { requireAdmin } from "@/lib/admin";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { SubmitButton } from "@/components/SubmitButton";
import { createCourseUnitAction, toggleCourseUnitAction } from "./actions";

export const dynamic = "force-dynamic";

interface EventRow { id: string; title: string; status: string; }
interface UnitRow {
  id: string;
  title: string;
  summary: string | null;
  unit_type: "video" | "link" | "download" | "text";
  access_rule: "registered" | "paid" | "attended";
  sort_order: number;
  active: boolean;
  events: { title: string } | { title: string }[] | null;
}

function relationTitle(value: UnitRow["events"]): string {
  return Array.isArray(value) ? value[0]?.title ?? "未命名課程" : value?.title ?? "未命名課程";
}

const TYPE_LABEL = { video: "影片", link: "外部連結", download: "下載檔案", text: "文字教材" } as const;
const ACCESS_LABEL = { registered: "完成報名後", paid: "完成付款後", attended: "完成報到後" } as const;

export default async function CourseContentPage() {
  const { supabase, clinicId } = await requireAdmin();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "events"))) {
    return <ModuleDisabled title="課程教材尚未啟用；請先開啟活動與報名模組" />;
  }
  const [{ data: events, error: eventsError }, { data: units, error: unitsError }] = await Promise.all([
    supabase.from("events").select("id, title, status").eq("clinic_id", clinicId).order("created_at", { ascending: false }),
    supabase.from("course_units").select("id, title, summary, unit_type, access_rule, sort_order, active, events(title)").eq("clinic_id", clinicId).order("sort_order").order("created_at"),
  ]);
  if (eventsError || unitsError) throw new Error(eventsError?.message ?? unitsError?.message ?? "教材載入失敗");
  const eventRows = (events ?? []) as EventRow[];
  const unitRows = (units ?? []) as unknown as UnitRow[];

  return (
    <div className="space-y-6">
      <header><div className="eyebrow">活動與報名</div><h1 className="text-2xl font-bold text-slate-900">課程教材</h1><p className="mt-1 text-sm leading-6 text-slate-500">把教材綁定既有課程，並設定學員要完成報名、付款或報到後才能查看。</p></header>
      <section className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
        <div className="card overflow-hidden">
          <div className="border-b border-slate-100 p-5"><h2 className="font-semibold text-slate-900">目前教材</h2><p className="mt-1 text-sm text-slate-500">順序數字越小，越早顯示。</p></div>
          {unitRows.length === 0 ? <p className="p-8 text-center text-sm text-slate-500">尚未建立教材單元。</p> : <div className="divide-y divide-slate-100">{unitRows.map((unit) => (
            <article key={unit.id} className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><span className="badge bg-brand-50 text-brand-700">{relationTitle(unit.events)}</span><span className="text-xs text-slate-400">#{unit.sort_order}</span></div><h3 className="mt-2 font-semibold text-slate-900">{unit.title}</h3>{unit.summary && <p className="mt-1 text-sm leading-6 text-slate-500">{unit.summary}</p>}<p className="mt-2 text-xs text-slate-400">{TYPE_LABEL[unit.unit_type]} · {ACCESS_LABEL[unit.access_rule]}</p></div>
              <form action={toggleCourseUnitAction}><input type="hidden" name="id" value={unit.id} /><input type="hidden" name="active" value={String(unit.active)} /><SubmitButton className="btn btn-secondary min-w-20">{unit.active ? "停用" : "啟用"}</SubmitButton></form>
            </article>
          ))}</div>}
        </div>
        <form action={createCourseUnitAction} className="card h-fit space-y-4 p-5">
          <div><h2 className="font-semibold text-slate-900">新增教材單元</h2><p className="mt-1 text-sm leading-6 text-slate-500">影片與檔案可填外部 HTTPS 網址；簡短內容可直接放文字。</p></div>
          <label className="block"><span className="label">所屬課程</span><select name="event_id" className="input" required defaultValue=""><option value="" disabled>請選擇課程</option>{eventRows.map((event) => <option key={event.id} value={event.id}>{event.title}{event.status !== "published" ? "（未發布）" : ""}</option>)}</select></label>
          <label className="block"><span className="label">單元名稱</span><input name="title" className="input" required maxLength={160} placeholder="例如：第 1 章｜建立學習目標" /></label>
          <label className="block"><span className="label">單元說明</span><textarea name="summary" className="input min-h-24" maxLength={500} placeholder="讓學員知道這一單元會完成什麼。" /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label><span className="label">教材類型</span><select name="unit_type" className="input" defaultValue="video"><option value="video">影片</option><option value="link">外部連結</option><option value="download">下載檔案</option><option value="text">文字教材</option></select></label><label><span className="label">開放條件</span><select name="access_rule" className="input" defaultValue="paid"><option value="registered">完成報名後</option><option value="paid">完成付款後</option><option value="attended">完成報到後</option></select></label></div>
          <label className="block"><span className="label">教材網址（選填）</span><input type="url" name="content_url" className="input" placeholder="https://…" /></label>
          <label className="block"><span className="label">文字內容（選填）</span><textarea name="body" className="input min-h-28" maxLength={10000} placeholder="課前提醒、作業說明或講義摘要。" /></label>
          <label className="block"><span className="label">顯示順序</span><input type="number" name="sort_order" min={0} max={999} defaultValue={10} className="input" /></label>
          <SubmitButton className="btn btn-primary w-full" disabled={eventRows.length === 0}>建立教材單元</SubmitButton>
          {eventRows.length === 0 && <p className="text-xs leading-5 text-amber-700">請先建立一項活動或課程。</p>}
        </form>
      </section>
    </div>
  );
}
