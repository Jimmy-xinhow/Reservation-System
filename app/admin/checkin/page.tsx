"use client";

import { useEffect, useRef, useState } from "react";

interface CheckinResult {
  registration_id: string;
  registration_status: string;
  checked_in_at: string;
  result: string;
}

export default function CheckinPage() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanTimerRef = useRef<number | null>(null);
  const [token, setToken] = useState("");
  const [result, setResult] = useState<CheckinResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [scanning, setScanning] = useState(false);

  useEffect(() => () => stopScanner(), []);

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
      setError("此瀏覽器不支援原生 QR 掃描，請改用 Chrome 或手動貼上憑證。");
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
      setError("無法開啟相機，請確認瀏覽器權限或改用手動輸入。");
      stopScanner();
    }
  }

  async function submit() {
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/registration/checkin", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) });
      const body = (await response.json()) as { ok: boolean; data?: CheckinResult; error?: string };
      if (!body.ok || !body.data) throw new Error(body.error ?? "報到失敗");
      setResult(body.data);
      setToken("");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "報到失敗");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-6">
      <div><div className="eyebrow">Check-in</div><h1 className="text-2xl font-bold text-slate-900">活動報到</h1><p className="mt-1 text-sm leading-6 text-slate-500">輸入或貼上報名憑證。正式串接 QR 掃描器時，掃描結果同樣送到這個安全 API。</p></div>
      <section className="card space-y-4 p-5"><div className="overflow-hidden rounded-xl bg-slate-950"><video ref={videoRef} className={`aspect-video w-full object-cover ${scanning ? "block" : "hidden"}`} playsInline muted /><div className={`${scanning ? "hidden" : "flex"} aspect-video items-center justify-center px-6 text-center text-sm text-white/70`}>啟用相機後，將顧客 QR 放入框內</div></div><div className="flex gap-2"><button type="button" onClick={() => void scan()} disabled={scanning || loading} className="btn btn-secondary flex-1">開啟相機掃描</button>{scanning && <button type="button" onClick={stopScanner} className="btn btn-ghost">停止</button>}</div><label className="block text-sm"><span className="label">報到憑證（相機不支援時可手動輸入）</span><textarea className="input min-h-28" value={token} onChange={(e) => setToken(e.target.value)} placeholder="貼上顧客報名成功頁的憑證" /></label><button type="button" disabled={!token.trim() || loading} onClick={() => void submit()} className="btn btn-primary w-full">{loading ? "驗證中…" : "確認報到"}</button>{error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}{result && <div className={`rounded-xl p-4 text-sm ${result.result === "duplicate" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}><strong>{result.result === "duplicate" ? "此報名已報到" : "報到成功"}</strong><p className="mt-1 text-xs">狀態：{result.registration_status} · {new Date(result.checked_in_at).toLocaleString("zh-TW")}</p></div>}</section>
    </div>
  );
}
