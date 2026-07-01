import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { saveMessageAction, deleteMessageAction } from "../actions";
import MessageComposer from "./MessageComposer";
import type { MsgKind, MsgData } from "@/lib/lineMessage";

export const dynamic = "force-dynamic";

const KIND_LABEL: Record<string, string> = {
  text: "文字",
  card: "圖文卡",
  carousel: "多頁",
};

interface Msg {
  id: string;
  name: string;
  kind: MsgKind;
  data: MsgData;
}

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const { edit } = await searchParams;
  const supabase = await createSupabaseServer();
  const { data } = await supabase
    .from("line_messages")
    .select("id, name, kind, data")
    .eq("clinic_id", CLINIC_ID)
    .order("created_at", { ascending: false });
  const messages = (data ?? []) as Msg[];
  const editing = edit ? messages.find((m) => m.id === edit) ?? null : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">訊息素材</h1>
        <p className="text-sm text-slate-400">
          製作文字 / 圖文卡 / 多頁訊息,於「LINE 回覆」把關鍵字綁到這些訊息即可自動回覆。
        </p>
      </div>

      <MessageComposer key={editing?.id ?? "new"} initial={editing} saveAction={saveMessageAction} />
      {editing && (
        <Link href="/admin/messages" className="inline-block text-sm text-slate-400 hover:text-brand-600">
          ← 取消編輯,回到新增
        </Link>
      )}

      <div className="card overflow-x-auto">
        <table className="tbl">
          <thead>
            <tr>
              <th>名稱</th>
              <th>類型</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {messages.length === 0 && (
              <tr>
                <td colSpan={3} className="py-8 text-center text-slate-400">
                  尚無訊息素材
                </td>
              </tr>
            )}
            {messages.map((m) => (
              <tr key={m.id}>
                <td className="font-medium text-slate-800">{m.name}</td>
                <td>
                  <span className="badge bg-slate-100 text-slate-600">{KIND_LABEL[m.kind] ?? m.kind}</span>
                </td>
                <td>
                  <div className="flex gap-3">
                    <Link
                      href={`/admin/messages?edit=${m.id}`}
                      className="text-xs font-medium text-brand-600 hover:underline"
                    >
                      編輯
                    </Link>
                    <form action={deleteMessageAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <button className="text-xs font-medium text-red-600 hover:underline">刪除</button>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
