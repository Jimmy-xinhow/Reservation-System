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

  return (
    <main className="min-h-screen bg-[#f4f1ea] px-5 py-10 text-slate-900">
      <section className="mx-auto w-full max-w-md border border-slate-300 bg-white p-6 shadow-sm sm:p-8">
        <p className="text-xs font-semibold tracking-[0.14em] text-brand-700">LINE 會員安全綁定</p>
        <h1 className="mt-3 font-display text-3xl leading-tight">確認品牌留存的會員資料</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          驗證成功後，這個 LINE 帳號即可直接查詢預約、報名票券與會員權益。不同品牌不會共用綁定資料。
        </p>
        {error && <p role="alert" className="mt-5 border-l-4 border-red-500 bg-red-50 px-4 py-3 text-sm text-red-700">資料驗證未通過，請確認姓名、電話與生日後再試。</p>}
        {!clinicSlug || !linkToken ? (
          <p className="mt-6 border-l-4 border-amber-500 bg-amber-50 px-4 py-3 text-sm text-amber-800">綁定連結不完整或已失效，請回到官方帳號重新點選「會員／套票」。</p>
        ) : (
          <form action="/api/line/account-link/complete" method="post" className="mt-6 space-y-4">
            <input type="hidden" name="clinic_slug" value={clinicSlug} />
            <input type="hidden" name="link_token" value={linkToken} />
            <label className="block text-sm"><span className="label">姓名</span><input className="input" name="name" autoComplete="name" maxLength={100} required /></label>
            <label className="block text-sm"><span className="label">電話</span><input className="input" name="phone" inputMode="tel" autoComplete="tel" maxLength={40} required /></label>
            <label className="block text-sm"><span className="label">出生年月日</span><input className="input" name="birthday" type="date" autoComplete="bday" required /></label>
            <button className="btn btn-primary min-h-12 w-full" type="submit">確認資料並綁定 LINE</button>
          </form>
        )}
        <p className="mt-5 text-xs leading-5 text-slate-500">系統只保存一次性驗證碼的雜湊值，且 10 分鐘後失效；不會儲存 LINE 提供的 link token。</p>
      </section>
    </main>
  );
}
