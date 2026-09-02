import Link from "next/link";
import { ModuleDisabled } from "@/components/ModuleDisabled";
import { isAdminModuleEnabled } from "@/lib/admin-modules";
import { requireAdmin } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase-server";
import LineTemplateGallery from "./LineTemplateGallery";

export const dynamic = "force-dynamic";

export default async function LineTemplatesPage() {
  const { clinicId } = await requireAdmin();
  const supabase = await createSupabaseServer();
  if (!(await isAdminModuleEnabled(supabase, clinicId, "line"))) return <ModuleDisabled title="LINE 訊息範本" />;
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="eyebrow">LINE 顧客訊息</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">LINE 訊息範本</h1><p className="mt-2 max-w-3xl text-base leading-7 text-slate-600">圖文選單負責帶顧客進入功能，狀態卡片說明目前狀況與下一步，完整的預約、付款或票券操作則在 LINE 內建網頁完成。</p></div>
        <div className="flex min-h-11 flex-wrap gap-2"><Link href="/admin/richmenu" className="btn btn-primary min-h-11">設定 LINE 圖文選單</Link><Link href="/admin/messages" className="btn btn-secondary min-h-11">編輯行銷素材</Link></div>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card border-l-4 border-l-[#06C755] p-4"><p className="text-xs font-bold text-slate-500">第一層</p><p className="mt-1 font-bold text-slate-900">LINE 圖文選單</p><p className="mt-1 text-sm leading-6 text-slate-600">保留六個主要入口，讓顧客快速找到功能。</p></div>
        <div className="card border-l-4 border-l-[#E2B644] p-4"><p className="text-xs font-bold text-slate-500">第二層</p><p className="mt-1 font-bold text-slate-900">狀態與下一步卡片</p><p className="mt-1 text-sm leading-6 text-slate-600">一張卡只說明一個狀態與最重要的下一步。</p></div>
        <div className="card border-l-4 border-l-[#173F48] p-4"><p className="text-xs font-bold text-slate-500">完整操作</p><p className="mt-1 font-bold text-slate-900">LINE 內建服務頁</p><p className="mt-1 text-sm leading-6 text-slate-600">預約、付款、票券與會員操作都在安全頁面完成。</p></div>
      </section>
      <LineTemplateGallery />
    </div>
  );
}
