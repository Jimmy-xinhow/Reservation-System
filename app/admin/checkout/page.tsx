import Link from "next/link";
import { requireNonProvider } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase-server";
import { SubmitButton } from "@/components/SubmitButton";
import { addCatalogSalesItemAction, addCustomSalesItemAction, createSalesOrderAction, recordSalesPaymentAction } from "./actions";

export const dynamic = "force-dynamic";

interface SalesItem { id: string; kind: string; name: string; quantity: number; unit_price: number; line_total: number; created_at: string; }
interface SalesPayment { id: string; method: string; amount: number; reference: string | null; received_at: string; }
interface SalesOrder {
  id: string; order_no: string; appointment_id: string | null; registration_id: string | null; status: string;
  subtotal: number; discount_amount: number; total_amount: number; paid_amount: number; note: string | null; created_at: string;
  patients: { name: string; phone: string } | { name: string; phone: string }[] | null;
  sales_order_items: SalesItem[] | null; sales_payments: SalesPayment[] | null;
}
interface AppointmentOption { id: string; start_at: string; status: string; patients: { name: string } | { name: string }[] | null; services: { name: string } | { name: string }[] | null; }
interface RegistrationOption { id: string; registration_no: string; name: string; status: string; events: { title: string } | { title: string }[] | null; }

const STATUS_LABEL: Record<string, string> = { open: "待收款", partially_paid: "部分收款", paid: "已結清", void: "已作廢" };
const PAYMENT_LABEL: Record<string, string> = { cash: "現金", card: "刷卡", transfer: "轉帳", online: "線上付款", other: "其他" };
const ITEM_LABEL: Record<string, string> = { service: "服務", product: "商品", package: "套票", custom: "自訂" };

