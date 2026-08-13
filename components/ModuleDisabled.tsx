import Link from "next/link";

export function ModuleDisabled({ title }: { title: string }) {
  return (
    <section className="card mx-auto max-w-2xl space-y-3 p-6 text-center">
      <p className="eyebrow">功能未啟用</p>
      <h1 className="text-xl font-bold text-slate-900">{title}</h1>
      <p className="text-sm leading-6 text-slate-500">此品牌目前未啟用這個標準模組，因此不顯示營運資料與操作入口。</p>
      <Link href="/admin/settings" className="btn btn-primary inline-flex">前往設定中心</Link>
    </section>
  );
}
