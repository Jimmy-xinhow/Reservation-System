import Link from "next/link";
import { Brand } from "@/components/Brand";
import { createServiceClient } from "@/lib/supabase";
import { headers } from "next/headers";
import { resolvePublicClinicIdFromScope } from "@/lib/public-brand";
import { FunnelTracker } from "@/components/FunnelTracker";
import { MarketingHome } from "@/components/MarketingHome";
import { IndustryShowcase } from "@/components/showcase/IndustryShowcase";
import { ShowcaseFonts } from "@/components/showcase/ShowcaseFonts";
import { loadPublicBrandPage } from "@/lib/public-brand-page";

export const dynamic = "force-dynamic";

interface ClinicInfo {
  name: string;
  line_basic_id: string | null;
  phone: string | null;
  address: string | null;
  intro: string | null;
}

async function getClinic(clinicId: string | null): Promise<ClinicInfo | null> {
  if (!clinicId) return null;
  try {
    const svc = createServiceClient();
    const { data } = await svc
      .from("clinics")
      .select("name, line_basic_id, phone, address, intro")
      .eq("id", clinicId)
      .maybeSingle();
    return (data as ClinicInfo | null) ?? null;
  } catch {
    return null;
  }
}

function isPlatformHost(host: string | null): boolean {
  const normalized = (host ?? "").split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  if (!normalized || ["localhost", "127.0.0.1", "[::1]"].includes(normalized)) return true;
  const configuredHosts = [process.env.PUBLIC_PLATFORM_HOSTS, process.env.RAILWAY_PUBLIC_DOMAIN, process.env.VERCEL_URL]
    .flatMap((value) => (value ?? "").split(","))
    .map((value) => value.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter(Boolean);
  return configuredHosts.includes(normalized) || normalized.endsWith(".up.railway.app") || normalized.endsWith(".vercel.app");
}

export default async function HomePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  const clinicSlug = typeof params.clinic_slug === "string" ? params.clinic_slug : null;
  const clinicIdParam = typeof params.clinic_id === "string" ? params.clinic_id : null;
  const requestHeaders = await headers();
  const requestHost = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
  if (!clinicSlug && !clinicIdParam && isPlatformHost(requestHost)) return <MarketingHome />;

  let clinicId: string | null = null;
  let brandPage: Awaited<ReturnType<typeof loadPublicBrandPage>> = null;
  try {
    const svc = createServiceClient();
    clinicId = await resolvePublicClinicIdFromScope(svc, {
      clinicSlug,
      clinicId: clinicIdParam,
      host: requestHost,
    });
    if (clinicId) brandPage = await loadPublicBrandPage(svc, clinicId);
  } catch {
    clinicId = null;
  }
  if (brandPage) {
    return (
      <ShowcaseFonts>
        <FunnelTracker eventName="portal_view" />
        <IndustryShowcase slug={brandPage.template} brand={brandPage} />
      </ShowcaseFonts>
    );
  }
  const clinic = await getClinic(clinicId);
  const basicId = clinic?.line_basic_id?.trim() || null;
  const lineAddUrl = basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId)}` : null;
  const clinicScopeSuffix = clinicSlug
    ? `?clinic_slug=${encodeURIComponent(clinicSlug)}`
    : clinicIdParam
      ? `?clinic_id=${encodeURIComponent(clinicIdParam)}`
      : "";
  const liffId = process.env.NEXT_PUBLIC_LIFF_ID;
  const liffUrl = liffId
    ? `https://liff.line.me/${liffId}${clinicScopeSuffix}`
    : null;
  const browserBookingUrl = `/book/browser${clinicScopeSuffix}`;
  const registrationUrl = `/register${clinicScopeSuffix}`;
  const membershipUrl = `/membership${clinicScopeSuffix}`;

  if (!clinicId) return <MarketingHome />;

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
      <FunnelTracker eventName="portal_view" />
      <Brand name={clinic?.name} align="center" size="lg" subtitle="預約與活動服務" />

      <div className="card w-full overflow-hidden">
        <div className="bg-gradient-to-br from-brand-500 to-accent-600 p-6 text-center text-white">
          <h1 className="text-xl font-bold">選擇您要使用的服務</h1>
          {clinic?.intro && <p className="mt-2 text-sm text-white/85">{clinic.intro}</p>}
        </div>

        <div className="space-y-4 p-6">
          {(clinic?.phone || clinic?.address) && (
            <ul className="space-y-2 text-sm text-slate-600">
              {clinic?.phone && (
                <li className="flex gap-2">
                  <span>📞</span>
                  <a href={`tel:${clinic.phone}`} className="hover:text-brand-600">
                    {clinic.phone}
                  </a>
                </li>
              )}
              {clinic?.address && (
                <li className="flex gap-2">
                  <span>📍</span>
                  <span>{clinic.address}</span>
                </li>
              )}
            </ul>
          )}

          {/* LINE 加入好友 / 線上預約 */}
          {lineAddUrl ? (
            <a
              href={lineAddUrl}
              target="_blank"
              rel="noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#06C755] px-4 py-3 font-medium text-white transition-opacity hover:opacity-90"
            >
              <span className="text-lg">💬</span> 加入 LINE，開始預約
            </a>
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-center text-sm text-slate-500">目前提供瀏覽器預約，選擇下方服務即可開始。</p>
          )}

          {liffUrl && (
            <a href={liffUrl} target="_blank" rel="noreferrer" className="btn btn-secondary w-full">
              已加好友?直接預約
            </a>
          )}

          <Link href={browserBookingUrl} className={`btn w-full ${lineAddUrl ? "btn-secondary" : "btn-primary"}`}>
            瀏覽器預約
          </Link>
          <div className="grid grid-cols-2 gap-2">
            <Link href={registrationUrl} className="btn btn-secondary w-full">活動與課程</Link>
            <Link href={membershipUrl} className="btn btn-secondary w-full">會員與套票</Link>
          </div>
          <Link href={`/my${clinicScopeSuffix}`} className="btn btn-ghost w-full">查看我的紀錄</Link>
          <Link href={`/register/cancel${clinicScopeSuffix}`} className="text-center text-sm text-slate-400 hover:text-brand-600">取消既有活動報名</Link>

          {basicId && (
            <p className="text-center text-xs text-slate-400">LINE ID:{basicId}</p>
          )}
        </div>
      </div>

      <Link href="/admin" className="text-xs text-slate-400 hover:text-brand-600">工作人員登入</Link>
    </main>
  );
}
