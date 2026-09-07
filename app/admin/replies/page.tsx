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
import LineReplySettingsEditor from "./LineReplySettingsEditor";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import type { MsgData, MsgKind } from "@/lib/lineMessage";

export const dynamic = "force-dynamic";

export default async function RepliesPage() {
  const { clinicId } = await requireAdmin();
  const supabase = await createSupabaseServer();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "line"))) return <ModuleDisabled title="LINE 自動回覆" />;
  const [{ data: replies }, { data: settings }, { data: msgs }, { data: clinic }] = await Promise.all([
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
    supabase.from("line_messages").select("id, name, kind, data").eq("clinic_id", clinicId).order("created_at"),
    supabase.from("clinics").select("name").eq("id", clinicId).maybeSingle(),
  ]);
  const s = settings as Record<string, unknown> | null;
  const messages = (msgs ?? []) as { id: string; name: string; kind: MsgKind; data: MsgData }[];
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

      <LineReplySettingsEditor
        action={updateLineTextsAction}
        clinicName={clinic?.name ?? "預約與報名平台"}
        initial={{
          welcomeText: settings?.line_welcome_text ?? "",
          fallbackText: settings?.line_fallback_text ?? "",
          menuTitle: (s?.line_menu_title as string) ?? "",
          booking: s?.line_menu_btn_booking !== false,
          query: s?.line_menu_btn_query !== false,
          progress: s?.line_menu_btn_progress !== false,
          info: s?.line_menu_btn_info !== false,
          linkLabel: (s?.line_menu_link_label as string) ?? "",
          linkUrl: (s?.line_menu_link_url as string) ?? "",
        }}
      />

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
