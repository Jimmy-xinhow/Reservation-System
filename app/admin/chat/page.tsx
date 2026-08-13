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
    return <p className="card p-6 text-sm text-slate-500">目前角色無法查看顧客訊息。</p>;
  }
  const supabase = await createSupabaseServer();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "line"))) return <ModuleDisabled title="訊息中心" />;
  const threads = await buildThreads(supabase, clinicId);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">線上客服</h1>
        <p className="text-sm text-slate-400">
          顧客從預約頁的「線上客服」分頁留言,這裡即時收發。純系統內對話,不佔用 LINE 推播額度。
        </p>
      </div>
      <ChatConsole initialThreads={threads} />
    </div>
  );
}
