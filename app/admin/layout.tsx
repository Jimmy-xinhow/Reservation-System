import Link from "next/link";
import { createSupabaseServer } from "@/lib/supabase-server";
import { signOutAction } from "./actions";

const NAV = [
  { href: "/admin", label: "今日約診" },
  { href: "/admin/schedules", label: "門診表" },
  { href: "/admin/exceptions", label: "休診/加診" },
  { href: "/admin/patients", label: "病患查詢" },
  { href: "/admin/settings", label: "診所設定" },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createSupabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // 未登入(例如登入頁)不顯示導覽列
  if (!user) return <>{children}</>;

  return (
    <div className="min-h-screen">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-bold">診所後台</span>
          <nav className="flex flex-wrap gap-3 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-gray-600 hover:text-blue-600">
                {n.label}
              </Link>
            ))}
          </nav>
          <form action={signOutAction} className="ml-auto">
            <button className="text-sm text-gray-500 hover:text-red-600">登出</button>
          </form>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">{children}</main>
    </div>
  );
}
