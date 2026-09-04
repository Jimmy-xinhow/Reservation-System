"use client";

import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Bar,
  BarChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export interface TrendPoint { date: string; bookings: number; registrations: number; }
export interface TimelineItem { id: string; label: string; service: string; status: string; startMinute: number; endMinute: number; }
export interface FunnelPoint { label: string; value: number; color?: string; }

const statusColor: Record<string, string> = {
  booked: "#2563eb",
  confirmed: "#059669",
  done: "#64748b",
  no_show: "#d97706",
  cancelled: "#dc2626",
};

const tooltipStyle = { border: "1px solid #dbe3ee", borderRadius: 8, boxShadow: "0 10px 28px rgba(15,23,42,.1)", fontSize: 12 };

export function TrendLineChart({ data, today }: { data: TrendPoint[]; today?: string }) {
  return (
    <div className="chart-frame" role="img" aria-label="預約與報名數量曲線圖">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 12, right: 12, left: -22, bottom: 0 }}>
          <defs>
            <linearGradient id="bookings-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.2} /><stop offset="100%" stopColor="#2563eb" stopOpacity={0} /></linearGradient>
          </defs>
          <CartesianGrid vertical={false} stroke="#e8edf4" />
          <XAxis dataKey="date" tickFormatter={(value: string) => value.slice(5).replace("-", "/")} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 11 }} />
          <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} labelFormatter={(value) => `${value}${value === today ? "（今天）" : ""}`} formatter={(value, name) => [Number(value), name === "bookings" ? "預約" : "報名"]} />
          <Legend formatter={(value) => value === "bookings" ? "預約" : "報名"} wrapperStyle={{ fontSize: 12 }} />
          <Area type="monotone" dataKey="bookings" stroke="none" fill="url(#bookings-fill)" />
          <Line type="monotone" dataKey="bookings" stroke="#2563eb" strokeWidth={2.5} dot={{ r: 2.5, fill: "#2563eb" }} activeDot={{ r: 5 }} />
          <Line type="monotone" dataKey="registrations" stroke="#c08a18" strokeWidth={2.5} dot={{ r: 2.5, fill: "#c08a18" }} activeDot={{ r: 5 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function ScheduleTimeline({ items }: { items: TimelineItem[] }) {
  const data = items.map((item) => ({ ...item, range: [item.startMinute, item.endMinute] as [number, number] }));
  if (data.length === 0) return <div className="chart-empty"><strong>今天尚無排程</strong><span>建立預約後會依服務人員與時間顯示。</span></div>;
  return (
    <div className="timeline-chart" role="img" aria-label="今日預約甘特時間軸">
      <ResponsiveContainer width="100%" height={Math.max(190, data.length * 46 + 48)}>
        <BarChart data={data} layout="vertical" margin={{ top: 8, right: 18, bottom: 4, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="#e8edf4" />
          <XAxis type="number" domain={[420, 1320]} ticks={[480, 600, 720, 840, 960, 1080, 1200, 1320]} tickFormatter={(value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:00`} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={92} axisLine={false} tickLine={false} tick={{ fill: "#475569", fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(_, __, item) => [`${minuteLabel(item.payload.startMinute)}–${minuteLabel(item.payload.endMinute)} · ${item.payload.service}`, "排程"]} />
          <Bar dataKey="range" radius={[5, 5, 5, 5]} barSize={22}>
            {data.map((item) => <Cell key={item.id} fill={statusColor[item.status] ?? "#64748b"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function FunnelBarChart({ data }: { data: FunnelPoint[] }) {
  return (
    <div className="funnel-chart" role="img" aria-label="顧客轉換漏斗長條圖">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 2, right: 28, bottom: 2, left: 8 }}>
          <CartesianGrid horizontal={false} stroke="#edf1f5" />
          <XAxis type="number" allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: "#64748b", fontSize: 10 }} />
          <YAxis type="category" dataKey="label" width={82} axisLine={false} tickLine={false} tick={{ fill: "#475569", fontSize: 11 }} />
          <Tooltip contentStyle={tooltipStyle} formatter={(value) => [Number(value), "人次"]} />
          <Bar dataKey="value" radius={[0, 5, 5, 0]} barSize={24}>
            {data.map((item) => <Cell key={item.label} fill={item.color ?? "#2563eb"} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function minuteLabel(value: number): string {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
