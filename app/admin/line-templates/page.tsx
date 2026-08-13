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
  if (!(await isAdminModuleEnabled(supabase, clinicId, "line"))) return <ModuleDisabled title="LINE UI 模板" />;
  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="eyebrow">LINE customer journey</p><h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900">LINE UI 模板中心</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">用 Rich Menu 負責入口、Flex 卡片負責狀態與下一步、LIFF 負責完整操作。以下涵蓋顧客從加入好友到回訪的標準顯示。</p></div>
        <div className="flex min-h-11 flex-wrap gap-2"><Link href="/admin/richmenu" className="btn btn-primary min-h-11">設定 Rich Menu 圖稿</Link><Link href="/admin/messages" className="btn btn-secondary min-h-11">編輯行銷素材</Link></div>
      </header>
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="card border-l-4 border-l-[#06C755] p-4"><p className="text-xs font-bold text-slate-400">第一層</p><p className="mt-1 font-bold text-slate-900">Rich Menu 導航</p><p className="mt-1 text-xs leading-5 text-slate-500">六個主入口，不把狀態細節塞進選單。</p></div>
        <div className="card border-l-4 border-l-[#E2B644] p-4"><p className="text-xs font-bold text-slate-400">第二層</p><p className="mt-1 font-bold text-slate-900">Flex 狀態卡</p><p className="mt-1 text-xs leading-5 text-slate-500">一張卡只處理一個狀態與主要任務。</p></div>
        <div className="card border-l-4 border-l-[#173F48] p-4"><p className="text-xs font-bold text-slate-400">完整操作</p><p className="mt-1 font-bold text-slate-900">LIFF 服務頁</p><p className="mt-1 text-xs leading-5 text-slate-500">預約、付款、票券、會員都在安全頁面完成。</p></div>
      </section>
      <LineTemplateGallery />
    </div>
  );
}
