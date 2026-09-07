import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { saveMessageAction, deleteMessageAction } from "../line-actions";
import MessageComposer from "./MessageComposer";
import type { MsgKind, MsgData } from "@/lib/lineMessage";
import { requireAdmin } from "@/lib/admin";
import { SubmitButton } from "@/components/SubmitButton";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { ModuleDisabled } from "@/components/ModuleDisabled";

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
  const { clinicId } = await requireAdmin();
  const { edit } = await searchParams;
  const supabase = await createSupabaseServer();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "line"))) return <ModuleDisabled title="訊息模板" />;
  const { data } = await supabase
    .from("line_messages")
    .select("id, name, kind, data")
    .eq("clinic_id", clinicId)
    .order("created_at", { ascending: false });
  const messages = (data ?? []) as Msg[];
  const editing = edit ? messages.find((m) => m.id === edit) ?? null : null;

  return (
    <div className="admin-page">
      <div className="admin-page-header">
        <div><p className="eyebrow">LINE 顧客互動</p><h1 className="admin-page-title">自訂訊息素材</h1><p className="admin-page-description">製作文字、圖文卡或多頁訊息；右側會同步顯示顧客在 LINE 中看到的內容。</p></div>
        <Link href="/admin/replies" className="btn btn-secondary">設定自動回覆</Link>
      </div>

      <MessageComposer key={editing?.id ?? "new"} initial={editing} saveAction={saveMessageAction} />
      {editing && (
        <Link href="/admin/messages" className="btn btn-ghost w-fit">
          ← 取消編輯，建立新素材
        </Link>
      )}

      <section className="admin-section">
        <div className="admin-section-header"><div><h2>已儲存素材</h2><p className="mt-0.5 text-xs text-slate-500">編輯既有內容，或到自動回覆設定綁定觸發關鍵字。</p></div><span className="text-xs tabular-nums text-slate-500">{messages.length} 筆</span></div>
      <div className="admin-table-shell admin-table-mobile-cards border-0">
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
                <td colSpan={3} className="py-8 text-center text-slate-400" data-mobile-empty="true">
                  尚無訊息素材
                </td>
              </tr>
            )}
            {messages.map((m) => (
              <tr key={m.id}>
                <td className="font-medium text-slate-800" data-label="名稱">{m.name}</td>
                <td data-label="類型">
                  <span className="badge bg-slate-100 text-slate-600">{KIND_LABEL[m.kind] ?? m.kind}</span>
                </td>
                <td data-label="操作">
                  <div className="flex gap-3">
                    <Link
                      href={`/admin/messages?edit=${m.id}`}
                      className="admin-inline-action text-brand-700"
                    >
                      編輯
                    </Link>
                    <form action={deleteMessageAction}>
                      <input type="hidden" name="id" value={m.id} />
                      <SubmitButton className="admin-inline-action text-red-700">刪除</SubmitButton>
                    </form>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      </section>
    </div>
  );
}
