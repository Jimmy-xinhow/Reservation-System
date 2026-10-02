export interface BrandSetupAnswers {
  goal: "booking" | "registration" | "both";
  bookingMode: "time" | "number" | "unsure";
  assignment: "required" | "optional" | "resource" | "unsure";
  channels: Array<"line" | "email" | "browser" | "website">;
  payment: "none" | "newebpay" | "ecpay" | "unsure";
  serviceSummary: string;
  openingHours: string;
  simultaneousBookings?: number | null;
  pricingSummary?: string;
  depositAmount?: number | null;
  targetDate: string | null;
  additionalNeeds: string;
}

function single(fd: FormData, name: string, max = 500): string {
  const values = fd.getAll(name);
  if (values.length > 1 || (values[0] !== undefined && typeof values[0] !== "string")) {
    throw new Error("表單資料格式不正確，請重新填寫。");
  }
  const value = typeof values[0] === "string" ? values[0].trim() : "";
  if (value.length > max) throw new Error(`「${name}」內容超過長度限制。`);
  return value;
}

function choice<T extends string>(fd: FormData, name: string, allowed: readonly T[]): T {
  const value = single(fd, name, 40);
  if (!allowed.includes(value as T)) throw new Error("請完成必填選項。");
  return value as T;
}

function nonNegativeInteger(fd: FormData, name: string, allowZero: boolean): number | null {
  const raw = single(fd, name, 15);
  if (!raw) return null;
  if (!/^\d+$/.test(raw)) throw new Error(`「${name}」請填寫整數。`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (!allowZero && value === 0)) {
    throw new Error(`「${name}」數值不正確。`);
  }
  return value;
}

export function parseBrandSetupAnswers(fd: FormData): BrandSetupAnswers {
  const channels = fd.getAll("channels");
  const allowedChannels = ["line", "email", "browser", "website"] as const;
  if (channels.length > allowedChannels.length || channels.some((value) => typeof value !== "string" || !allowedChannels.includes(value as typeof allowedChannels[number]))) {
    throw new Error("通知與入口選項不正確。");
  }
  const targetDate = single(fd, "targetDate", 10);
  if (targetDate && (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate) || Number.isNaN(Date.parse(`${targetDate}T00:00:00Z`)))) {
    throw new Error("預計啟用日期不正確。");
  }
  const serviceSummary = single(fd, "serviceSummary", 500);
  const openingHours = single(fd, "openingHours", 300);
  const simultaneousBookings = nonNegativeInteger(fd, "simultaneousBookings", false);
  const pricingSummary = single(fd, "pricingSummary", 800);
  const depositAmount = nonNegativeInteger(fd, "depositAmount", true);
  const payment = choice(fd, "payment", ["none", "newebpay", "ecpay", "unsure"]);
  if (!serviceSummary) throw new Error("請簡述要提供的服務或活動。");
  if (payment === "none" && depositAmount !== null && depositAmount > 0) {
    throw new Error("未使用線上金流時，預約訂金請填 0 或留白。");
  }
  return {
    goal: choice(fd, "goal", ["booking", "registration", "both"]),
    bookingMode: choice(fd, "bookingMode", ["time", "number", "unsure"]),
    assignment: choice(fd, "assignment", ["required", "optional", "resource", "unsure"]),
    channels: [...new Set(channels as BrandSetupAnswers["channels"])],
    payment,
    serviceSummary,
    openingHours,
    simultaneousBookings,
    pricingSummary,
    depositAmount,
    targetDate: targetDate || null,
    additionalNeeds: single(fd, "additionalNeeds", 500),
  };
}

export const BRAND_SETUP_STATUS: Record<string, string> = {
  submitted: "已提交，待平台處理",
  in_progress: "平台設定中",
  ready_for_review: "待店家確認",
  completed: "店家已確認交接",
};
