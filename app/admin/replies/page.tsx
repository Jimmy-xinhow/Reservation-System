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
      .select(
        "line_welcome_text, line_fallback_text, line_menu_title, line_menu_btn_booking, line_menu_btn_query, line_menu_btn_progress, line_menu_btn_info, line_menu_link_label, line_menu_link_url",
      )
      .eq("clinic_id", CLINIC_ID)
      .maybeSingle(),
  ]);
  const s = settings as Record<string, unknown> | null;

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

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="mb-3 text-sm font-medium text-slate-700">主選單卡片按鈕</p>
          <label className="mb-3 block text-sm">
            <span className="mb-1 block font-medium text-slate-600">卡片標題(留空用預設)</span>
            <input name="line_menu_title" defaultValue={(s?.line_menu_title as string) ?? ""} className="input" />
          </label>
          <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
            {[
              ["line_menu_btn_booking", "立即預約"],
              ["line_menu_btn_query", "查詢預約"],
              ["line_menu_btn_progress", "看診進度"],
              ["line_menu_btn_info", "診所資訊"],
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
              <span className="mb-1 block font-medium text-slate-600">自訂按鈕文字(選填)</span>
              <input name="line_menu_link_label" defaultValue={(s?.line_menu_link_label as string) ?? ""} placeholder="例:官方網站" className="input" />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium text-slate-600">自訂按鈕連結</span>
              <input name="line_menu_link_url" defaultValue={(s?.line_menu_link_url as string) ?? ""} placeholder="https://..." className="input" />
            </label>
          </div>
        </div>

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
