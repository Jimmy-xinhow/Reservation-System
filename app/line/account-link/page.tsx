import Link from "next/link";
import { createServiceClient } from "@/lib/supabase";
import { resolvePublicClinicIdFromScope } from "@/lib/public-brand";
import { lineBrandTheme } from "@/lib/line-ui-templates";
import { clinicLiffUrl, getClinicLineChannelContext } from "@/lib/line-channel";

export const dynamic = "force-dynamic";

export default async function LineAccountLinkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const clinicSlug = typeof params.clinic_slug === "string" ? params.clinic_slug : "";
  const linkToken = typeof params.linkToken === "string" ? params.linkToken : "";
  const error = typeof params.error === "string" ? params.error : "";
  const mode = params.mode === "existing" ? "existing" : null;
  const service = createServiceClient();
  const clinicId = clinicSlug ? await resolvePublicClinicIdFromScope(service, { clinicSlug }) : null;
  const [{ data: clinic }, { data: settings }] = clinicId ? await Promise.all([
    service.from("clinics").select("name").eq("id", clinicId).eq("active", true).maybeSingle(),
    service.from("clinic_settings").select("brand_page_template, brand_primary_color, brand_accent_color, brand_logo_url").eq("clinic_id", clinicId).maybeSingle(),
  ]) : [{ data: null }, { data: null }];
  const brandName = (clinic?.name as string | null)?.trim() || "品牌會員服務";
  const theme = lineBrandTheme(
    settings?.brand_page_template as string | null,
    settings?.brand_primary_color as string | null,
    settings?.brand_accent_color as string | null,
  );
  const logoUrl = (settings?.brand_logo_url as string | null)?.trim() || null;
  const lineContext = clinicId ? await getClinicLineChannelContext(service, clinicId).catch(() => null) : null;
  const firstTimeUrl = lineContext ? clinicLiffUrl(lineContext, { view: "membership", task: "1" }) : null;
  const existingQuery = new URLSearchParams({ clinic_slug: clinicSlug, linkToken, mode: "existing" });
  const existingHref = `/line/account-link?${existingQuery.toString()}`;
  const errorMessage = error === "not_found"
    ? "找不到相符的既有會員資料。如果這是第一次使用，請返回並選擇「第一次使用・建立會員」。"
    : "資料沒有吻合。請確認姓名、電話與生日是否和品牌留存內容完全一致，再重新送出。";

  return (
    <main className="min-h-screen bg-[#ebe8e1] px-4 py-5 text-slate-900 sm:px-6 sm:py-10">
      <section className="mx-auto grid w-full max-w-4xl overflow-hidden rounded-[1.75rem] bg-white shadow-[0_28px_80px_rgba(30,38,34,.16)] lg:grid-cols-[.82fr_1.18fr]">
        <div className="relative overflow-hidden px-6 py-8 text-white sm:px-9 sm:py-10" style={{ backgroundColor: theme.primary }}>
          <div className="absolute -right-16 -top-20 h-52 w-52 rounded-full border border-white/15" />
          <div className="absolute -bottom-24 -left-16 h-64 w-64 rounded-full border border-white/10" />
          <div className="relative flex items-center gap-3">
            {logoUrl ? (
              // 品牌 Logo 由租戶設定，來源網域無法在建置時預先列舉。
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt="" className="h-11 w-11 rounded-full bg-white object-contain p-1" />
            ) : <span className="grid h-11 w-11 place-items-center rounded-full border border-white/40 font-display text-lg">會員</span>}
            <div><p className="text-[11px] font-semibold tracking-[.16em] text-white/65">LINE MEMBER LINK</p><p className="mt-1 text-sm font-semibold">{brandName}</p></div>
          </div>
          <div className="relative mt-16 sm:mt-24">
            <span className="block h-1 w-12 rounded-full" style={{ backgroundColor: theme.accent }} />
            <h1 className="mt-6 font-display text-[2.15rem] leading-[1.18] tracking-[-.025em] sm:text-[2.55rem]">{mode === "existing" ? <>把原有紀錄，<br />安全帶回 LINE。</> : <>先選對情況，<br />綁定就不再繞路。</>}</h1>
            <p className="mt-5 max-w-sm text-sm leading-7 text-white/75">第一次使用會建立這個品牌的會員；已有資料才需要進行姓名、電話與生日比對。</p>
          </div>
          <div className="relative mt-10 flex flex-wrap gap-x-5 gap-y-2 text-xs text-white/65"><span>單一品牌綁定</span><span>10 分鐘連結效期</span><span>資料加密傳送</span></div>
        </div>

        <div className="px-6 py-8 sm:px-10 sm:py-10 lg:px-12 lg:py-14">
          {!clinicSlug || !linkToken || !clinicId ? (
            <p className="mt-6 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">綁定連結不完整或已失效，請回到品牌官方帳號重新點選「會員／套票」。</p>
          ) : mode === "existing" ? (
            <>
              <p className="text-xs font-semibold tracking-[.14em]" style={{ color: theme.primary }}>已有會員・連回資料</p>
              <h2 className="mt-3 font-display text-3xl leading-tight tracking-[-.02em]">比對品牌原有紀錄</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">這裡只適用於品牌已經有你的會員資料。第一次使用者不需要在這裡查找。</p>
              {error && <p role="alert" className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm leading-6 text-red-700">{errorMessage}</p>}
              <form action="/api/line/account-link/complete" method="post" className="mt-7 space-y-5">
                <input type="hidden" name="clinic_slug" value={clinicSlug} />
                <input type="hidden" name="link_token" value={linkToken} />
                <input type="hidden" name="mode" value="existing" />
                <label className="block text-sm"><span className="mb-2 block font-semibold text-slate-700">姓名</span><input className="input min-h-12 rounded-xl border-slate-300 px-4" name="name" autoComplete="name" maxLength={100} placeholder="請輸入登記姓名" required /></label>
                <label className="block text-sm"><span className="mb-2 block font-semibold text-slate-700">電話</span><input className="input min-h-12 rounded-xl border-slate-300 px-4" name="phone" inputMode="tel" autoComplete="tel" maxLength={40} placeholder="例如 0912 345 678" required /></label>
                <label className="block text-sm"><span className="mb-2 block font-semibold text-slate-700">出生年月日</span><input className="input min-h-12 rounded-xl border-slate-300 px-4" name="birthday" type="date" autoComplete="bday" required /></label>
                <button className="min-h-13 w-full rounded-xl px-5 py-3.5 text-sm font-bold text-white shadow-[0_10px_24px_rgba(29,48,41,.18)] transition duration-200 hover:-translate-y-0.5 hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-2" style={{ backgroundColor: theme.primary }} type="submit">比對既有資料並連結 LINE</button>
              </form>
              <Link href={`/line/account-link?${new URLSearchParams({ clinic_slug: clinicSlug, linkToken }).toString()}`} className="mt-5 inline-flex min-h-11 items-center text-sm font-semibold underline decoration-slate-300 underline-offset-4">← 返回選擇使用情況</Link>
            </>
          ) : (
            <>
              <p className="text-xs font-semibold tracking-[.14em]" style={{ color: theme.primary }}>選擇你的使用情況</p>
              <h2 className="mt-3 font-display text-3xl leading-tight tracking-[-.02em]">這次是建立，還是找回？</h2>
              <p className="mt-3 text-sm leading-6 text-slate-500">兩條流程分開處理，才不會讓第一次使用者一直得到「找不到資料」。</p>
              {error && <p role="alert" className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">上次綁定沒有完成，請依目前情況重新選擇。</p>}
              <div className="mt-7 grid gap-3">
                {firstTimeUrl ? <a href={firstTimeUrl} className="group rounded-2xl border-2 p-5 transition hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: theme.primary }}><span className="text-xs font-semibold tracking-[.12em]" style={{ color: theme.primary }}>FIRST TIME</span><strong className="mt-2 block text-lg text-slate-900">第一次使用・建立會員</strong><span className="mt-2 block text-sm leading-6 text-slate-500">驗證目前 LINE 身分後建立姓名、電話與生日；若已有完全相同的未綁定資料，會安全合併。</span></a> : <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-800">此品牌尚未完成 LIFF 設定，暫時無法建立新會員，請洽品牌人員。</p>}
                <Link href={existingHref} className="group rounded-2xl border border-slate-200 p-5 transition hover:-translate-y-0.5 hover:border-slate-400 hover:shadow-lg"><span className="text-xs font-semibold tracking-[.12em] text-slate-500">EXISTING MEMBER</span><strong className="mt-2 block text-lg text-slate-900">已有會員・連回原資料</strong><span className="mt-2 block text-sm leading-6 text-slate-500">適用於曾由品牌建立過會員、預約或消費紀錄，需要比對原有資料的人。</span></Link>
              </div>
            </>
          )}
          <div className="mt-7 border-t border-slate-200 pt-5"><p className="text-xs leading-5 text-slate-500"><strong className="text-slate-700">隱私說明：</strong>{mode === "existing" ? "既有會員連結只保存一次性驗證碼的雜湊值，10 分鐘後自動失效；不儲存 LINE 提供的 link token。" : "會員資料只建立於目前品牌；LINE 身分由該品牌的 Login Channel 驗證，不會跨品牌共用。"}</p></div>
        </div>
      </section>
    </main>
  );
}
