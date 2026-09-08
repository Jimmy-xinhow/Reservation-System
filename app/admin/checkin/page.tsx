"use client";

import { useEffect, useMemo, useRef, useState } from "react";

interface CheckinResult { registration_id: string; registration_status: string; checked_in_at: string; result: string; }
interface SearchRow {
  id: string; event_id: string; session_id: string; registration_no: string; status: string; name: string; phone: string; email: string | null;
  events: { title: string } | { title: string }[] | null;
  event_sessions: { name: string; start_at: string } | { name: string; start_at: string }[] | null;
}
type LiveRow = SearchRow;
function one<T>(value: T | T[] | null): T | null { return Array.isArray(value) ? value[0] ?? null : value; }
function taipeiToday(): string { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date()); }
function time(value: string): string { return new Date(value).toLocaleTimeString("zh-TW", { timeZone: "Asia/Taipei", hour: "2-digit", minute: "2-digit", hour12: false }); }

export default function CheckinPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const [token, setToken] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchRows, setSearchRows] = useState<SearchRow[]>([]);
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [liveRows, setLiveRows] = useState<LiveRow[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedDate, setSelectedDate] = useState(taipeiToday);
  const [selectedEventId, setSelectedEventId] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState("");

  useEffect(() => () => stopScanner(), []);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch(`/api/registration/checkin-live?date=${encodeURIComponent(selectedDate)}`, { cache: "no-store" });
        const body = await response.json() as { ok: boolean; data?: LiveRow[] };
        if (alive && body.ok) setLiveRows(body.data ?? []);
      } catch { /* 即時面板不阻擋掃描報到 */ }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [selectedDate]);

  const eventOptions = useMemo(() => {
    const map = new Map<string, string>();
    liveRows.forEach((row) => map.set(row.event_id, one(row.events)?.title ?? "未命名活動"));
    return [...map.entries()].map(([id, title]) => ({ id, title }));
  }, [liveRows]);
  const sessionOptions = useMemo(() => {
    const map = new Map<string, { id: string; eventId: string; label: string; startAt: string }>();
    liveRows.forEach((row) => { const session = one(row.event_sessions); if (session) map.set(row.session_id, { id: row.session_id, eventId: row.event_id, label: session.name, startAt: session.start_at }); });
    return [...map.values()].filter((session) => !selectedEventId || session.eventId === selectedEventId);
  }, [liveRows, selectedEventId]);
  const filteredLiveRows = useMemo(() => liveRows.filter((row) => (!selectedEventId || row.event_id === selectedEventId) && (!selectedSessionId || row.session_id === selectedSessionId)), [liveRows, selectedEventId, selectedSessionId]);
  const groupedLiveRows = useMemo(() => {
    const map = new Map<string, LiveRow[]>();
    filteredLiveRows.forEach((row) => { const key = `${row.event_id}:${row.session_id}`; map.set(key, [...(map.get(key) ?? []), row]); });
    return [...map.values()];
  }, [filteredLiveRows]);

  function stopScanner() {
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null; streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null; setScanning(false);
  }
  async function scan() {
    setError(null);
    const Detector = (globalThis as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => { detect(source: unknown): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (!Detector) { setError("目前瀏覽器不支援 QR 掃描，請改用 Chrome 或手動輸入憑證。"); return; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }); streamRef.current = stream;
      if (!videoRef.current) return; videoRef.current.srcObject = stream; await videoRef.current.play(); setScanning(true);
      const detector = new Detector({ formats: ["qr_code"] });
      const tick = async () => { if (!videoRef.current || !streamRef.current) return; const codes = await detector.detect(videoRef.current).catch(() => []); const value = codes.find((code) => code.rawValue)?.rawValue?.trim(); if (value) { setToken(value); stopScanner(); return; } scanTimerRef.current = window.setTimeout(() => void tick(), 250); };
      void tick();
    } catch { setError("無法啟用相機，請確認已允許瀏覽器使用相機，或改用手動報到。"); stopScanner(); }
  }
  async function submitToken() {
    setLoading(true); setError(null); setResult(null);
    try { const response = await fetch("/api/registration/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }); const body = await response.json() as { ok: boolean; data?: CheckinResult; error?: string }; if (!body.ok || !body.data) throw new Error(body.error ?? "報到失敗"); setResult(body.data); setToken(""); setSearchRows([]); }
    catch (submitError) { setError(submitError instanceof Error ? submitError.message : "報到失敗"); } finally { setLoading(false); }
  }
  async function search() {
    const query = searchQuery.trim();
    if (query.length < 2 && !selectedSessionId) { setError("請輸入至少 2 個字元，或先選擇一個活動場次。"); return; }
    setSearching(true); setError(null);
    try {
      const params = new URLSearchParams({ date: selectedDate }); if (query) params.set("q", query); if (selectedEventId) params.set("event_id", selectedEventId); if (selectedSessionId) params.set("session_id", selectedSessionId);
      const response = await fetch(`/api/registration/checkin-search?${params.toString()}`); const body = await response.json() as { ok: boolean; data?: SearchRow[]; error?: string }; if (!body.ok) throw new Error(body.error ?? "搜尋失敗"); setSearchRows(body.data ?? []);
    } catch (searchError) { setError(searchError instanceof Error ? searchError.message : "搜尋失敗"); } finally { setSearching(false); }
  }
  async function checkinById(registrationId: string) {
    setLoading(true); setError(null); setResult(null);
    try { const response = await fetch("/api/registration/checkin-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registration_id: registrationId }) }); const body = await response.json() as { ok: boolean; data?: CheckinResult; error?: string }; if (!body.ok || !body.data) throw new Error(body.error ?? "報到失敗"); setResult(body.data); setSearchRows((rows) => rows.map((row) => row.id === registrationId ? { ...row, status: body.data?.registration_status ?? row.status } : row)); setLiveRows((rows) => rows.map((row) => row.id === registrationId ? { ...row, status: "attended" } : row)); }
    catch (checkinError) { setError(checkinError instanceof Error ? checkinError.message : "報到失敗"); } finally { setLoading(false); }
  }

  return <div className="admin-page">
    <div className="admin-page-header"><div><div className="eyebrow">活動現場作業</div><h1 className="admin-page-title">報名報到</h1><p className="admin-page-description">先鎖定日期、活動與場次，再掃描或核對名單；不同場次不再混在同一份工作台。</p></div></div>
    <section className="admin-toolbar grid gap-3 md:grid-cols-3">
      <label className="text-sm"><span className="label">活動日期</span><input type="date" className="input" value={selectedDate} onChange={(event) => { setSelectedDate(event.target.value); setSelectedEventId(""); setSelectedSessionId(""); setSearchRows([]); }} /></label>
      <label className="text-sm"><span className="label">活動</span><select className="input" value={selectedEventId} onChange={(event) => { setSelectedEventId(event.target.value); setSelectedSessionId(""); setSearchRows([]); }}><option value="">全部活動</option>{eventOptions.map((event) => <option key={event.id} value={event.id}>{event.title}</option>)}</select></label>
      <label className="text-sm"><span className="label">場次</span><select className="input" value={selectedSessionId} onChange={(event) => { setSelectedSessionId(event.target.value); setSearchRows([]); }}><option value="">全部場次</option>{sessionOptions.map((session) => <option key={session.id} value={session.id}>{time(session.startAt)} · {session.label}</option>)}</select></label>
    </section>
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
      <section className="admin-section space-y-4 p-5"><div className="overflow-hidden rounded bg-slate-950"><video ref={videoRef} className={`aspect-video w-full object-cover ${scanning ? "block" : "hidden"}`} playsInline muted /><div className={`${scanning ? "hidden" : "flex"} aspect-video items-center justify-center px-6 text-center text-sm text-white/70`}>開啟相機後，將報到二維條碼放入框內掃描</div></div><div className="flex gap-2"><button type="button" onClick={() => void scan()} disabled={scanning || loading} className="btn btn-secondary flex-1">開始掃描二維條碼</button>{scanning && <button type="button" onClick={stopScanner} className="btn btn-ghost">停止</button>}</div><label className="block text-sm"><span className="label">手動輸入報到憑證</span><textarea className="input min-h-28" value={token} onChange={(event) => setToken(event.target.value)} placeholder="貼上顧客的報到憑證" /></label><button type="button" disabled={!token.trim() || loading} onClick={() => void submitToken()} className="btn btn-primary w-full">{loading ? "處理中…" : "使用憑證報到"}</button></section>
      <section className="admin-section space-y-4 p-5"><div><h2 className="font-semibold text-slate-900">手動搜尋報到</h2><p className="mt-1 text-sm leading-6 text-slate-500">選定場次後可直接載入該場名單，也可再輸入姓名、電話或報名編號縮小範圍。</p></div><form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}><input className="input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="姓名、電話或報名編號" /><button className="btn btn-secondary shrink-0" type="submit" disabled={searching}>{searching ? "搜尋中…" : selectedSessionId && !searchQuery.trim() ? "載入場次" : "搜尋"}</button></form><div className="divide-y divide-slate-200 border-y border-slate-200">{searchRows.length === 0 ? <p className="bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">選擇場次或輸入關鍵字後顯示可報到名單</p> : searchRows.map((row) => { const event = one(row.events); const session = one(row.event_sessions); const checked = row.status === "attended"; return <div key={row.id} className="p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{row.name}</div><div className="mt-1 text-xs text-slate-500">{row.registration_no} · {row.phone}</div></div><span className={`badge ${checked ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{checked ? "已報到" : "可報到"}</span></div><div className="mt-2 text-sm text-slate-600">{event?.title ?? "活動"}{session ? ` · ${session.name}` : ""}</div><div className="mt-3 flex justify-end">{checked ? <span className="text-xs text-slate-400">已完成報到</span> : <button type="button" disabled={loading} onClick={() => void checkinById(row.id)} className="btn btn-primary px-3 py-1.5 text-xs">確認報到</button>}</div></div>; })}</div></section>
    </div>
    <section className="admin-section space-y-4 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-900">場次報到工作台</h2><p className="mt-1 text-xs text-slate-500">每 10 秒更新；每一個活動場次獨立計算到場進度。</p></div><span className="badge bg-slate-100 text-slate-600">{filteredLiveRows.filter((row) => row.status === "attended").length} / {filteredLiveRows.length} 已報到</span></div>{groupedLiveRows.length === 0 ? <p className="border-y border-slate-200 bg-slate-50 p-5 text-center text-sm text-slate-400">所選日期與條件沒有可報到名單。</p> : <div className="grid gap-4 xl:grid-cols-2">{groupedLiveRows.map((rows) => { const first = rows[0]; const event = one(first.events); const session = one(first.event_sessions); const attended = rows.filter((row) => row.status === "attended").length; return <article key={`${first.event_id}:${first.session_id}`} className="overflow-hidden border border-slate-200"><header className="flex items-center justify-between gap-3 bg-slate-50 px-4 py-3"><div><h3 className="font-semibold text-slate-900">{event?.title ?? "活動"}</h3><p className="mt-0.5 text-xs text-slate-500">{session ? `${time(session.start_at)} · ${session.name}` : "未設定場次"}</p></div><span className="badge bg-white text-slate-700">{attended}/{rows.length}</span></header><div className="divide-y divide-slate-100">{rows.map((row) => <div key={row.id} className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="font-medium text-slate-800">{row.name}</p><p className="mt-0.5 text-xs text-slate-500">{row.registration_no}</p></div><span className={`badge ${row.status === "attended" ? "bg-emerald-50 text-emerald-700" : row.status === "no_show" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>{row.status === "attended" ? "已報到" : row.status === "no_show" ? "未到" : "待報到"}</span></div>)}</div></article>; })}</div>}</section>
    {error && <p className="border border-red-200 border-l-[3px] border-l-red-600 bg-red-50 p-4 text-sm text-red-700">{error}</p>}{result && <div className={`border-l-[3px] p-4 text-sm ${result.result === "duplicate" ? "border-l-amber-600 bg-amber-50 text-amber-800" : "border-l-emerald-600 bg-emerald-50 text-emerald-800"}`}><strong>{result.result === "duplicate" ? "此報名已完成報到" : "報到成功"}</strong><p className="mt-1 text-xs">狀態：{result.registration_status} · {new Date(result.checked_in_at).toLocaleString("zh-TW")}</p></div>}
  </div>;
}
