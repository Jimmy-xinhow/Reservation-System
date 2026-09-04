import Link from "next/link";
import { requireAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

const items = [
  { priority:"P1",name:"Google Calendar 雙向同步",status:"等待外部帳號",statusClass:"bg-amber-50 text-amber-700",reuse:"預約、服務人員、排程與例外日期",need:"Google Cloud OAuth Client、每位人員授權、公開 Webhook 網址",next:"先完成正式網域與 Google Cloud 專案" },
  { priority:"P1",name:"台灣電子發票",status:"等待供應商決策",statusClass:"bg-amber-50 text-amber-700",reuse:"結帳單、付款紀錄與顧客 Email",need:"加值中心或 Turnkey、營業人資料、測試帳號、字軌與作廢規則",next:"先選擇電子發票服務商" },
  { priority:"P2",name:"多店／總部分店",status:"需要規則確認",statusClass:"bg-sky-50 text-sky-700",reuse:"多品牌隔離、帳號切換與跨品牌報表",need:"跨店顧客、會員權益、庫存與總部權限的共享界線",next:"先完成資料共享決策表" },
  { priority:"P2",name:"推薦獎勵",status:"可沿用既有核心",statusClass:"bg-emerald-50 text-emerald-700",reuse:"顧客、點數異動帳與結帳單",need:"獎勵觸發、退款追回與防濫用規則",next:"確認雙方獎勵與發放時點" },
  { priority:"P2",name:"簡訊通知",status:"等待外部帳號",statusClass:"bg-amber-50 text-amber-700",reuse:"訊息範本、通知去重與失敗重試",need:"簡訊供應商、單價、退訂與發送時段",next:"LINE／Email 正式驗收後再接" },
] as const;

export default async function AddOnEvaluationPage(){
  await requireAdmin();
  return <div className="admin-page"><div className="admin-page-header"><div><p className="eyebrow">設定中心</p><h1 className="admin-page-title">擴充功能規劃</h1><p className="admin-page-description">這裡只列出依賴、風險與接入順序；尚未取得外部帳號的功能不會顯示成已啟用。</p></div><Link href="/admin/settings" className="btn btn-secondary">返回品牌設定</Link></div>
  <section className="admin-section p-4"><h2 className="font-semibold">本輪已建立的共用底座</h2><div className="mt-3 grid gap-3 md:grid-cols-3"><div className="rounded-lg bg-slate-50 p-3"><strong className="text-sm">訂單與結帳</strong><p className="mt-1 text-xs leading-5 text-slate-500">預約、報名、商品與手動項目共用一張結帳單。</p></div><div className="rounded-lg bg-slate-50 p-3"><strong className="text-sm">顧客價值帳本</strong><p className="mt-1 text-xs leading-5 text-slate-500">儲值、點數與訂閱都有不可覆寫的異動紀錄。</p></div><div className="rounded-lg bg-slate-50 p-3"><strong className="text-sm">三產業營運包</strong><p className="mt-1 text-xs leading-5 text-slate-500">美業、教室會籍、線上課程沿用相同多租戶核心。</p></div></div></section>
  <section className="admin-table-shell"><div className="admin-section-header"><div><h2 className="font-semibold">建議接入順序</h2><p className="text-xs text-slate-500">P1 先處理；P2 等正式渠道驗收或規則確認後再開發。</p></div></div><table className="tbl"><thead><tr><th>順序</th><th>擴充功能</th><th>目前狀態</th><th>沿用既有內容</th><th>接入前缺少什麼</th><th>下一步</th></tr></thead><tbody>{items.map(item=><tr key={item.name}><td className="font-semibold">{item.priority}</td><td className="font-medium">{item.name}</td><td><span className={`badge ${item.statusClass}`}>{item.status}</span></td><td>{item.reuse}</td><td className="max-w-sm text-sm text-slate-600">{item.need}</td><td>{item.next}</td></tr>)}</tbody></table></section>
  <section className="admin-section p-4"><h2 className="font-semibold">採用原則</h2><ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-600 md:grid-cols-2"><li>• 日曆參照 Cal.com 與 Google 官方同步流程，但不搬入 AGPL 程式碼。</li><li>• 採購、庫存與點數參照 ERPNext 的單據與 ledger 思路。</li><li>• 課程完成、測驗與作業參照 Moodle 的活動完成模型。</li><li>• 完整分析與外部規格連結已記錄在 <code>docs/add-on-evaluation-2026-09-04.md</code>。</li></ul></section>
  </div>;
}
