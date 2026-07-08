import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { buildThreads } from "@/lib/chatQueries";
import ChatConsole from "./ChatConsole";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const supabase = await createSupabaseServer();
  const threads = await buildThreads(supabase, CLINIC_ID);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-slate-900">線上客服</h1>
        <p className="text-sm text-slate-400">
          病患從預約頁的「線上客服」分頁留言,這裡即時收發。純系統內對話,不佔用 LINE 推播額度。
        </p>
      </div>
      <ChatConsole initialThreads={threads} />
    </div>
  );
}
