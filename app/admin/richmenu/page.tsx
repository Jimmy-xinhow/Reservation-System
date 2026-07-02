import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { LAYOUTS, type Layout, type Slot } from "@/lib/richmenu";
import { saveRichMenuAction, unpublishRichMenuAction } from "../actions";
import RichMenuEditor from "./RichMenuEditor";
import PublishForm from "./PublishForm";

export const dynamic = "force-dynamic";

export default async function RichMenuPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; ok?: string; saved?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("line_richmenu")
    .select("layout, chat_bar_text, slots, published_id")
    .eq("clinic_id", CLINIC_ID)
    .maybeSingle();

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

      <RichMenuEditor
        initialLayout={layout}
        initialChatBar={chatBar}
        initialSlots={slots}
        saveAction={saveRichMenuAction}
      />

      {/* 上傳圖片(自動裁尺寸)+ 發布 */}
      <PublishForm width={spec.width} height={spec.height} disabled={!lineReady} />
      <p className="-mt-4 text-xs text-slate-400">提醒:請先按上方「儲存選單設定」,再上傳圖片發布。</p>

      {publishedId && (
        <form action={unpublishRichMenuAction} className="card p-5">
          <p className="mb-3 text-sm text-slate-600">移除後,病患聊天室下方將不再顯示圖文選單。</p>
          <button className="btn btn-danger">移除圖文選單</button>
        </form>
      )}
    </div>
  );
}
