const AUDIT_STATUS_LABELS: Record<string, string> = {
  booked: "已預約",
  confirmed: "已確認",
  cancelled: "已取消",
  done: "已完成",
  no_show: "未到",
  pending: "待處理",
  none: "未設定",
  waitlisted: "候補中",
  attended: "已報到",
  not_required: "不需付款",
  paid: "已付款",
  failed: "處理失敗",
  expired: "已逾期",
  refunded: "已退款",
  waived: "已免收",
  draft: "草稿",
  published: "已發布",
  archived: "已封存",
  waiting: "等待中",
  offered: "名額保留中",
  promoted: "已遞補",
  received: "已收到",
  accepted: "已接受",
  rejected: "已拒絕",
  active: "使用中",
  exhausted: "已用完",
  reserved: "已保留",
  applied: "已使用",
  released: "已釋放",
  sent: "已送出",
};

const AUDIT_SOURCE_LABELS: Record<string, string> = {
  admin: "後台人員",
  staff: "後台人員",
  provider: "服務人員",
  customer: "顧客入口",
  liff: "LINE 顧客入口",
  line: "LINE",
  browser: "一般瀏覽器入口",
  system: "系統自動處理",
  cron: "自動排程",
  webhook: "外部通知",
  payment_webhook: "付款通知",
  api: "系統連線",
  import: "資料匯入",
};

export function auditStatusLabel(value: string | null): string {
  if (!value) return "無前一狀態";
  return AUDIT_STATUS_LABELS[value] ?? "其他狀態";
}

export function auditSourceLabel(value: string): string {
  return AUDIT_SOURCE_LABELS[value] ?? "其他系統來源";
}
