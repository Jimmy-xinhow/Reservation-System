import { createSupabaseServer } from "@/lib/supabase-server";
import { signOutAction } from "./actions";
import { Brand } from "@/components/Brand";
import { AdminNav } from "@/components/AdminNav";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 未登入(例如登入頁)不顯示導覽列
  if (!user) return <>{children}</>;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/85 backdrop-blur">
        <div className="mx-auto max-w-5xl px-4">
          <div className="flex items-center gap-4 py-3">
            <Brand subtitle="櫃檯後台" />
            <form action={signOutAction} className="ml-auto">
              <button className="btn btn-ghost px-3 py-1.5 text-sm">登出</button>
            </form>
          </div>
          <div className="pb-2">
            <AdminNav />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4 sm:p-6">{children}</main>
    </div>
  );
}
