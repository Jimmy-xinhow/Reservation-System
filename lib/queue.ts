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
  source: "online" | "offline";
}
export interface QueueSession {
  key: string;
  doctorId: string;
  doctorName: string;
  label: string;
  startAt: string;
  sessionStart: string | null; // 診次表定開始(ISO);無排程時為 null
  sessionEnd: string | null; // 診次表定結束(ISO)
  onlineCurrent: number;
  offlineCurrent: number;
  autoEvery: number;
  online: QueueAppt[];
  offline: QueueAppt[];
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
      "id, doctor_id, template_id, start_at, queue_number, created_at, status, source, patient_id, patients(name), doctors(name)",
    )
    .eq("clinic_id", clinicId)
    .gte("start_at", dayStart)
    .lte("start_at", dayEnd)
    .in("status", ["booked", "confirmed", "done", "no_show"]);
  if (doctorId) apptQ = apptQ.eq("doctor_id", doctorId);

  let servQ = svc
    .from("serving_numbers")
    .select("doctor_id, session_key, online_current, offline_current, auto_every")
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
    (serv ?? []).map((s) => [
      `${s.doctor_id}|${s.session_key}`,
      {
        online: (s.online_current as number) ?? 0,
        offline: (s.offline_current as number) ?? 0,
        auto: (s.auto_every as number) ?? 0,
      },
    ]),
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
    source: string | null;
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

  // 依來源分別編號(線上一串、現場一串)
  const numberStream = (list: Row[]): QueueAppt[] => {
    const sorted = [...list].sort((a, b) =>
      a.start_at < b.start_at ? -1 : a.start_at > b.start_at ? 1 : a.created_at < b.created_at ? -1 : 1,
    );
    return sorted.map((r, i) => ({
      id: r.id,
      patientId: r.patient_id,
      seq: i + 1,
      name: r.patients?.name ?? "",
      status: r.status,
      start_at: r.start_at,
      source: r.source === "offline" ? "offline" : "online",
    }));
  };

  const sessions: QueueSession[] = [];
  for (const [gk, g] of groups) {
    const key = gk.split("|").slice(1).join("|");
    const online = numberStream(g.rows.filter((r) => r.source !== "offline"));
    const offline = numberStream(g.rows.filter((r) => r.source === "offline"));
    const sess = sessById.get(key);
    const label = sess
      ? `${hhmm(sess.start_time)}–${hhmm(sess.end_time)}`
      : mode === "number"
        ? "診次"
        : "其他";
    const state = servMap.get(`${g.doctorId}|${key}`);
    const startAt = [...online, ...offline].sort((a, b) => (a.start_at < b.start_at ? -1 : 1))[0]?.start_at ?? dayStart;
    const sessionStart = sess ? new Date(`${date}T${hhmm(sess.start_time)}:00+08:00`).toISOString() : null;
    const sessionEnd = sess ? new Date(`${date}T${hhmm(sess.end_time)}:00+08:00`).toISOString() : null;
    sessions.push({
      key,
      doctorId: g.doctorId,
      doctorName: g.doctorName,
      label,
      startAt,
      sessionStart,
      sessionEnd,
      onlineCurrent: state?.online ?? 0,
      offlineCurrent: state?.offline ?? 0,
      autoEvery: state?.auto ?? 0,
      online,
      offline,
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

/**
 * 現在(台北時間)是否為看診時間:任一醫師落在其門診段(當日模板+加診),
 * 且未被當日休診(整天或該時段)涵蓋,即視為看診中。
 */
export async function isClinicOpenNow(svc: SupabaseClient, clinicId: string): Promise<boolean> {
  const date = taipeiToday();
  const weekday = weekdayOf(date);
  const now = taipeiTod(new Date().toISOString());

  const [{ data: tpls }, { data: excs }] = await Promise.all([
    svc
      .from("schedule_templates")
      .select("doctor_id, start_time, end_time")
      .eq("clinic_id", clinicId)
      .eq("weekday", weekday)
      .eq("active", true),
    svc
      .from("schedule_exceptions")
      .select("doctor_id, start_time, end_time, is_closed")
      .eq("clinic_id", clinicId)
      .eq("date", date),
  ]);

  type Seg = { start: string; end: string };
  const openByDoctor = new Map<string, Seg[]>();
  const add = (map: Map<string, Seg[]>, doctorId: string, seg: Seg) => {
    const arr = map.get(doctorId) ?? [];
    arr.push(seg);
    map.set(doctorId, arr);
  };

  for (const t of tpls ?? [])
    add(openByDoctor, t.doctor_id as string, { start: hhmmss(t.start_time as string), end: hhmmss(t.end_time as string) });

  const closedWholeDay = new Set<string>();
  const closedRanges = new Map<string, Seg[]>();
  for (const e of excs ?? []) {
    const doctorId = e.doctor_id as string;
    if (e.is_closed === false) {
      if (e.start_time)
        add(openByDoctor, doctorId, { start: hhmmss(e.start_time as string), end: hhmmss(e.end_time as string) });
    } else {
      if (!e.start_time) closedWholeDay.add(doctorId);
      else
        add(closedRanges, doctorId, {
          start: hhmmss(e.start_time as string),
          end: hhmmss((e.end_time as string) || (e.start_time as string)),
        });
    }
  }

  for (const [doctorId, segs] of openByDoctor) {
    if (closedWholeDay.has(doctorId)) continue;
    if (!segs.some((s) => s.start <= now && now < s.end)) continue;
    const inClosed = (closedRanges.get(doctorId) ?? []).some((s) => s.start <= now && now < s.end);
    if (!inClosed) return true;
  }
  return false;
}

export interface PatientQueueItem {
  doctorName: string;
  label: string;
  yourNumber: number;
  current: number;
  status: string;
  start_at: string;
  source: "online" | "offline";
}

/** 取得某 LINE 身分今日約診的叫號進度(依線上/現場各自的目前叫號)。 */
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
    for (const a of [...s.online, ...s.offline]) {
      if (ids.has(a.patientId) && a.status !== "cancelled") {
        out.push({
          doctorName: s.doctorName,
          label: s.label,
          yourNumber: a.seq,
          current: a.source === "offline" ? s.offlineCurrent : s.onlineCurrent,
          status: a.status,
          start_at: a.start_at,
          source: a.source,
        });
      }
    }
  }
  return out;
}
