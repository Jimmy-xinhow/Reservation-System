"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { createQrSvg } from "@/lib/qr";
import { recordButtonAttendanceAction, recordQrAttendanceAction } from "./attendance-actions";
import { LiveTaipeiClock } from "@/components/LiveTaipeiClock";

export function AttendanceClockPanel({ clickEnabled, qrEnabled, lastEvent }: { clickEnabled: boolean; qrEnabled: boolean; lastEvent?: { eventType: string; occurredAt: string } }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [token, setToken] = useState("");
  const [eventType, setEventType] = useState<"clock_in" | "clock_out">("clock_in");
  const [scanError, setScanError] = useState("");

  useEffect(() => () => stopScanner(), []);
  function stopScanner() {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
  }
  async function startScanner() {
    setScanError("");
    const Detector = (globalThis as unknown as { BarcodeDetector?: new (options?: { formats: string[] }) => { detect(source: unknown): Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
    if (!Detector) { setScanError("目前瀏覽器不支援相機掃碼，請改用最新版 Chrome，或手動輸入 QR 下方代碼。"); return; }
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
        const found = codes.find((code) => code.rawValue)?.rawValue?.trim();
        if (found) { setToken(found); stopScanner(); return; }
        timerRef.current = window.setTimeout(() => void tick(), 250);
      };
      void tick();
    } catch { setScanError("無法啟用相機，請確認已允許相機權限。"); stopScanner(); }
  }

  return <section className="attendance-clock-panel">
    <div className="attendance-panel-heading attendance-clock-heading"><div><p className="eyebrow">我的出勤</p><h2>上下班打卡</h2><p>{lastEvent ? `最近紀錄：${lastEvent.eventType === "clock_in" ? "上班" : "下班"} · ${new Date(lastEvent.occurredAt).toLocaleString("zh-TW", { timeZone: "Asia/Taipei", hour12: false })}` : "今天還沒有打卡紀錄"}</p></div><div className="attendance-heading-clock"><span className="attendance-live-mark"><i />台北時間</span><LiveTaipeiClock /></div></div>
    {clickEnabled && <div className="attendance-clock-actions"><form action={recordButtonAttendanceAction}><input type="hidden" name="event_type" value="clock_in" /><SubmitButton className="btn btn-primary">上班打卡</SubmitButton></form><form action={recordButtonAttendanceAction}><input type="hidden" name="event_type" value="clock_out" /><SubmitButton className="btn btn-secondary">下班打卡</SubmitButton></form></div>}
    {qrEnabled && <div className="attendance-scan-area">
      <div className="attendance-scan-toolbar"><strong>掃描管理者 QR Code</strong><select className="input" value={eventType} onChange={(event) => setEventType(event.target.value as "clock_in" | "clock_out")}><option value="clock_in">上班打卡</option><option value="clock_out">下班打卡</option></select><button type="button" className="btn btn-secondary" onClick={scanning ? stopScanner : startScanner}>{scanning ? "停止掃描" : "開啟相機掃碼"}</button></div>
      <video ref={videoRef} className={scanning ? "attendance-scanner-video" : "hidden"} muted playsInline />
      {scanError && <p className="notice notice-error">{scanError}</p>}
      <form action={recordQrAttendanceAction} className="attendance-token-form"><input type="hidden" name="event_type" value={eventType} /><label><span className="label">QR 代碼</span><input name="qr_token" className="input font-mono" value={token} onChange={(event) => setToken(event.target.value)} placeholder="掃描後會自動帶入" required /></label><SubmitButton className="btn btn-primary" disabled={!token}>確認{eventType === "clock_in" ? "上班" : "下班"}打卡</SubmitButton></form>
    </div>}
    {!clickEnabled && !qrEnabled && <p className="notice notice-info">管理者尚未開放後台按鈕或 QR 打卡。</p>}
    <p className="attendance-note">每次送出都會新增一筆時間紀錄；重複打卡不會覆蓋先前資料。</p>
  </section>;
}

export function AttendanceQrBoard({ enabled, refreshSeconds }: { enabled: boolean; refreshSeconds: number }) {
  const [token, setToken] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/admin/attendance/qr", { method: "POST", cache: "no-store" });
        const body = await response.json() as { token?: string; expiresAt?: string; error?: string };
        if (!response.ok || !body.token || !body.expiresAt) throw new Error(body.error ?? "QR Code 產生失敗");
        if (alive) { setToken(body.token); setExpiresAt(body.expiresAt); setError(""); }
      } catch (loadError) { if (alive) setError(loadError instanceof Error ? loadError.message : "QR Code 產生失敗"); }
    };
    void load();
    const rotate = window.setInterval(() => void load(), refreshSeconds * 1000);
    const clock = window.setInterval(() => setNow(Date.now()), 1000);
    return () => { alive = false; window.clearInterval(rotate); window.clearInterval(clock); };
  }, [enabled, refreshSeconds]);
  const remaining = Math.max(0, Math.ceil((new Date(expiresAt || 0).getTime() - now) / 1000));
  const svg = useMemo(() => token ? createQrSvg(token) : "", [token]);
  if (!enabled) return <div className="attendance-qr-disabled">啟用 QR 打卡後，這裡會顯示自動更新的員工打卡碼。</div>;
  return <div className="attendance-qr-board">{error ? <p className="notice notice-error">{error}</p> : <><div className="attendance-qr-image" dangerouslySetInnerHTML={{ __html: svg }} /><strong>{remaining} 秒後更新</strong><code>{token}</code><p>員工登入後台「出勤打卡」，以相機掃描此碼。</p></>}</div>;
}
