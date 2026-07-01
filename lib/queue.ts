import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

const TZ = "Asia/Taipei";

/** 該 ISO 時刻在台北的時分秒(HH:MM:SS),用來判斷落在哪個門診段。 */
function taipeiTod(iso: string): string {
  const p = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(iso));
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00";
  return `${g("hour")}:${g("minute")}:${g("second")}`;
}

function weekdayOf(date: string): number {
  return new Date(`${date}T12:00:00Z`).getUTCDay(); // 0=日..6=六
}

export function taipeiToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

export interface QueueAppt {
  id: string;
  patientId: string;
  seq: number;
  name: string;
  status: string;
  start_at: string;
}
export interface QueueSession {
  key: string;
  doctorId: string;
  doctorName: string;
  label: string;
  startAt: string;
  current: number;
  appts: QueueAppt[];
}

interface SessRow {
  id: string;
  doctor_id: string;
  start_time: string;
  end_time: string;
}

function hhmm(t: string) {
  return (t ?? "").slice(0, 5);
}

/** 取得某日各門診段的叫號狀態與序號清單。 */
export async function getQueueForDate(
  svc: SupabaseClient,
  clinicId: string,
  date: string,
  mode: "time" | "number",
  doctorId?: string,
): Promise<QueueSession[]> {
  const weekday = weekdayOf(date);
  const dayStart = new Date(`${date}T00:00:00+08:00`).toISOString();
  const dayEnd = new Date(`${date}T23:59:59.999+08:00`).toISOString();

  // 門診段來源:當天 weekday 的模板 + 當天加診
  let tplQ = svc
    .from("schedule_templates")
    .select("id, doctor_id, start_time, end_time")
    .eq("clinic_id", clinicId)
    .eq("weekday", weekday)
    .eq("active", true);
  if (doctorId) tplQ = tplQ.eq("doctor_id", doctorId);

  let excQ = svc
    .from("schedule_exceptions")
    .select("id, doctor_id, start_time, end_time")
    .eq("clinic_id", clinicId)
    .eq("date", date)
    .eq("is_closed", false);
  if (doctorId) excQ = excQ.eq("doctor_id", doctorId);

  let apptQ = svc
    .from("appointments")
    .select(
      "id, doctor_id, template_id, start_at, queue_number, created_at, status, patient_id, patients(name), doctors(name)",
    )
    .eq("clinic_id", clinicId)
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd)
    .in("status", ["booked", "confirmed", "done", "no_show"]);
  if (doctorId) apptQ = apptQ.eq("doctor_id", doctorId);

  let servQ = svc
    .from("serving_numbers")
    .select("doctor_id, session_key, current_number")
    .eq("clinic_id", clinicId)
    .eq("date", date);
  if (doctorId) servQ = servQ.eq("doctor_id", doctorId);

  const [{ data: tpls }, { data: excs }, { data: appts }, { data: serv }] = await Promise.all([
    tplQ,
    excQ,
    apptQ,
    servQ,
  ]);

  const sessRows: SessRow[] = [
    ...((tpls ?? []) as SessRow[]),
    ...((excs ?? []) as SessRow[]),
  ];
  const sessById = new Map(sessRows.map((s) => [s.id, s]));
  const servMap = new Map(
    (serv ?? []).map((s) => [`${s.doctor_id}|${s.session_key}`, s.current_number as number]),
  );

  // 把每筆約診歸到一個門診段 key
  type Row = {
    id: string;
    doctor_id: string;
    template_id: string | null;
    start_at: string;
    queue_number: number | null;
    created_at: string;
    status: string;
    patient_id: string;
    patients: { name: string } | null;
    doctors: { name: string } | null;
  };
  const rows = (appts ?? []) as unknown as Row[];

  const groups = new Map<string, { doctorId: string; doctorName: string; rows: Row[] }>();
  for (const r of rows) {
    let key: string;
    if (mode === "number") {
      key = r.template_id ?? "other";
    } else {
      const tod = taipeiTod(r.start_at);
      const match = sessRows.find(
        (s) => s.doctor_id === r.doctor_id && hhmmss(s.start_time) <= tod && tod < hhmmss(s.end_time),
      );
      key = match?.id ?? "other";
    }
    const gk = `${r.doctor_id}|${key}`;
    const g = groups.get(gk) ?? {
      doctorId: r.doctor_id,
      doctorName: r.doctors?.name ?? "",
      rows: [],
    };
    g.rows.push(r);
    groups.set(gk, g);
  }

  const sessions: QueueSession[] = [];
  for (const [gk, g] of groups) {
    const key = gk.split("|").slice(1).join("|");
    const sorted = [...g.rows].sort((a, b) => {
      if (mode === "number") return (a.queue_number ?? 0) - (b.queue_number ?? 0);
      return a.start_at < b.start_at ? -1 : a.start_at > b.start_at ? 1 : a.created_at < b.created_at ? -1 : 1;
    });
    const appts: QueueAppt[] = sorted.map((r, i) => ({
      id: r.id,
      patientId: r.patient_id,
      seq: mode === "number" ? (r.queue_number ?? i + 1) : i + 1,
      name: r.patients?.name ?? "",
      status: r.status,
      start_at: r.start_at,
    }));
    const sess = sessById.get(key);
    const label = sess
      ? `${hhmm(sess.start_time)}–${hhmm(sess.end_time)}`
      : mode === "number"
        ? "診次"
        : "其他";
    sessions.push({
      key,
      doctorId: g.doctorId,
      doctorName: g.doctorName,
      label,
      startAt: sorted[0]?.start_at ?? dayStart,
      current: servMap.get(`${g.doctorId}|${key}`) ?? 0,
      appts,
    });
  }

  sessions.sort((a, b) => (a.startAt < b.startAt ? -1 : a.startAt > b.startAt ? 1 : 0));
  return sessions;
}

function hhmmss(t: string): string {
  // 將 "09:00" / "09:00:00" 正規化成 HH:MM:SS 方便字串比較
  const parts = (t ?? "").split(":");
  const h = (parts[0] ?? "00").padStart(2, "0");
  const m = (parts[1] ?? "00").padStart(2, "0");
  const s = (parts[2] ?? "00").padStart(2, "0");
  return `${h}:${m}:${s}`;
}

export interface PatientQueueItem {
  doctorName: string;
  label: string;
  yourNumber: number;
  current: number;
  status: string;
  start_at: string;
}

/** 取得某 LINE 身分今日約診的叫號進度。 */
export async function getPatientQueueToday(
  svc: SupabaseClient,
  clinicId: string,
  lineUserId: string,
  mode: "time" | "number",
): Promise<PatientQueueItem[]> {
  const { data: patients } = await svc
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("line_user_id", lineUserId);
  const ids = new Set((patients ?? []).map((p) => p.id as string));
  if (ids.size === 0) return [];

  const date = taipeiToday();
  const sessions = await getQueueForDate(svc, clinicId, date, mode);
  const out: PatientQueueItem[] = [];
  for (const s of sessions) {
    for (const a of s.appts) {
      if (ids.has(a.patientId) && a.status !== "cancelled") {
        out.push({
          doctorName: s.doctorName,
          label: s.label,
          yourNumber: a.seq,
          current: s.current,
          status: a.status,
          start_at: a.start_at,
        });
      }
    }
  }
  return out;
}
