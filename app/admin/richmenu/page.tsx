import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { LAYOUTS, type Layout, type Slot } from "@/lib/richmenu";
import { saveRichMenuAction, unpublishRichMenuAction } from "../actions";
import RichMenuEditor from "./RichMenuEditor";
import PublishForm from "./PublishForm";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

export default async function RichMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string; saved?: string }>;
}) {
  await requireAdmin();
  const sp = await searchParams;
  const supabase = await createSupabaseServer();
  const [{ data }, { data: msgs }] = await Promise.all([
    supabase
      .from("line_richmenu")
      .select("layout, chat_bar_text, slots, published_id")
      .eq("clinic_id", CLINIC_ID)
      .maybeSingle(),
    supabase.from("line_messages").select("id, name").eq("clinic_id", CLINIC_ID).order("created_at"),
  ]);
  const messages = (msgs ?? []) as { id: string; name: string }[];

  const layout = (data?.layout as Layout) ?? "full-3";
  const chatBar = (data?.chat_bar_text as string) ?? "選單";
  const slots = (data?.slots as Slot[]) ?? [];
  const publishedId = (data?.published_id as string | null) ?? null;
  const spec = LAYOUTS[layout] ?? LAYOUTS["full-3"];
  const lineReady = !!process.env.LINE_CHANNEL_ACCESS_TOKEN;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">圖文選單(Rich Menu)</h1>
        <p className="text-sm text-slate-400">
          設定官方帳號聊天室下方的常駐大選單。設定好版型與按鈕、上傳對應尺寸圖片即可發布。
        </p>
      </div>

      {sp.err && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">發布失敗:{sp.err}</p>
      )}
      {sp.ok && (
        <p className="rounded-xl bg-accent-500/10 px-4 py-3 text-sm text-accent-600">已成功發布圖文選單 ✓</p>
      )}
      {sp.saved && (
        <p className="rounded-xl bg-accent-500/10 px-4 py-3 text-sm text-accent-600">選單設定已儲存 ✓</p>
      )}

      {!lineReady && (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-700">
          尚未設定 LINE_CHANNEL_ACCESS_TOKEN,無法發布圖文選單。
        </p>
      )}

      <div className="flex items-center gap-3">
        <span className="text-sm text-slate-500">目前狀態:</span>
        {publishedId ? (
          <span className="badge bg-accent-500/10 text-accent-600">已發布</span>
        ) : (
          <span className="badge bg-slate-100 text-slate-500">未發布</span>
        )}
      </div>

      {publishedId && (
        <div className="card p-4">
          <div className="mb-2 text-sm font-medium text-slate-600">目前已發布的選單圖</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/admin/richmenu-image?v=${encodeURIComponent(publishedId)}`}
            alt="已發布的圖文選單"
            className="w-full max-w-xl rounded-lg border border-slate-200"
          />
        </div>
      )}

      <RichMenuEditor
        initialLayout={layout}
        initialChatBar={chatBar}
        initialSlots={slots}
        messages={messages}
        saveAction={saveRichMenuAction}
      />

      {/* ④ 背景圖片(自動裁尺寸)+ 發布 */}
      <PublishForm width={spec.width} height={spec.height} disabled={!lineReady} />
      <p className="-mt-4 text-xs text-slate-400">
        首次:①②③ 設好 → 按「儲存選單設定」→ 到 ④ 上傳背景圖並發布。
        之後只要改動作/格數,按「儲存選單設定」就會用現有背景圖**自動更新**已發布的選單(要換圖才需重新到 ④ 上傳)。
      </p>

      {publishedId && (
        <form action={unpublishRichMenuAction} className="card p-5">
          <p className="mb-3 text-sm text-slate-600">移除後,病患聊天室下方將不再顯示圖文選單。</p>
          <button className="btn btn-danger">移除圖文選單</button>
        </form>
      )}
    </div>
  );
}
