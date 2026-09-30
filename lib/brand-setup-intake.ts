export interface BrandSetupAnswers {
  goal: "booking" | "registration" | "both";
  bookingMode: "time" | "number" | "unsure";
  assignment: "required" | "optional" | "resource" | "unsure";
  channels: Array<"line" | "email" | "browser" | "website">;
  payment: "none" | "newebpay" | "ecpay" | "unsure";
  serviceSummary: string;
  openingHours: string;
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
  if (!serviceSummary) throw new Error("請簡述要提供的服務或活動。");
  return {
    goal: choice(fd, "goal", ["booking", "registration", "both"]),
    bookingMode: choice(fd, "bookingMode", ["time", "number", "unsure"]),
    assignment: choice(fd, "assignment", ["required", "optional", "resource", "unsure"]),
    channels: [...new Set(channels as BrandSetupAnswers["channels"])],
    payment: choice(fd, "payment", ["none", "newebpay", "ecpay", "unsure"]),
    serviceSummary,
    openingHours,
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
