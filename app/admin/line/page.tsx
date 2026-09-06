import { headers } from "next/headers";
import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { getBotInfo, getLineCredentialStatus, getQuota, lineAccessTokenForDestination, type LineBotInfo } from "@/lib/line";
import { requireAdmin } from "@/lib/admin";
import { saveLineCredentialsAction, sendTestPushAction, updateLineChannelSettingsAction, verifyLineChannelSettingsAction } from "../line-actions";
import { SubmitButton } from "@/components/SubmitButton";
import { createServiceClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

// 品牌管理員可保存公開識別資料，並將機密單向送往 server-side Vault。
export default async function LinePage({
  searchParams,
}: {
    searchParams: Promise<{ test?: string; saved?: string; verified?: string; credentials?: string }>;
}) {
  const { clinicId, accessType } = await requireAdmin();
  const { test, saved, verified, credentials } = await searchParams;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "your-app.up.railway.app";
  const proto = h.get("x-forwarded-proto") ?? "https";
  const base = `${proto}://${host}`;
  const supabase = await createSupabaseServer();
  const service = createServiceClient();
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
    clinicToken = await lineAccessTokenForDestination(clinic?.line_destination as string | undefined);
  } catch {
    clinicToken = null;
  }
  const credentialStatus = await getLineCredentialStatus(
    service,
    clinicId,
    clinic?.line_destination as string | undefined,
  );
  const canManageCredentials = accessType === "brand_admin";

  // 即時連線檢查：使用目前品牌的 Vault 或相容備援 token 向 LINE 查詢。
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

  const isConnected = Boolean(clinicToken && bot && !connectionFailed);
  const isVerified = channel?.verification_status === "ready";
  const isEntryReady = settings?.line_channel_enabled === true && Boolean(channel?.liff_id);

  return (
    <div className="line-workbench">
      <header className="admin-page-header">
        <div>
          <p className="eyebrow">顧客溝通</p>
          <h1 className="admin-page-title">LINE 互動中心</h1>
          <p className="admin-page-description">先確認連線，再管理顧客會看到的入口與訊息。技術識別碼與密鑰收在下方設定區。</p>
        </div>
        <nav className="admin-toolbar" aria-label="LINE 快速操作">
          <Link href="/admin/richmenu" className="admin-inline-action"><LineIcon name="grid" />圖文選單</Link>
          <Link href="/admin/line-templates" className="admin-inline-action"><LineIcon name="template" />訊息內容</Link>
          <Link href="/admin/messages" className="admin-inline-action"><LineIcon name="send" />發送紀錄</Link>
          <Link href="/admin/channels" className="admin-inline-action"><LineIcon name="check" />完整檢查</Link>
        </nav>
      </header>

      <section className="line-panel" aria-label="LINE 設定進度">
        <div className="line-panel-header"><div><h2>照順序完成 3 件事</h2><p>由左到右完成；狀態未通過時，下方會顯示處理方式。</p></div></div>
        <div className="line-status-strip border-0">
          <ConnectionStep number="1" title="官方帳號連線" ready={isConnected} detail={bot ? `${bot.displayName} ${bot.basicId ?? ""}` : "需要授權資料"} />
          <ConnectionStep number="2" title="系統連線檢查" ready={isVerified} detail={isVerified ? "系統檢查已通過" : "等待重新檢查"} />
          <ConnectionStep number="3" title="顧客入口" ready={isEntryReady} detail={isEntryReady ? "LINE 入口已啟用" : "需要啟用並填入 LIFF"} />
        </div>
      </section>

      {test === "ok" && (
        <p role="status" className="border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">測試推播已送出。</p>
      )}
      {saved === "1" && (
        <p role="status" className="border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">LINE 連線設定已儲存，請繼續執行連線檢查。</p>
      )}
      {credentials === "saved" && (
        <p role="status" className="border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">LINE 授權資料已安全儲存。畫面不會顯示原始內容，請繼續執行連線檢查。</p>
      )}
      {verified === "ok" && (
        <p role="status" className="border-l-4 border-emerald-600 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          系統連線檢查已通過；仍需用 LINE 手機完成登入、圖文選單點擊與實際訊息測試。
        </p>
      )}
      {verified === "err" && (
        <p role="alert" className="border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-700">
          連線檢查未通過。請依照下方步驟重新檢查，必要時展開「進階技術設定」。
        </p>
      )}
      {test === "err" && (
        <p role="alert" className="border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-700">
          測試訊息未送出。請先確認連線狀態已通過，且已選到可接收 LINE 訊息的顧客。
        </p>
      )}

      <section className="line-customer-grid">
        <div className="line-panel">
          <div className="line-panel-header">
            <div><h2>顧客收到訊息的時間點</h2><p>每一列都是系統事件，不需要員工逐則發送。</p></div>
            <Link href="/admin/line-templates" className="admin-inline-action"><LineIcon name="edit" />編輯訊息內容</Link>
          </div>
          <div className="line-journey-head" aria-hidden="true"><span>事件</span><span>何時發送</span><span>顧客看到什麼</span><span>狀態</span></div>
          <div>
            <JourneyRow event="預約成立" timing="顧客送出預約後" content="日期、服務、查看／取消入口" status={isConnected ? "可發送" : "待連線"} />
            <JourneyRow event="行前提醒" timing="品牌設定的行前時間" content="開始時間、地點、注意事項" status={isConnected ? "可發送" : "待連線"} />
            <JourneyRow event="預約異動" timing="確認、改期或取消時" content="最新狀態與顧客紀錄入口" status={isConnected ? "可發送" : "待連線"} />
            <JourneyRow event="候補通知" timing="釋出名額時" content="場次資訊與限時確認入口" status={isConnected ? "可發送" : "待連線"} />
            <JourneyRow event="付款結果" timing="金流回傳結果後" content="金額、付款狀態與訂單紀錄" status={isConnected ? "可發送" : "待連線"} />
          </div>
        </div>

        <aside className="line-panel">
          <div className="line-panel-header"><div><h2>LINE 畫面預覽</h2><p>固定使用示例資料，不顯示真實顧客資料。</p></div></div>
          <LineMessagePreview botName={bot?.displayName ?? "品牌官方帳號"} pictureUrl={bot?.pictureUrl} />
          <div className="border-t border-slate-200 px-4 py-3">
            {!clinicToken ? <p className="text-sm text-amber-700">尚未設定 LINE 訊息授權，請完成下方連線設定。</p>
              : connectionFailed ? <p className="text-sm text-red-700">目前無法連上 LINE，請重新檢查授權資料。</p>
                : bot ? <div className="flex flex-wrap items-center gap-2 text-xs"><span className="badge bg-emerald-50 text-emerald-700">官方帳號已連線</span><span className="badge bg-slate-100 text-slate-600">{quota?.type === "limited" ? `每月 ${quota.value} 則` : "推播無上限"}</span><span className={`badge ${bot.chatMode === "bot" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{bot.chatMode === "bot" ? "可接收顧客操作" : "回應模式需調整"}</span></div> : null}
          </div>
          {bot && bot.chatMode !== "bot" && <p className="mx-4 mb-4 border-l-4 border-amber-400 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">請到 LINE 官方帳號管理後台開啟「聊天機器人」與 Webhook，否則系統收不到顧客按鈕操作。</p>}
        </aside>
      </section>

      <section className="line-settings-grid">
      <form action={updateLineChannelSettingsAction} className="line-panel">
        <div className="line-form-body">
        <div>
          <h2 className="font-semibold text-slate-900">連線方式</h2>
          <p className="help-text">這裡只保存 LINE 提供的公開識別碼，不會保存或顯示密鑰。</p>
        </div>
        <label className="line-toggle-row">
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
        </div>
      </form>

      <form action={saveLineCredentialsAction} className="line-panel">
        <div className="line-form-body">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="font-semibold text-slate-900">品牌自己的 LINE 授權資料</h2>
            <p className="help-text max-w-3xl">
              選擇「品牌自己的 LINE Developers 渠道」時，由品牌管理者在這裡貼上授權資料，不需要再請平台人員修改部署環境。送出後會加密保管，之後不會顯示原始內容。
            </p>
          </div>
          <span className={`badge ${credentialStatus.configured ? "bg-accent-500/10 text-accent-600" : "bg-amber-50 text-amber-700"}`}>
            {credentialStatus.source === "vault"
              ? "已由品牌後台安全保管"
              : credentialStatus.source === "environment"
                ? "目前由舊版伺服器設定提供"
                : "尚未設定"}
          </span>
        </div>
        <fieldset
          disabled={!canManageCredentials || channel?.connection_mode !== "brand" || !clinic?.line_destination}
          className="grid gap-4 disabled:opacity-60 sm:grid-cols-2"
        >
          <div>
            <label className="label">Channel access token（訊息授權碼）</label>
            <input
              type="password"
              name="line_access_token"
              className="input font-mono"
              autoComplete="new-password"
              minLength={20}
              maxLength={4096}
              placeholder={credentialStatus.configured ? "已設定；不更換可留空" : "貼上 LINE Developers 顯示的完整內容"}
            />
            <p className="help-text">讓系統代表此官方帳號發送訊息。更換時才需要重新貼上。</p>
          </div>
          <div>
            <label className="label">Channel secret（渠道驗證密鑰）</label>
            <input
              type="password"
              name="line_channel_secret"
              className="input font-mono"
              autoComplete="new-password"
              minLength={32}
              maxLength={32}
              pattern="[A-Za-z0-9]{32}"
              placeholder={credentialStatus.configured ? "已設定；不更換可留空" : "32 碼英數字"}
            />
            <p className="help-text">用來確認收到的訊息確實來自 LINE，避免偽造請求。</p>
          </div>
          <div className="sm:col-span-2">
            <SubmitButton className="btn btn-primary">安全儲存 LINE 授權資料</SubmitButton>
          </div>
        </fieldset>
        {!canManageCredentials && <p className="text-sm text-amber-700">只有品牌管理者可以更新授權資料。</p>}
        {channel?.connection_mode !== "brand" && <p className="text-sm text-slate-600">目前使用平台共用連線；若品牌有自己的 LINE 渠道，請先在上一區改為品牌獨立連線並儲存。</p>}
        {channel?.connection_mode === "brand" && !clinic?.line_destination && <p className="text-sm text-amber-700">請先在上一區填寫訊息渠道識別碼並儲存，再貼上授權資料。</p>}
        </div>
      </form>
      </section>

      <form action={verifyLineChannelSettingsAction} className="line-panel line-form-body">
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
      <section className="line-panel">
        <div className="line-panel-header"><div><h2>LINE Developers 要填入的網址</h2><p>請完整複製，不要自行刪除或增加內容。</p></div></div>
        <CopyRow label="1. 訊息接收網址（Webhook URL）" value={`${base}/api/line/webhook`} />
        <CopyRow label="2. 顧客入口網址（LIFF Endpoint URL）" value={`${base}${channel?.liff_endpoint_path ?? "/book"}`} />
        <p className="px-4 py-3 text-sm leading-6 text-slate-600">
          第一個貼到「Messaging API → Webhook URL」並啟用；第二個貼到 LIFF 應用程式的「Endpoint URL」。Webhook 是 LINE 把顧客操作傳回本系統的接收網址。
        </p>
      </section>

      {/* 測試推播 */}
      <section className="line-panel">
        <div className="line-panel-header"><div><h2>實際發送測試</h2><p>選一位已加入官方帳號的顧客確認能否送達。</p></div></div>
        <form action={sendTestPushAction} className="line-form-body sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
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
    <div className="line-copy-row">
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <code>{value}</code>
    </div>
  );
}

function ConnectionStep({ number, title, detail, ready }: { number: string; title: string; detail: string; ready: boolean }) {
  return (
    <div className="line-status-step" data-ready={ready}>
      <span>{ready ? "✓" : number}</span>
      <div className="min-w-0"><strong>{title}</strong><small>{detail}</small></div>
    </div>
  );
}

function JourneyRow({ event, timing, content, status }: { event: string; timing: string; content: string; status: string }) {
  const ready = status === "可發送";
  return (
    <div className="line-journey-row">
      <strong>{event}</strong>
      <span>{timing}</span>
      <span>{content}</span>
      <span className={`badge w-fit ${ready ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{status}</span>
    </div>
  );
}

function LineMessagePreview({ botName, pictureUrl }: { botName: string; pictureUrl?: string }) {
  return (
    <div className="line-preview-canvas">
      <div className="line-phone">
        <div className="line-phone-header">
          {pictureUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pictureUrl} alt="" className="h-7 w-7 rounded-full" />
          ) : <span className="grid h-7 w-7 place-items-center rounded-full bg-[#06c755] text-xs font-bold text-white">L</span>}
          <strong className="truncate text-xs text-slate-900">{botName}</strong>
        </div>
        <div>
          <div className="line-message-bubble">
            <div className="line-message-accent" />
            <div className="line-message-body">
              <p className="line-message-status">已確認</p>
              <p className="line-message-title">預約已完成</p>
              <p className="line-message-copy">時間與服務內容如下；行前若有異動，可從按鈕直接處理。</p>
              <dl className="line-message-details"><div><dt>時間</dt><dd>9 月 12 日（六）14:30</dd></div><div><dt>服務</dt><dd>專業服務體驗</dd></div><div><dt>狀態</dt><dd>預約已確認</dd></div></dl>
            </div>
            <div className="line-message-actions"><span>查看預約詳情</span><span>聯絡品牌</span></div>
          </div>
          <p className="pb-3 text-center text-[9px] text-slate-600">版面預覽 · 不會送出訊息</p>
        </div>
      </div>
    </div>
  );
}

function LineIcon({ name }: { name: string }) {
  const path = name === "grid" ? <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>
    : name === "template" ? <><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>
      : name === "send" ? <path d="m3 11 18-8-8 18-2-8-8-2Zm8 2 4-4" />
        : name === "edit" ? <><path d="m4 20 4.5-1 10-10-3.5-3.5-10 10L4 20Z" /><path d="m13.5 7 3.5 3.5" /></>
          : <><circle cx="12" cy="12" r="9" /><path d="m8 12 2.5 2.5L16 9" /></>;
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{path}</svg>;
}
