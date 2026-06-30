import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 暫時性診斷頁:顯示「登入 session 在 DB 眼中是誰、用 authenticated 身分能讀到什麼」。
// 釐清是 (1) session 沒帶到資料查詢、(2) 登入的是別的帳號、還是 (3) clinic_members 沒對應。
export default async function DiagPage() {
  const supabase = await createSupabaseServer();

  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  // 這兩個查詢走 authenticated + RLS,反映「app 的資料查詢實際帶了哪個身分」
  const members = await supabase.from("clinic_members").select("clinic_id, user_id");
  const settings = await supabase.from("clinic_settings").select("clinic_id, booking_mode");
  const doctors = await supabase.from("doctors").select("id").limit(1);

  // 直接以 app 的登入身分呼叫 auth_clinic_ids():
  // - 回 [087f6757...] → 函式正常,問題在 clinic_settings/doctors 的 policy 定義(部署版本不對)
  // - 回 [] → 函式在 app context 下回空(security definer 內 auth.uid() 取不到 → 改 invoker)
  const fnIds = await supabase.rpc("auth_clinic_ids");

  const report = {
    env_NEXT_PUBLIC_CLINIC_ID: CLINIC_ID,
    auth_getUser: {
      id: user?.id ?? null,
      email: user?.email ?? null,
      error: userErr?.message ?? null,
    },
    // 以 authenticated 身分讀 clinic_members(RLS: user_id = auth.uid())
    // → 有列代表資料查詢確實帶了登入 session;空陣列代表 auth.uid() 為 null 或無對應
    clinic_members_visible: { rows: members.data, error: members.error?.message ?? null },
    clinic_settings_visible: { rows: settings.data, error: settings.error?.message ?? null },
    doctors_visible_count: { rows: doctors.data?.length ?? 0, error: doctors.error?.message ?? null },
    auth_clinic_ids_rpc: { data: fnIds.data, error: fnIds.error?.message ?? null },
  };

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">後台連線診斷</h1>
      <p className="text-sm text-gray-500">把下面整段內容貼回對話,即可定位根因。診斷完成後此頁可移除。</p>
      <pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-xs text-green-200">
        {JSON.stringify(report, null, 2)}
      </pre>
      <ul className="space-y-1 text-sm text-gray-700">
        <li>· clinic_members_visible 有列且 user_id 與 auth_getUser.id 相同 → session 有帶、對應存在。</li>
        <li>· auth_getUser.id 有值,但 clinic_members_visible 為空 → 資料查詢沒帶到登入 session(auth.uid()=null)。</li>
        <li>· auth_getUser.id 與你在 SQL 測試用的 user id 不同 → 你登入的是另一個帳號,需替它建 clinic_members。</li>
        <li>· env_NEXT_PUBLIC_CLINIC_ID 與資料庫 clinic id 不同 → 環境變數對錯診所。</li>
      </ul>
    </div>
  );
}
