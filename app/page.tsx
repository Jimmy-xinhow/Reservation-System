import Link from "next/link";
import { Brand } from "@/components/Brand";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center gap-8 p-6">
      <Brand align="center" size="lg" subtitle="線上預約系統" />

      <div className="card w-full p-6 text-center">
        <h1 className="text-lg font-bold text-slate-900">歡迎預約看診</h1>
        <p className="mt-2 text-sm leading-relaxed text-slate-500">
          病患請由 LINE 官方帳號的選單進入預約;
          <br />
          看診前我們會以 LINE 提醒您。
        </p>

        <div className="mt-6 grid grid-cols-3 gap-3 text-center">
          <Feature icon="🗓️" label="線上預約" />
          <Feature icon="🔔" label="看診提醒" />
          <Feature icon="✅" label="確認/取消" />
        </div>
      </div>

      <Link href="/admin" className="text-sm text-slate-400 hover:text-brand-600">
        櫃檯人員登入後台 →
      </Link>
    </main>
  );
}

function Feature({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <div className="text-xl">{icon}</div>
      <div className="mt-1 text-xs font-medium text-slate-600">{label}</div>
    </div>
  );
}
