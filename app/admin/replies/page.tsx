import { createSupabaseServer } from "@/lib/supabase-server";
import {
  createReplyAction,
  updateReplyAction,
  toggleReplyAction,
  deleteReplyAction,
  updateLineTextsAction,
} from "../line-actions";
import { requireAdmin } from "@/lib/admin";
import RepliesEditor, { type Reply } from "./RepliesEditor";
import { SubmitButton } from "@/components/SubmitButton";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";

export const dynamic = "force-dynamic";

export default async function RepliesPage() {
  const { clinicId } = await requireAdmin();
  const supabase = await createSupabaseServer();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "line"))) return <ModuleDisabled title="LINE 自動回覆" />;
  const [{ data: replies }, { data: settings }, { data: msgs }] = await Promise.all([
    supabase
      .from("line_auto_replies")
      .select("id, keywords, action, reply_text, message_id, sort, active")
      .eq("clinic_id", clinicId)
      .order("sort"),
    supabase
      .from("clinic_settings")
      .select(
        "line_welcome_text, line_fallback_text, line_menu_title, line_menu_btn_booking, line_menu_btn_query, line_menu_btn_progress, line_menu_btn_info, line_menu_link_label, line_menu_link_url",
      )
      .eq("clinic_id", clinicId)
      .maybeSingle(),
    supabase.from("line_messages").select("id, name").eq("clinic_id", clinicId).order("created_at"),
  ]);
  const s = settings as Record<string, unknown> | null;
  const messages = (msgs ?? []) as { id: string; name: string }[];
  const replyRows = (replies ?? []) as Reply[];
  const activeRules = replyRows.filter((reply) => reply.active).length;

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">LINE 互動</p>
          <h1 className="admin-page-title">自動回覆設定</h1>
          <p className="admin-page-description">設定顧客輸入關鍵字後立即收到的內容。這類即時回覆不會計入 LINE 主動推播額度。</p>
        </div>
      </header>

      <section className="admin-metric-strip grid-cols-3" aria-label="自動回覆摘要">
        <div className="admin-metric"><span className="admin-metric-label">啟用規則</span><strong className="admin-metric-value">{activeRules}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">全部規則</span><strong className="admin-metric-value">{replyRows.length}</strong></div>
        <div className="admin-metric"><span className="admin-metric-label">訊息素材</span><strong className="admin-metric-value">{messages.length}</strong></div>
      </section>

      <form action={updateLineTextsAction} className="admin-section">
        <div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">歡迎詞與找不到指令時的回覆</h2><p className="mt-0.5 text-xs text-slate-500">留空會使用系統預設內容，不影響下方關鍵字規則。</p></div></div>
        <div className="grid gap-4 p-4 lg:grid-cols-2">
        <label className="block text-sm">
          <span className="label">加好友歡迎訊息</span>
          <textarea
            name="line_welcome_text"
            rows={2}
            defaultValue={settings?.line_welcome_text ?? ""}
            placeholder="留空則用系統預設歡迎詞"
            className="input"
          />
        </label>
        <label className="block text-sm">
          <span className="label">找不到對應指令時的回覆</span>
          <textarea
            name="line_fallback_text"
            rows={2}
            defaultValue={settings?.line_fallback_text ?? ""}
            placeholder="留空則用系統預設選單提示"
            className="input"
          />
        </label>

        <details className="technical-details lg:col-span-2">
          <summary>進階設定：主選單卡片按鈕</summary>
          <div className="mt-3 border-y border-slate-200 bg-slate-50 p-4">
          <label className="mb-3 block text-sm">
            <span className="label">卡片標題（留空使用預設）</span>
            <input name="line_menu_title" defaultValue={(s?.line_menu_title as string) ?? ""} className="input" />
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[
              ["line_menu_btn_booking", "立即預約"],
              ["line_menu_btn_query", "查詢預約"],
              ["line_menu_btn_progress", "服務進度"],
              ["line_menu_btn_info", "品牌資訊"],
            ].map(([name, label]) => (
              <label key={name} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  name={name}
                  defaultChecked={s?.[name] !== false}
                  className="h-4 w-4 accent-brand-600"
                />
                {label}
              </label>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-sm">
              <span className="label">自訂按鈕文字（選填）</span>
              <input name="line_menu_link_label" defaultValue={(s?.line_menu_link_label as string) ?? ""} placeholder="例:官方網站" className="input" />
            </label>
            <label className="text-sm">
              <span className="label">自訂按鈕連結</span>
              <input name="line_menu_link_url" defaultValue={(s?.line_menu_link_url as string) ?? ""} placeholder="https://..." className="input" />
            </label>
          </div>
          </div>
        </details>

        <div className="lg:col-span-2"><SubmitButton className="btn btn-primary">儲存歡迎與預設回覆</SubmitButton></div>
        </div>
      </form>

      <RepliesEditor
        replies={replyRows}
        messages={messages}
        createAction={createReplyAction}
        updateAction={updateReplyAction}
        toggleAction={toggleReplyAction}
        deleteAction={deleteReplyAction}
      />
    </div>
  );
}
