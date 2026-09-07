import { createSupabaseServer } from "@/lib/supabase-server";
import { requireNonProvider } from "@/lib/admin";
import { buildThreads } from "@/lib/chatQueries";
import ChatConsole from "./ChatConsole";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const { clinicId, role } = await requireNonProvider();
  if (role === "provider") {
    return <p className="admin-section p-6 text-sm text-slate-500">目前角色無法查看顧客訊息。</p>;
  }
  const supabase = await createSupabaseServer();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "line"))) return <ModuleDisabled title="訊息中心" />;
  const threads = await buildThreads(supabase, clinicId);

  return (
    <div className="admin-page">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">顧客訊息</p>
          <h1 className="admin-page-title">線上客服</h1>
          <p className="admin-page-description">集中回覆顧客從預約頁送出的訊息。這是平台內對話，不會占用 LINE 主動推播額度。</p>
        </div>
      </header>
      <ChatConsole initialThreads={threads} />
    </div>
  );
}
