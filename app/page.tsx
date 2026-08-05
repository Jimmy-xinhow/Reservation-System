import Link from "next/link";
import { Brand } from "@/components/Brand";
import { createServiceClient } from "@/lib/supabase";
import { headers } from "next/headers";
import { resolvePublicClinicIdFromScope } from "@/lib/public-brand";

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

export default async function HomePage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const params = (await searchParams) ?? {};
  let clinicId: string | null = null;
  try {
    const requestHeaders = await headers();
    const svc = createServiceClient();
    clinicId = await resolvePublicClinicIdFromScope(svc, {
      clinicSlug: typeof params.clinic_slug === "string" ? params.clinic_slug : null,
      clinicId: typeof params.clinic_id === "string" ? params.clinic_id : null,
      host: requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host"),
    });
  } catch {
    clinicId = null;
  }
  const clinic = await getClinic(clinicId);
  const basicId = clinic?.line_basic_id?.trim() || null;
  const lineAddUrl = basicId ? `https://line.me/R/ti/p/${encodeURIComponent(basicId)}` : null;
  const clinicSlug = typeof params.clinic_slug === "string" ? params.clinic_slug : null;
  const clinicIdParam = typeof params.clinic_id === "string" ? params.clinic_id : null;
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

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-6 p-6">
      <Brand name={clinic?.name} align="center" size="lg" subtitle="線上預約" />

      <div className="card w-full overflow-hidden">
        <div className="bg-gradient-to-br from-brand-500 to-accent-600 p-6 text-center text-white">
          <h1 className="text-xl font-bold">{clinic?.name ?? "預約與報名平台"}</h1>
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
              <span className="text-lg">💬</span> 加入 LINE · 線上預約
            </a>
          ) : (
            <p className="rounded-xl bg-slate-50 p-3 text-center text-sm text-slate-400">
              尚未設定 LINE 官方帳號 ID(可至後台「診所設定 → 公開診所資訊」填入)。
            </p>
          )}

          {liffUrl && (
            <a href={liffUrl} target="_blank" rel="noreferrer" className="btn btn-secondary w-full">
              已加好友?直接預約
            </a>
          )}

          <Link href={browserBookingUrl} className="btn btn-secondary w-full">
            瀏覽器備援預約
          </Link>
          <Link href={registrationUrl} className="btn btn-secondary w-full">
            查看課程與活動報名
          </Link>
          <Link href="/register/cancel" className="text-center text-sm text-slate-400 hover:text-brand-600">
            取消既有活動報名
          </Link>

          {basicId && (
            <p className="text-center text-xs text-slate-400">LINE ID:{basicId}</p>
          )}
        </div>
      </div>

      <Link href="/admin" className="text-sm text-slate-400 hover:text-brand-600">
        櫃檯人員登入後台 →
      </Link>
    </main>
  );
}
