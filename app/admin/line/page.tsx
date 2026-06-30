import { headers } from "next/headers";
import { createSupabaseServer } from "@/lib/supabase-server";
import { CLINIC_ID } from "@/lib/supabase";
import { getBotInfo, getQuota, type LineBotInfo } from "@/lib/line";
import { sendTestPushAction } from "../actions";

export const dynamic = "force-dynamic";

// 唯讀的 LINE 連線狀態頁。只顯示要貼到 LINE 後台的網址、環境變數是否設定(不露值),
// 與一顆測試推播按鈕。機密一律走環境變數,這裡不儲存、不顯示任何金鑰內容。
export default async function LinePage({
  searchParams,
}: {
  searchParams: Promise<{ test?: string; reason?: string }>;
}) {
  const { test, reason } = await searchParams;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-app.up.railway.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;

  const env = (k: string) => Boolean(process.env[k] && process.env[k]!.length > 0);
  const vars = [
    { key: "LINE_CHANNEL_ACCESS_TOKEN", label: "Messaging API access token(推播/回覆)" },
    { key: "LINE_CHANNEL_SECRET", label: "Channel secret(驗 webhook 簽章)" },
    { key: "LINE_LOGIN_CHANNEL_ID", label: "LIFF channel id(驗 ID token)" },
    { key: "NEXT_PUBLIC_LIFF_ID", label: "LIFF ID(病患端入口)" },
    { key: "CRON_SECRET", label: "Cron 密鑰(提醒排程)" },
  ];

  // 即時連線檢查:用環境變數的 token 去問 LINE
  let bot: LineBotInfo | null = null;
  let quota: { type: string; value?: number } | null = null;
  let connErr: string | null = null;
  if (env("LINE_CHANNEL_ACCESS_TOKEN")) {
    try {
      [bot, quota] = await Promise.all([getBotInfo(), getQuota()]);
    } catch (e) {
      connErr = e instanceof Error ? e.message : "連線失敗";
    }
  }

  // 取一個有 line_user_id 的病患,方便快速測試
  const supabase = await createSupabaseServer();
  const { data: sample } = await supabase
    .from("patients")
    .select("name, line_user_id")
    .eq("clinic_id", CLINIC_ID)
    .not("line_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">LINE 連線</h1>
        <p className="text-sm text-slate-400">設定值請填在 Railway 環境變數與 LINE Developers 後台,此頁僅供查看與測試。</p>
      </div>

      {test === "ok" && (
        <p className="rounded-xl bg-accent-500/10 px-4 py-3 text-sm text-accent-600">測試推播已送出 ✅</p>
      )}
      {test === "err" && (
        <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          測試推播失敗:{reason || "請確認 access token 與 line_user_id"}
        </p>
      )}

      {/* 即時連線狀態 */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-slate-900">連線狀態</h2>
        {!env("LINE_CHANNEL_ACCESS_TOKEN") ? (
          <p className="text-sm text-slate-500">尚未設定 LINE_CHANNEL_ACCESS_TOKEN,無法檢查連線。</p>
        ) : connErr ? (
          <p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">連線失敗:{connErr}</p>
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
                回應模式:{bot.chatMode === "bot" ? "Bot ✓" : `${bot.chatMode}(建議改 Bot)`}
              </span>
            </div>
            {bot.chatMode !== "bot" && (
              <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-700">
                目前非 Bot 模式,webhook 的「確認/取消」按鈕可能收不到。請至 LINE 官方帳號管理後台 →
                設定 → 回應設定,把回應模式改為「Bot(聊天機器人)」並開啟 webhook。
              </p>
            )}
          </div>
        ) : null}
      </section>

      {/* 要貼到 LINE 後台的網址 */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-slate-900">要設定到 LINE 後台的網址</h2>
        <CopyRow label="Webhook URL(Messaging API)" value={`${base}/api/line/webhook`} />
        <CopyRow label="LIFF Endpoint URL(病患預約頁)" value={`${base}/book`} />
        <p className="mt-3 text-xs text-slate-400">
          於 LINE Developers:Messaging API → Webhook URL 貼上第一條並啟用;LIFF app 的 Endpoint URL 貼上第二條。
        </p>
      </section>

      {/* 環境變數狀態(只顯示有沒有設,不顯示值) */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-slate-900">環境變數狀態</h2>
        <ul className="divide-y divide-slate-100">
          {vars.map((v) => (
            <li key={v.key} className="flex items-center justify-between py-2.5 text-sm">
              <div>
                <div className="font-medium text-slate-700">{v.key}</div>
                <div className="text-xs text-slate-400">{v.label}</div>
              </div>
              {env(v.key) ? (
                <span className="badge bg-accent-500/10 text-accent-600">已設定 ✓</span>
              ) : (
                <span className="badge bg-red-50 text-red-600">未設定 ✗</span>
              )}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-slate-400">基於安全,只顯示是否已設定,不會顯示任何金鑰內容。</p>
      </section>

      {/* 測試推播 */}
      <section className="card p-5">
        <h2 className="mb-3 font-semibold text-slate-900">發送測試推播</h2>
        <form action={sendTestPushAction} className="flex flex-wrap items-end gap-3">
          <div className="grow">
            <label className="label">收件人 line_user_id</label>
            <input
              name="line_user_id"
              className="input"
              defaultValue={sample?.line_user_id ?? ""}
              placeholder="Uxxxxxxxx..."
            />
            {sample?.line_user_id && (
              <p className="mt-1 text-xs text-slate-400">已帶入病患「{sample.name}」的 LINE ID 方便測試。</p>
            )}
          </div>
          <button className="btn btn-primary" disabled={!env("LINE_CHANNEL_ACCESS_TOKEN")}>
            發送測試
          </button>
        </form>
        {!env("LINE_CHANNEL_ACCESS_TOKEN") && (
          <p className="mt-2 text-xs text-red-600">尚未設定 LINE_CHANNEL_ACCESS_TOKEN,無法推播。</p>
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
