export const SEGMENT_RULE_TYPES = [
  "tag_contains",
  "no_booking_days",
  "completed_visits_gte",
  "no_show_gte",
  "birthday_month",
] as const;

export type SegmentRuleType = (typeof SEGMENT_RULE_TYPES)[number];

export const SEGMENT_RULE_LABELS: Record<SegmentRuleType, string> = {
  tag_contains: "標籤包含",
  no_booking_days: "近幾天沒有預約",
  completed_visits_gte: "完成預約至少",
  no_show_gte: "未到至少",
  birthday_month: "生日月份為",
};

export const AUTOMATION_TRIGGER_TYPES = ["appointment_done", "birthday", "inactive"] as const;
export type AutomationTriggerType = (typeof AUTOMATION_TRIGGER_TYPES)[number];

export const AUTOMATION_TRIGGER_LABELS: Record<AutomationTriggerType, string> = {
  appointment_done: "預約完成後追蹤",
  birthday: "生日當日訊息",
  inactive: "分眾未回訪提醒",
};

export type MarketingChannel = "line" | "email";

export function validateSegmentValue(type: SegmentRuleType, raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("請填寫分眾條件");
  if (type === "tag_contains") return value.slice(0, 80);

  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new Error("分眾數值必須是大於 0 的整數");
  if (type === "birthday_month" && number > 12) throw new Error("生日月份必須介於 1 到 12");
  return String(number);
}

export function validateAutomationBody(raw: string): string {
  const value = raw.trim();
  if (!value) throw new Error("請填寫訊息內容");
  if (value.length > 2000) throw new Error("訊息內容不可超過 2,000 字");
  return value;
}

export function describeSegmentRule(type: SegmentRuleType, value: string): string {
  switch (type) {
    case "tag_contains":
      return `標籤包含「${value}」`;
    case "no_booking_days":
      return `近 ${value} 天沒有有效預約`;
    case "completed_visits_gte":
      return `完成預約至少 ${value} 次`;
    case "no_show_gte":
      return `未到至少 ${value} 次`;
    case "birthday_month":
      return `生日月份為 ${value} 月`;
  }
}

