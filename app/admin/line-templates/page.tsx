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
    <div className="line-workbench">
      <header className="admin-page-header flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div><p className="eyebrow">LINE 顧客訊息</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">LINE 訊息範本</h1><p className="mt-2 max-w-3xl text-base leading-7 text-slate-600">圖文選單負責帶顧客進入功能，狀態卡片說明目前狀況與下一步，完整的預約、付款或票券操作則在 LINE 內建網頁完成。</p></div>
        <div className="flex min-h-11 flex-wrap gap-2"><Link href="/admin/richmenu" className="btn btn-primary min-h-11">設定 LINE 圖文選單</Link><Link href="/admin/messages" className="btn btn-secondary min-h-11">編輯行銷素材</Link></div>
      </header>
      <section className="line-panel p-0" aria-label="LINE 顧客操作流程">
        <div className="line-panel-header"><div><p className="eyebrow">顧客操作流程</p><h2 className="mt-1 font-semibold text-slate-900">入口、狀態、完成操作</h2></div><span className="badge bg-emerald-50 text-emerald-700">三層分工</span></div>
        <div className="line-status-strip">
          <div className="line-status-step"><span>01</span><div><strong>從圖文選單進入</strong><small>六個主要入口，讓顧客立即找到要做的事。</small></div></div>
          <div className="line-status-step"><span>02</span><div><strong>讀懂目前狀態</strong><small>每則訊息只說明一個結果與一個主要下一步。</small></div></div>
          <div className="line-status-step"><span>03</span><div><strong>在安全頁面完成</strong><small>預約、付款、票券與會員操作不塞在聊天訊息裡。</small></div></div>
        </div>
      </section>
      <LineTemplateGallery />
    </div>
  );
}
