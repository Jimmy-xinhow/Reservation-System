"use client";

import { useEffect, useRef, useState } from "react";

interface CheckinResult {
  registration_id: string;
  registration_status: string;
  checked_in_at: string;
  result: string;
}

interface SearchRow {
  id: string;
  registration_no: string;
  status: string;
  name: string;
  phone: string;
  email: string | null;
  events: { title: string } | { title: string }[] | null;
  event_sessions: { name: string; start_at: string } | { name: string; start_at: string }[] | null;
}
type LiveRow = SearchRow;

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? value[0] ?? null : value;
}

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

  useEffect(() => () => stopScanner(), []);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/registration/checkin-live", { cache: "no-store" });
        const body = await response.json() as { ok: boolean; data?: LiveRow[] };
        if (alive && body.ok) setLiveRows(body.data ?? []);
      } catch { /* live panel is supplementary */ }
    };
    void load();
    const timer = window.setInterval(() => void load(), 10000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  function stopScanner() {
    if (scanTimerRef.current !== null) window.clearTimeout(scanTimerRef.current);
    scanTimerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }

  async function scan() {
    setError(null);
    const Detector = (globalThis as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => { detect(source: unknown): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (!Detector) {
      setError("目前瀏覽器不支援 QR 掃描，請改用 Chrome 或手動輸入憑證。");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) return;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setScanning(true);
      const detector = new Detector({ formats: ["qr_code"] });
      const tick = async () => {
        if (!videoRef.current || !streamRef.current) return;
        const codes = await detector.detect(videoRef.current).catch(() => []);
        const value = codes.find((code) => code.rawValue)?.rawValue?.trim();
        if (value) {
          setToken(value);
          stopScanner();
          return;
        }
        scanTimerRef.current = window.setTimeout(() => void tick(), 250);
      };
      void tick();
    } catch {
      setError("無法啟用相機，請確認已允許瀏覽器使用相機，或改用手動報到。");
      stopScanner();
    }
  }

  async function submitToken() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/registration/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const body = (await response.json()) as { ok: boolean; data?: CheckinResult; error?: string };
      if (!body.ok || !body.data) throw new Error(body.error ?? "報到失敗");
      setResult(body.data);
      setToken("");
      setSearchRows([]);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "報到失敗");
    } finally {
      setLoading(false);
    }
  }

  async function search() {
    const query = searchQuery.trim();
    if (query.length < 2) {
      setError("請輸入至少 2 個字元的姓名、電話或報名編號。");
      return;
    }
    setSearching(true);
    setError(null);
    try {
      const response = await fetch(`/api/registration/checkin-search?q=${encodeURIComponent(query)}`);
      const body = (await response.json()) as { ok: boolean; data?: SearchRow[]; error?: string };
      if (!body.ok) throw new Error(body.error ?? "搜尋失敗");
      setSearchRows(body.data ?? []);
    } catch (searchError) {
      setError(searchError instanceof Error ? searchError.message : "搜尋失敗");
    } finally {
      setSearching(false);
    }
  }

  async function checkinById(registrationId: string) {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/registration/checkin-search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ registration_id: registrationId }) });
      const body = (await response.json()) as { ok: boolean; data?: CheckinResult; error?: string };
      if (!body.ok || !body.data) throw new Error(body.error ?? "報到失敗");
      setResult(body.data);
      setSearchRows((rows) => rows.map((row) => row.id === registrationId ? { ...row, status: body.data?.registration_status ?? row.status } : row));
    } catch (checkinError) {
      setError(checkinError instanceof Error ? checkinError.message : "報到失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div><div className="eyebrow">Event check-in</div><h1 className="text-2xl font-bold text-slate-900">報名報到</h1><p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">支援 QR 掃描、報到憑證，以及以姓名／電話／報名編號搜尋的現場手動報到。</p></div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(360px,0.9fr)]">
        <section className="card space-y-4 p-5">
          <div className="overflow-hidden rounded-xl bg-slate-950"><video ref={videoRef} className={`aspect-video w-full object-cover ${scanning ? "block" : "hidden"}`} playsInline muted /><div className={`${scanning ? "hidden" : "flex"} aspect-video items-center justify-center px-6 text-center text-sm text-white/70`}>開啟相機後，將報到 QR 放入框內掃描</div></div>
          <div className="flex gap-2"><button type="button" onClick={() => void scan()} disabled={scanning || loading} className="btn btn-secondary flex-1">開始 QR 掃描</button>{scanning && <button type="button" onClick={stopScanner} className="btn btn-ghost">停止</button>}</div>
          <label className="block text-sm"><span className="label">手動輸入報到憑證</span><textarea className="input min-h-28" value={token} onChange={(event) => setToken(event.target.value)} placeholder="貼上顧客的報到憑證" /></label>
          <button type="button" disabled={!token.trim() || loading} onClick={() => void submitToken()} className="btn btn-primary w-full">{loading ? "處理中…" : "使用憑證報到"}</button>
        </section>

        <section className="card space-y-4 p-5">
          <div><h2 className="font-semibold text-slate-900">手動搜尋報到</h2><p className="mt-1 text-sm leading-6 text-slate-500">只顯示此品牌的已確認／已報到／未到報名資料，供櫃檯現場核對。</p></div>
          <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); void search(); }}><input className="input" value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="姓名、電話或報名編號" /><button className="btn btn-secondary shrink-0" type="submit" disabled={searching}>{searching ? "搜尋中…" : "搜尋"}</button></form>
          <div className="space-y-2">{searchRows.length === 0 ? <p className="rounded-xl bg-slate-50 px-4 py-6 text-center text-sm text-slate-400">輸入關鍵字後顯示可報到名單</p> : searchRows.map((row) => { const event = one(row.events); const session = one(row.event_sessions); const alreadyChecked = row.status === "attended"; return <div key={row.id} className="rounded-xl border border-slate-200 p-4"><div className="flex items-start justify-between gap-3"><div><div className="font-semibold text-slate-900">{row.name}</div><div className="mt-1 text-xs text-slate-500">{row.registration_no} · {row.phone}</div></div><span className={`badge ${alreadyChecked ? "bg-emerald-50 text-emerald-700" : "bg-blue-50 text-blue-700"}`}>{alreadyChecked ? "已報到" : "可報到"}</span></div><div className="mt-2 text-sm text-slate-600">{event?.title ?? "活動"}{session ? ` · ${session.name}` : ""}</div><div className="mt-3 flex justify-end">{alreadyChecked ? <span className="text-xs text-slate-400">已完成報到</span> : <button type="button" disabled={loading} onClick={() => void checkinById(row.id)} className="btn btn-primary px-3 py-1.5 text-xs">確認報到</button>}</div></div>; })}</div>
        </section>
      </div>

      <section className="card space-y-3 p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-semibold text-slate-900">今日報到工作台</h2><p className="mt-1 text-xs text-slate-500">每 10 秒更新，供櫃檯掌握當日活動報到進度。</p></div><span className="badge bg-slate-100 text-slate-600">{liveRows.filter((row) => row.status === "attended").length} / {liveRows.length} 已報到</span></div>{liveRows.length === 0 ? <p className="rounded-xl bg-slate-50 p-5 text-center text-sm text-slate-400">今日沒有可報到的活動名單。</p> : <div className="grid gap-2 md:grid-cols-2 lg:grid-cols-3">{liveRows.map((row) => { const event = one(row.events); const session = one(row.event_sessions); return <div key={row.id} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-2"><span className="font-medium text-slate-800">{row.name}</span><span className={`badge ${row.status === "attended" ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>{row.status === "attended" ? "已報到" : "待報到"}</span></div><p className="mt-1 text-xs text-slate-500">{row.registration_no} · {event?.title ?? "活動"}</p><p className="mt-1 text-xs text-slate-400">{session?.name ?? "場次"} · {session?.start_at ? new Date(session.start_at).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" }) : ""}</p></div>; })}</div>}</section>

      {error && <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
      {result && <div className={`rounded-xl p-4 text-sm ${result.result === "duplicate" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}><strong>{result.result === "duplicate" ? "此報名已完成報到" : "報到成功"}</strong><p className="mt-1 text-xs">狀態：{result.registration_status} · {new Date(result.checked_in_at).toLocaleString("zh-TW")}</p></div>}
    </div>
  );
}
