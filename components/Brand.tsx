export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 text-white shadow-sm ${className}`}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-1/2 w-1/2">
        <path d="M5 7.5A2.5 2.5 0 0 1 7.5 5h9A2.5 2.5 0 0 1 19 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 5 16.5z" stroke="currentColor" strokeWidth="1.8" />
        <path d="M8 12h8M12 8v8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export function Brand({
  name,
  subtitle,
  align = "left",
  size = "md",
}: {
  name?: string | null;
  subtitle?: string;
  align?: "left" | "center";
  size?: "md" | "lg";
}) {
  return (
    <div className={`flex items-center gap-3 ${align === "center" ? "flex-col text-center" : ""}`}>
      <BrandMark className={size === "lg" ? "h-12 w-12" : "h-9 w-9"} />
      <div>
        <div className={`font-bold tracking-tight text-slate-900 ${size === "lg" ? "text-xl" : "text-base"}`}>
          {name?.trim() || "預約與報名平台"}
        </div>
        {subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}
      </div>
    </div>
  );
}
