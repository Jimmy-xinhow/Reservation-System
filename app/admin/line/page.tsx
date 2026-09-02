import { headers } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase-server";
import { getBotInfo, getQuota, lineAccessTokenForDestination, type LineBotInfo } from "@/lib/line";
import { requireAdmin } from "@/lib/admin";
import { sendTestPushAction, updateLineChannelSettingsAction, verifyLineChannelSettingsAction } from "../line-actions";
import { SubmitButton } from "@/components/SubmitButton";

export const dynamic = "force-dynamic";

// 品牌管理員可保存非機密識別資料並觸發 server-side 渠道驗證。
// 機密一律走環境變數,這裡不儲存、不顯示任何金鑰內容。
export default async function LinePage({
  searchParams,
}: {
    searchParams: Promise<{ test?: string; saved?: string; verified?: string }>;
}) {
  const { clinicId } = await requireAdmin();
  const { test, saved, verified } = await searchParams;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-app.up.railway.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;
  const supabase = await createSupabaseServer();
  const [{ data: clinic }, { data: settings }, { data: channel }] = await Promise.all([
    supabase.from("clinics").select("line_destination").eq("id", clinicId).maybeSingle(),
    supabase.from("clinic_settings").select("line_channel_enabled").eq("clinic_id", clinicId).maybeSingle(),
    supabase
      .from("clinic_line_channels")
      .select("connection_mode, login_channel_id, liff_id, liff_endpoint_path, verification_status, verification_error, last_verified_at")
      .eq("clinic_id", clinicId)
      .maybeSingle(),
  ]);
  let clinicToken: string | null = null;
  try {
    clinicToken = lineAccessTokenForDestination(clinic?.line_destination as string | undefined);
  } catch {
    clinicToken = null;
  }

  const env = (k: string) => Boolean(process.env[k] && process.env[k]!.length > 0);
  const vars = [
    { key: "LINE_CHANNEL_ACCESS_TOKENS_JSON", label: "各品牌的 LINE 訊息授權資料" },
    { key: "LINE_CHANNEL_SECRETS_JSON", label: "各品牌的 LINE 驗證密鑰" },
    { key: "LINE_CHANNEL_ACCESS_TOKEN", label: "共用 LINE 訊息授權資料" },
    { key: "LINE_CHANNEL_SECRET", label: "共用 LINE 驗證密鑰" },
    { key: "LINE_LOGIN_CHANNEL_ID", label: "共用 LINE 登入渠道編號" },
    { key: "NEXT_PUBLIC_LIFF_ID", label: "共用 LINE 顧客入口編號" },
    { key: "CRON_SECRET", label: "自動提醒排程密鑰" },
  ];

  // 即時連線檢查:用環境變數的 token 去問 LINE
  let bot: LineBotInfo | null = null;
  let quota: { type: string; value?: number } | null = null;
  let connectionFailed = false;
  if (clinicToken) {
    try {
      [bot, quota] = await Promise.all([getBotInfo(clinicToken), getQuota(clinicToken)]);
    } catch (error) {
      connectionFailed = true;
      console.error("[line-connection-check]", error instanceof Error ? error.message.slice(0, 500) : "unknown error");
    }
  }

  // 取一個有 line_user_id 的顧客,方便快速測試
  const { data: sample } = await supabase
    .from("patients")
    .select("name, line_user_id")
    .eq("clinic_id", clinicId)
    .not("line_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">顧客入口設定</p>
        <h1 className="text-2xl font-bold text-slate-900">LINE 官方帳號連線</h1>
        <p className="mt-2 max-w-3xl text-base leading-7 text-slate-600">依照下方順序完成連線、網址設定與測試。一般操作只需要看白話步驟；識別碼與伺服器設定集中在「進階技術設定」。</p>
      </div>

      <section className="card p-5 sm:p-6">
        <h2 className="font-semibold text-slate-900">照順序完成 3 件事</h2>
        <ol className="mt-4 grid gap-3 lg:grid-cols-3">
          <SetupStep number="1" title="選擇連線方式" detail="多數品牌先用共用連線；有自己的 LINE Developers 渠道時再選品牌獨立連線。" />
          <SetupStep number="2" title="貼上兩個網址" detail="把本頁產生的訊息接收網址與顧客入口網址貼到 LINE Developers。" />
          <SetupStep number="3" title="檢查並實際測試" detail="先按「重新檢查連線」，再用 LINE 手機完成登入、圖文選單點擊與測試訊息。" />
        </ol>
      </section>

      {test === "ok" && (
        <p className="rounded-xl bg-accent-500/10 px-4 py-3 text-sm text-accent-600">測試推播已送出 ✅</p>
      )}
      {saved === "1" && (
        <p className="rounded-xl bg-accent-500/10 px-4 py-3 text-sm text-accent-600">LINE 連線設定已儲存，請繼續執行連線檢查。</p>
      )}
      {verified === "ok" && (
        <p className="rounded-xl bg-accent-500/10 px-4 py-3 text-sm text-accent-600">
          系統連線檢查已通過；仍需用 LINE 手機完成登入、圖文選單點擊與實際訊息測試。
        </p>
      )}
      {verified === "err" && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          連線檢查未通過。請依照下方步驟重新檢查，必要時展開「進階技術設定」。
        </p>
      )}
      {test === "err" && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          測試訊息未送出。請先確認連線狀態已通過，且已選到可接收 LINE 訊息的顧客。
        </p>
      )}

      {/* 即時連線狀態 */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-slate-900">連線狀態</h2>
        {!clinicToken ? (
          <p className="text-sm text-slate-600">目前品牌尚未設定 LINE 訊息授權資料，因此無法檢查連線。</p>
        ) : connectionFailed ? (
          <p className="rounded-xl bg-red-50 px-3 py-3 text-sm leading-6 text-red-700">目前無法連上 LINE。請先檢查伺服器授權資料，再重新整理本頁。</p>
        ) : bot ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              {bot.pictureUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={bot.pictureUrl} alt="" className="h-10 w-10 rounded-full" />
              )}
              <div>
                <div className="font-medium text-slate-900">{bot.displayName}</div>
                <div className="text-xs text-slate-500">{bot.basicId}</div>
              </div>
              <span className="badge ml-auto bg-accent-500/10 text-accent-600">已連線 ✓</span>
            </div>
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="badge bg-slate-100 text-slate-600">
                推播額度:{quota?.type === "limited" ? `${quota.value} 則/月` : "無上限"}
              </span>
              <span
                className={`badge ${bot.chatMode === "bot" ? "bg-accent-500/10 text-accent-600" : "bg-amber-50 text-amber-700"}`}
              >
                回應模式：{bot.chatMode === "bot" ? "聊天機器人 ✓" : "需要調整"}
              </span>
            </div>
            {bot.chatMode !== "bot" && (
              <p className="rounded-xl bg-amber-50 px-3 py-3 text-sm leading-6 text-amber-800">
                目前不是聊天機器人模式，顧客按下「確認／取消」後系統可能收不到。請到 LINE 官方帳號管理後台的「設定 → 回應設定」，改為「聊天機器人」並開啟 Webhook（讓 LINE 把顧客操作傳回本系統的功能）。
              </p>
            )}
          </div>
        ) : null}
      </section>

      <form action={updateLineChannelSettingsAction} className="card space-y-5 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">連線方式</h2>
          <p className="help-text">這裡只保存 LINE 提供的公開識別碼，不會保存或顯示密鑰。</p>
        </div>
        <label className="flex items-start gap-3 rounded-xl border border-slate-200 p-4">
          <input type="checkbox" name="line_channel_enabled" defaultChecked={settings?.line_channel_enabled === true} className="mt-1" />
          <span><span className="block font-medium text-slate-800">啟用 LINE 顧客入口</span><span className="mt-1 block text-sm leading-6 text-slate-600">停用後，顧客無法從 LINE 開啟這個品牌的預約與報名服務。</span></span>
        </label>
        <div>
          <label className="label">這個品牌要使用哪一種連線？</label>
          <select name="connection_mode" className="input" defaultValue={channel?.connection_mode ?? "shared"}>
            <option value="shared">使用平台共用連線（建議先選這個）</option>
            <option value="brand">使用品牌自己的 LINE Developers 渠道</option>
          </select>
        </div>
        <details className="technical-details" open={channel?.connection_mode === "brand" || channel?.verification_status !== "ready"}>
          <summary>進階技術設定：LINE 識別碼</summary>
          <div className="grid gap-4 border-t border-slate-200 p-4 sm:grid-cols-2">
            <div>
              <label className="label">訊息渠道識別碼（destination）</label>
              <input name="line_destination" className="input font-mono" defaultValue={clinic?.line_destination ?? ""} placeholder="Uxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" />
              <p className="help-text">用來判斷訊息屬於哪個品牌，可從 LINE 的 Webhook 驗證資料取得。</p>
            </div>
            <div>
              <label className="label">LINE 登入渠道編號（Channel ID）</label>
              <input name="login_channel_id" className="input font-mono" inputMode="numeric" defaultValue={channel?.login_channel_id ?? ""} placeholder="品牌獨立連線時必填" />
              <p className="help-text">用來驗證顧客的 LINE 登入身分。</p>
            </div>
            <div>
              <label className="label">顧客入口編號（LIFF ID）</label>
              <input name="liff_id" className="input font-mono" defaultValue={channel?.liff_id ?? ""} placeholder="1234567890-AbCdEfGh" />
              <p className="help-text">LINE 內建網頁應用程式的編號，顧客點圖文選單後會由它開啟。</p>
            </div>
            <div>
              <label className="label">顧客入口路徑</label>
              <input name="liff_endpoint_path" className="input font-mono" defaultValue={channel?.liff_endpoint_path ?? "/book"} placeholder="/book" />
              <p className="help-text">一般預約使用 /book；除非技術人員另有規劃，請不要更改。</p>
            </div>
          </div>
        </details>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className="btn btn-primary">儲存連線設定</SubmitButton>
          <span className={`badge ${channel?.verification_status === "ready" ? "bg-accent-500/10 text-accent-600" : channel?.verification_status === "error" ? "bg-red-50 text-red-600" : "bg-amber-50 text-amber-700"}`}>
            連線檢查：{channel?.verification_status === "ready" ? "已通過" : channel?.verification_status === "error" ? "未通過" : channel?.verification_status === "pending" ? "等待檢查" : "尚未檢查"}
          </span>
        </div>
        {channel?.verification_error && <details className="technical-details border-red-200 bg-red-50"><summary className="text-red-700">查看技術錯誤內容</summary><code className="block overflow-x-auto border-t border-red-200 p-4 text-xs text-red-800">{channel.verification_error}</code></details>}
        {channel?.last_verified_at && <p className="text-sm text-slate-600">最後檢查：{new Date(channel.last_verified_at).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p>}
      </form>

      <form action={verifyLineChannelSettingsAction} className="card space-y-3 p-5">
        <div>
          <h2 className="font-semibold text-slate-900">檢查連線是否可用</h2>
          <p className="help-text">
            系統會檢查 LINE 授權、品牌識別、訊息接收功能與網址是否正確，不會顯示或改寫任何密鑰。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton className="btn btn-primary">重新檢查連線</SubmitButton>
          <span className="text-sm text-slate-600">系統檢查通過後，仍要用 LINE 手機實際測試。</span>
        </div>
      </form>

      {/* 要貼到 LINE 後台的網址 */}
      <section className="card p-5">
        <h2 className="font-semibold text-slate-900">貼到 LINE Developers 的兩個網址</h2>
        <p className="help-text mb-4">請完整複製，不要自行刪除或增加網址內容。</p>
        <CopyRow label="1. 訊息接收網址（Webhook URL）" value={`${base}/api/line/webhook`} />
        <CopyRow label="2. 顧客入口網址（LIFF Endpoint URL）" value={`${base}${channel?.liff_endpoint_path ?? "/book"}`} />
        <p className="mt-3 text-sm leading-6 text-slate-600">
          第一個貼到「Messaging API → Webhook URL」並啟用；第二個貼到 LIFF 應用程式的「Endpoint URL」。Webhook 是 LINE 把顧客操作傳回本系統的接收網址。
        </p>
      </section>

      {/* 環境變數狀態(只顯示有沒有設,不顯示值) */}
      <details className="card">
        <summary className="flex min-h-14 cursor-pointer items-center px-5 py-4 font-semibold text-slate-900">進階技術設定：伺服器密鑰狀態</summary>
        <div className="border-t border-slate-200 px-5 pb-5">
        <p className="py-4 text-sm leading-6 text-slate-600">這一區提供給部署或技術人員檢查，只顯示是否已設定，不會顯示密鑰內容。</p>
        <ul className="divide-y divide-slate-100">
          {vars.map((v) => (
            <li key={v.key} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <div className="font-medium text-slate-800">{v.label}</div>
                <code className="text-xs text-slate-600">{v.key}</code>
              </div>
              {env(v.key) ? (
                <span className="badge bg-accent-500/10 text-accent-600">已設定 ✓</span>
              ) : (
                <span className="badge bg-red-50 text-red-600">未設定 ✗</span>
              )}
            </li>
          ))}
        </ul>
        </div>
      </details>

      {/* 測試推播 */}
      <section className="card p-5">
        <h2 className="font-semibold text-slate-900">發送測試 LINE 訊息</h2>
        <p className="help-text mb-3">用一位已加入 LINE 官方帳號的顧客確認訊息是否能送達。</p>
        <form action={sendTestPushAction} className="flex flex-wrap items-end gap-3">
          <div className="grow">
            <label className="label">測試收件人 LINE 使用者識別碼</label>
            <input
              name="line_user_id"
              className="input"
              defaultValue={sample?.line_user_id ?? ""}
              placeholder="Uxxxxxxxx..."
            />
            {sample?.line_user_id && (
              <p className="help-text">已帶入顧客「{sample.name}」的 LINE 識別碼，方便測試。</p>
            )}
          </div>
          <SubmitButton className="btn btn-primary" disabled={!clinicToken}>
            發送測試訊息
          </SubmitButton>
        </form>
        {!clinicToken && (
          <p className="mt-3 text-sm text-red-700">目前品牌尚未設定 LINE 訊息授權資料，因此無法發送測試。</p>
        )}
      </section>
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-sm font-medium text-slate-600">{label}</div>
      <code className="block overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-700">
        {value}
      </code>
    </div>
  );
}

function SetupStep({ number, title, detail }: { number: string; title: string; detail: string }) {
  return (
    <li className="flex gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-bold text-white">{number}</span>
      <div><p className="font-medium text-slate-900">{title}</p><p className="mt-1 text-sm leading-6 text-slate-600">{detail}</p></div>
    </li>
  );
}
