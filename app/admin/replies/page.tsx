import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import {
  createReplyAction,
  updateReplyAction,
  toggleReplyAction,
  deleteReplyAction,
  updateLineTextsAction,
} from "../actions";
import RepliesEditor, { type Reply } from "./RepliesEditor";

export const dynamic = "force-dynamic";

export default async function RepliesPage() {
  const supabase = await createSupabaseServer();
  const [{ data: replies }, { data: settings }] = await Promise.all([
    supabase
      .from("line_auto_replies")
      .select("id, keywords, action, reply_text, sort, active")
      .eq("clinic_id", CLINIC_ID)
      .order("sort"),
    supabase
      .from("clinic_settings")
      .select("line_welcome_text, line_fallback_text")
      .eq("clinic_id", CLINIC_ID)
      .maybeSingle(),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">LINE 回覆指令</h1>
        <p className="text-sm text-slate-400">
          設定病患在官方帳號輸入文字時的自動回覆。全部走 LINE 免費回覆,不計入推播額度。
        </p>
      </div>

      {/* 歡迎詞 / 預設回覆 */}
      <form action={updateLineTextsAction} className="card space-y-4 p-5">
        <h2 className="font-semibold text-slate-900">歡迎詞與預設回覆</h2>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">加好友歡迎訊息</span>
          <textarea
            name="line_welcome_text"
            rows={2}
            defaultValue={settings?.line_welcome_text ?? ""}
            placeholder="留空則用系統預設歡迎詞"
            className="input"
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-600">找不到對應指令時的回覆</span>
          <textarea
            name="line_fallback_text"
            rows={2}
            defaultValue={settings?.line_fallback_text ?? ""}
            placeholder="留空則用系統預設選單提示"
            className="input"
          />
        </label>
        <button className="btn btn-primary">儲存</button>
      </form>

      <RepliesEditor
        replies={(replies ?? []) as Reply[]}
        createAction={createReplyAction}
        updateAction={updateReplyAction}
        toggleAction={toggleReplyAction}
        deleteAction={deleteReplyAction}
      />
    </div>
  );
}