function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function money(value: number): string { return `NT$${Number(value).toLocaleString("zh-TW")}`; }
function dateTime(value: string): string { return new Intl.DateTimeFormat("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)); }

export default async function CheckoutPage({ searchParams }: { searchParams: Promise<{ order_id?: string; appointment_id?: string; registration_id?: string }> }) {
  const member = await requireNonProvider();
  const params = await searchParams;
  const supabase = await createSupabaseServer();
  const recentStart = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
  const [ordersResult, appointmentsResult, registrationsResult, patientsResult, servicesResult, inventoryResult, plansResult] = await Promise.all([
    supabase.from("sales_orders").select("id, order_no, appointment_id, registration_id, status, subtotal, discount_amount, total_amount, paid_amount, note, created_at, patients(name, phone), sales_order_items(id, kind, name, quantity, unit_price, line_total, created_at), sales_payments(id, method, amount, reference, received_at)").eq("clinic_id", member.clinicId).order("created_at", { ascending: false }).limit(100),
    supabase.from("appointments").select("id, start_at, status, patients(name), services(name)").eq("clinic_id", member.clinicId).gte("start_at", recentStart).in("status", ["booked", "confirmed", "done"]).order("start_at", { ascending: false }).limit(100),
    supabase.from("registrations").select("id, registration_no, name, status, events(title)").eq("clinic_id", member.clinicId).gte("created_at", recentStart).in("status", ["pending", "confirmed", "attended"]).order("created_at", { ascending: false }).limit(100),
    supabase.from("patients").select("id, name, phone").eq("clinic_id", member.clinicId).eq("active", true).order("name").limit(300),
    supabase.from("services").select("id, name, price").eq("clinic_id", member.clinicId).eq("active", true).order("name"),
    supabase.from("inventory_items").select("id, name, retail_price, stock_on_hand, unit").eq("clinic_id", member.clinicId).eq("active", true).order("name"),
    supabase.from("membership_plans").select("id, name, price").eq("clinic_id", member.clinicId).eq("active", true).order("name"),
  ]);
  const firstError = [ordersResult.error, appointmentsResult.error, registrationsResult.error, patientsResult.error, servicesResult.error, inventoryResult.error, plansResult.error].find(Boolean);
  if (firstError) throw new Error(firstError.message);
  const orders = (ordersResult.data ?? []) as unknown as SalesOrder[];
  const appointments = (appointmentsResult.data ?? []) as unknown as AppointmentOption[];
  const registrations = (registrationsResult.data ?? []) as unknown as RegistrationOption[];
  const selected = orders.find((order) => order.id === params.order_id) ?? null;
  const outstanding = orders.filter((order) => order.status === "open" || order.status === "partially_paid").reduce((sum, order) => sum + order.total_amount - order.paid_amount, 0);
  const todayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
  const receivedToday = orders.filter((order) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date(order.created_at)) === todayKey).reduce((sum, order) => sum + order.paid_amount, 0);
  const defaultSource = params.appointment_id ? `appointment:${params.appointment_id}` : params.registration_id ? `registration:${params.registration_id}` : "";
  const selectedItems = [...(selected?.sales_order_items ?? [])].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const selectedPayments = [...(selected?.sales_payments ?? [])].sort((a, b) => b.received_at.localeCompare(a.received_at));
  const remaining = selected ? selected.total_amount - selected.paid_amount : 0;

  return <div className="admin-page">
    <div className="admin-page-header"><div><p className="eyebrow">預約營運</p><h1 className="admin-page-title">結帳中心</h1><p className="admin-page-description">將預約、活動報名、套票與現場商品放在同一張銷售單，清楚追蹤已收與未收。</p></div><Link href="/admin/services" className="btn btn-secondary">設定服務售價</Link></div>
    <div className="admin-metric-strip"><div className="admin-metric"><span className="admin-metric-label">銷售單</span><strong className="admin-metric-value">{orders.length}</strong></div><div className="admin-metric"><span className="admin-metric-label">今日已收</span><strong className="admin-metric-value">{money(receivedToday)}</strong></div><div className="admin-metric"><span className="admin-metric-label">目前未收</span><strong className="admin-metric-value text-amber-700">{money(outstanding)}</strong></div></div>

    <details className="admin-section" open={Boolean(defaultSource)}><summary className="cursor-pointer px-4 py-3 font-semibold text-slate-800">建立銷售單</summary><form action={createSalesOrderAction} className="grid gap-3 border-t border-slate-200 p-4 lg:grid-cols-6">
      <label className="text-sm lg:col-span-3"><span className="label">結帳來源</span><select name="source" className="input" defaultValue={defaultSource} required><option value="" disabled>選擇預約、報名或現場顧客</option><optgroup label="近期預約">{appointments.map((appointment) => { const patient = one(appointment.patients); const service = one(appointment.services); return <option key={appointment.id} value={`appointment:${appointment.id}`}>{dateTime(appointment.start_at)} · {patient?.name ?? "顧客"} · {service?.name ?? "一般服務"}</option>; })}</optgroup><optgroup label="近期活動報名">{registrations.map((registration) => <option key={registration.id} value={`registration:${registration.id}`}>{registration.registration_no} · {registration.name} · {one(registration.events)?.title ?? "活動"}</option>)}</optgroup><optgroup label="現場顧客">{(patientsResult.data ?? []).map((patient) => <option key={patient.id} value={`patient:${patient.id}`}>{patient.name} · {patient.phone}</option>)}</optgroup></select></label>
      <label className="text-sm"><span className="label">整單折扣</span><input name="discount_amount" type="number" min="0" defaultValue="0" className="input" /></label><label className="text-sm lg:col-span-2"><span className="label">備註</span><input name="note" className="input" maxLength={500} placeholder="選填" /></label><div className="lg:col-span-6"><SubmitButton className="btn btn-primary">建立並開啟銷售單</SubmitButton></div>
    </form></details>

    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(380px,.85fr)]">
      <section className="admin-table-shell"><div className="admin-section-header"><div><h2 className="font-semibold text-slate-900">最近銷售單</h2><p className="text-xs text-slate-500">最多顯示最近 100 筆</p></div></div><table className="tbl"><thead><tr><th>單號／顧客</th><th>總額</th><th>已收</th><th>狀態</th><th>時間</th></tr></thead><tbody>{orders.length === 0 ? <tr><td colSpan={5} className="py-10 text-center text-slate-400">尚無銷售單</td></tr> : orders.map((order) => { const patient = one(order.patients); return <tr key={order.id} className={selected?.id === order.id ? "bg-brand-50/50" : ""}><td><Link href={`/admin/checkout?order_id=${order.id}`} className="font-semibold text-brand-700 hover:underline">{order.order_no}</Link><div className="text-xs text-slate-500">{patient?.name ?? "未綁定顧客"}</div></td><td>{money(order.total_amount)}</td><td>{money(order.paid_amount)}{order.total_amount > order.paid_amount && <div className="text-xs text-amber-700">未收 {money(order.total_amount - order.paid_amount)}</div>}</td><td><span className={`badge ${order.status === "paid" ? "bg-emerald-50 text-emerald-700" : order.status === "partially_paid" ? "bg-amber-50 text-amber-700" : "bg-slate-100 text-slate-600"}`}>{STATUS_LABEL[order.status] ?? order.status}</span></td><td className="text-xs text-slate-500">{dateTime(order.created_at)}</td></tr>; })}</tbody></table></section>

      <section className="admin-section self-start">{!selected ? <div className="px-5 py-16 text-center"><h2 className="font-semibold text-slate-800">選擇一張銷售單</h2><p className="mt-2 text-sm text-slate-500">點左側單號查看明細、加購與收款。</p></div> : <><div className="admin-section-header"><div><p className="text-xs text-slate-500">{selected.order_no}</p><h2 className="font-semibold text-slate-900">{one(selected.patients)?.name ?? "現場銷售"}</h2></div><span className="badge bg-slate-100 text-slate-600">{STATUS_LABEL[selected.status] ?? selected.status}</span></div><div className="space-y-5 p-4">
        <div className="grid grid-cols-3 gap-3 border-b border-slate-200 pb-4 text-sm"><div><p className="text-xs text-slate-500">小計</p><p className="mt-1 font-semibold">{money(selected.subtotal)}</p></div><div><p className="text-xs text-slate-500">折扣</p><p className="mt-1 font-semibold">{money(selected.discount_amount)}</p></div><div><p className="text-xs text-slate-500">未收</p><p className="mt-1 font-semibold text-amber-700">{money(remaining)}</p></div></div>
        <div><h3 className="mb-2 text-sm font-semibold text-slate-800">銷售明細</h3><div className="overflow-hidden rounded-md border border-slate-200"><table className="tbl"><thead><tr><th>品項</th><th>數量</th><th>金額</th></tr></thead><tbody>{selectedItems.length === 0 ? <tr><td colSpan={3} className="py-6 text-center text-slate-400">尚無品項</td></tr> : selectedItems.map((item) => <tr key={item.id}><td><div className="font-medium">{item.name}</div><div className="text-xs text-slate-400">{ITEM_LABEL[item.kind] ?? item.kind} · 單價 {money(item.unit_price)}</div></td><td>{Number(item.quantity).toLocaleString("zh-TW")}</td><td>{money(item.line_total)}</td></tr>)}</tbody></table></div></div>
        {selected.status !== "paid" && selected.status !== "void" && <><form action={addCatalogSalesItemAction} className="grid gap-2 sm:grid-cols-[1fr_90px_auto]"><input type="hidden" name="order_id" value={selected.id} /><label className="text-sm"><span className="label">加入既有品項</span><select name="catalog_item" className="input" required defaultValue=""><option value="" disabled>服務、商品或套票</option><optgroup label="服務">{(servicesResult.data ?? []).map((item) => <option key={item.id} value={`service:${item.id}`}>{item.name} · {money(item.price)}</option>)}</optgroup><optgroup label="商品">{(inventoryResult.data ?? []).map((item) => <option key={item.id} value={`product:${item.id}`}>{item.name} · {money(item.retail_price)} · 庫存 {item.stock_on_hand}{item.unit}</option>)}</optgroup><optgroup label="套票">{(plansResult.data ?? []).map((item) => <option key={item.id} value={`package:${item.id}`}>{item.name} · {money(item.price)}</option>)}</optgroup></select></label><label className="text-sm"><span className="label">數量</span><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" className="input" required /></label><SubmitButton className="btn btn-secondary self-end">加入</SubmitButton></form>
        <form action={addCustomSalesItemAction} className="grid gap-2 sm:grid-cols-[1fr_90px_120px_auto]"><input type="hidden" name="order_id" value={selected.id} /><label className="text-sm"><span className="label">自訂品項</span><input name="name" className="input" maxLength={160} required placeholder="例如：運費／材料費" /></label><label className="text-sm"><span className="label">數量</span><input name="quantity" type="number" min="0.01" step="0.01" defaultValue="1" className="input" required /></label><label className="text-sm"><span className="label">單價</span><input name="unit_price" type="number" min="0" defaultValue="0" className="input" required /></label><SubmitButton className="btn btn-secondary self-end">加入</SubmitButton></form></>}
        <div><h3 className="mb-2 text-sm font-semibold text-slate-800">收款紀錄</h3>{selectedPayments.length === 0 ? <p className="rounded-md bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">尚無收款</p> : <div className="divide-y divide-slate-100 border-y border-slate-200">{selectedPayments.map((payment) => <div key={payment.id} className="flex items-center justify-between py-2 text-sm"><div><span>{PAYMENT_LABEL[payment.method] ?? payment.method}</span><span className="ml-2 text-xs text-slate-400">{dateTime(payment.received_at)}{payment.reference ? ` · ${payment.reference}` : ""}</span></div><strong>{money(payment.amount)}</strong></div>)}</div>}</div>
        {remaining > 0 && selected.status !== "void" && <form action={recordSalesPaymentAction} className="grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2"><input type="hidden" name="order_id" value={selected.id} /><label className="text-sm"><span className="label">收款方式</span><select name="method" className="input" defaultValue="cash"><option value="cash">現金</option><option value="card">刷卡</option><option value="transfer">轉帳</option><option value="online">線上付款</option><option value="other">其他</option></select></label><label className="text-sm"><span className="label">本次收款</span><input name="amount" type="number" min="1" max={remaining} defaultValue={remaining} className="input" required /></label><label className="text-sm sm:col-span-2"><span className="label">交易末碼／備註</span><input name="reference" className="input" maxLength={160} /></label><SubmitButton className="btn btn-primary sm:col-span-2">確認收款</SubmitButton></form>}
      </div></>}</section>
    </div>
  </div>;
}
