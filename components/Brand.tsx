// 慈愛中醫診所 品牌標誌(純 SVG,無外部圖檔)。server / client 皆可用。

export function BrandMark({ className = "h-9 w-9" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-accent-600 text-white shadow-sm ${className}`}
      aria-hidden
    >
      {/* 慈愛 = 心;脈搏線帶出醫療意象 */}
      <svg viewBox="0 0 24 24" fill="none" className="h-1/2 w-1/2">
        <path
          d="M12 20s-6.5-4.2-9-8.4C1.4 8.9 2.6 5.5 5.8 5.1c1.9-.2 3.3.9 4.2 2.2.9-1.3 2.3-2.4 4.2-2.2 3.2.4 4.4 3.8 2.8 6.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M9 13h2l1.2-2.2L14 15l1.3-2h3.2"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}

export function Brand({
  subtitle,
  align = "left",
  size = "md",
}: {
  subtitle?: string;
  align?: "left" | "center";
  size?: "md" | "lg";
}) {
  return (
    <div
      className={`flex items-center gap-3 ${align === "center" ? "flex-col text-center" : ""}`}
    >
      <BrandMark className={size === "lg" ? "h-12 w-12" : "h-9 w-9"} />
      <div>
        <div
          className={`font-bold tracking-tight text-slate-900 ${
            size === "lg" ? "text-xl" : "text-base"
          }`}
        >
          慈愛中醫診所
        </div>
        {subtitle && <div className="text-sm text-slate-500">{subtitle}</div>}
      </div>
    </div>
  );
}
