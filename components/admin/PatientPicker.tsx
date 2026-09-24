"use client";

import { useEffect, useState } from "react";

interface PatientHit { id: string; name: string; phone: string; }

export function PatientPicker() {
  const [query, setQuery] = useState("");
  const [patients, setPatients] = useState<PatientHit[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const keyword = query.trim();
    if (keyword.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setStatus("搜尋中…");
      try {
        const response = await fetch(`/api/admin/patients/search?q=${encodeURIComponent(keyword)}`, { signal: controller.signal });
        const result: { ok?: boolean; data?: { patients?: PatientHit[] } } = await response.json();
        if (!response.ok || !result.ok || !Array.isArray(result.data?.patients)) throw new Error("SEARCH_FAILED");
        if (controller.signal.aborted) return;
        setPatients(result.data.patients);
        setStatus(result.data.patients.length === 0 ? "找不到符合的顧客" : `找到 ${result.data.patients.length} 位顧客`);
      } catch {
        if (controller.signal.aborted) return;
        setPatients([]);
        setStatus("搜尋失敗，請重新輸入後再試");
      }
    }, 250);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [query]);

  return (
    <div className="grid gap-2 text-sm">
      <label>
        <span className="label">搜尋顧客</span>
        <input
          className="input"
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelectedId("");
            setPatients([]);
            setStatus(event.target.value.trim().length < 2 ? "請輸入至少兩個字或數字" : "");
          }}
          placeholder="輸入姓名或電話，至少兩個字"
          autoComplete="off"
        />
      </label>
      <label>
        <span className="label">顧客</span>
        <select className="input" name="patient_id" required value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>
          <option value="" disabled>請先搜尋並選擇顧客</option>
          {patients.map((patient) => <option key={patient.id} value={patient.id}>{patient.name} · {patient.phone}</option>)}
        </select>
      </label>
      {status && <p className="help-text" role="status">{status}</p>}
    </div>
  );
}
