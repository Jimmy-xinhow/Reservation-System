import { NextRequest, NextResponse } from "next/server";
import { canViewSensitiveCustomerData, getAssignedDoctorIds, requireMember } from "@/lib/admin";
import { createSupabaseServer } from "@/lib/supabase-server";

interface AppointmentRow {
  id: string;
  doctor_id: string | null;
  start_at: string;
  end_at: string;
  status: string;
  visit_type: string;
  deposit_status: string;
  doctors: { name: string } | { name: string }[] | null;
  patients: { name: string; phone: string } | { name: string; phone: string }[] | null;
  services: { name: string } | { name: string }[] | null;
}

const STATUS: Record<string, { label: string; color: string; text: string }> = {
  booked: { label: "待確認", color: "#dbeafe", text: "#1e40af" },
  confirmed: { label: "已確認", color: "#d1fae5", text: "#065f46" },
  done: { label: "已完成", color: "#e2e8f0", text: "#334155" },
  no_show: { label: "未到", color: "#fef3c7", text: "#92400e" },
  cancelled: { label: "已取消", color: "#fee2e2", text: "#991b1b" },
};

function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function maskPhone(value: string | undefined): string { return value && value.length > 4 ? `${"•".repeat(value.length - 4)}${value.slice(-4)}` : "未提供"; }

export async function GET(request: NextRequest) {
  try {
    const member = await requireMember();
    const start = new Date(request.nextUrl.searchParams.get("start") ?? "");
    const end = new Date(request.nextUrl.searchParams.get("end") ?? "");
    const doctorId = request.nextUrl.searchParams.get("doctor")?.trim() ?? "";
    if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start >= end) return NextResponse.json({ error: "日期範圍不正確" }, { status: 400 });
    if (end.getTime() - start.getTime() > 100 * 86400000) return NextResponse.json({ error: "一次最多載入 100 天" }, { status: 400 });

    const supabase = await createSupabaseServer();
    const assigned = member.role === "provider" ? await getAssignedDoctorIds(member) : [];
    let query = supabase.from("appointments").select("id, doctor_id, start_at, end_at, status, visit_type, deposit_status, doctors(name), patients(name, phone), services(name)").eq("clinic_id", member.clinicId).gte("start_at", start.toISOString()).lt("start_at", end.toISOString()).order("start_at");
    if (member.role === "provider") query = query.in("doctor_id", assigned.length ? assigned : ["00000000-0000-0000-0000-000000000000"]);
    if (doctorId) query = query.eq("doctor_id", doctorId);
    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const showPii = canViewSensitiveCustomerData(member.role);
    const events = ((data ?? []) as unknown as AppointmentRow[]).map((row) => {
      const patient = one(row.patients);
      const service = one(row.services);
      const doctor = one(row.doctors);
      const state = STATUS[row.status] ?? { label: "其他狀態", color: "#f1f5f9", text: "#334155" };
      const customerName = patient?.name ?? "未命名顧客";
      const serviceName = service?.name ?? "未指定服務";
      return {
        id: row.id,
        title: `${customerName} · ${serviceName}`,
        start: row.start_at,
        end: row.end_at,
        backgroundColor: state.color,
        borderColor: state.text,
        textColor: state.text,
        extendedProps: {
          status: row.status,
          statusLabel: state.label,
          customerName,
          customerPhone: showPii ? (patient?.phone ?? "未提供") : maskPhone(patient?.phone),
          serviceName,
          providerName: doctor?.name ?? "未指定",
          visitType: row.visit_type,
          depositStatus: row.deposit_status,
        },
      };
    });
    return NextResponse.json({ events }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "日曆資料載入失敗";
    return NextResponse.json({ error: message }, { status: message.includes("登入") ? 401 : 500 });
  }
}
