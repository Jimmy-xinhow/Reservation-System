export type LineUiCategory = "entry" | "booking" | "events" | "member" | "marketing" | "support";

export interface LineUiTemplateDefinition {
  key: string;
  category: LineUiCategory;
  title: string;
  trigger: string;
  headline: string;
  body: string;
  details: Array<[string, string]>;
  primaryAction: string;
  secondaryAction?: string;
  badge: string;
  accent: string;
  systemManaged: boolean;
}

export const LINE_UI_CATEGORIES: Array<{ key: "all" | LineUiCategory; label: string }> = [
  { key: "all", label: "全部" },
  { key: "entry", label: "入口導覽" },
  { key: "booking", label: "預約流程" },
  { key: "events", label: "活動票券" },
  { key: "member", label: "會員經營" },
  { key: "marketing", label: "行銷回訪" },
  { key: "support", label: "客服支援" },
];

export const LINE_UI_TEMPLATES: LineUiTemplateDefinition[] = [
  { key: "welcome", category: "entry", title: "加入好友歡迎", trigger: "首次加入好友", headline: "歡迎加入，想先做什麼？", body: "用清楚入口取代一大段歡迎文字，讓顧客直接開始。", details: [["預約服務", "查看可約時間"], ["其他服務", "活動／會員"]], primaryAction: "開啟服務選單", secondaryAction: "聯絡客服", badge: "歡迎加入", accent: "#06A94D", systemManaged: true },
  { key: "service_hub", category: "entry", title: "功能導覽中心", trigger: "點選選單／輸入關鍵字", headline: "所有服務，一次找到", body: "承接圖文選單放不下的說明，保留預約、活動、票券與會員四條主線。", details: [["預約", "查詢・改期・取消"], ["活動", "報名・票券・報到"]], primaryAction: "立即預約", secondaryAction: "瀏覽活動", badge: "服務導覽", accent: "#173F48", systemManaged: true },
  { key: "booking_confirmed", category: "booking", title: "預約成立", trigger: "預約確認／付款完成", headline: "時間已為你保留", body: "把時間、服務與人員集中顯示，顧客不必回頭翻找。", details: [["時間", "08/18（二）14:30"], ["服務", "體驗諮詢"], ["服務人員", "王老師"]], primaryAction: "查看預約詳情", secondaryAction: "加入行事曆", badge: "預約已確認", accent: "#147A5B", systemManaged: true },
  { key: "payment_pending", category: "booking", title: "訂金待付款", trigger: "建立需訂金的預約", headline: "訂金尚未完成", body: "清楚顯示金額與保留狀態，主要按鈕只處理付款。", details: [["訂金", "NT$ 500"], ["預約保留", "付款完成後確認"], ["付款狀態", "待付款"]], primaryAction: "立即完成付款", secondaryAction: "查看預約", badge: "需要完成付款", accent: "#A66B16", systemManaged: true },
  { key: "appointment_reminder", category: "booking", title: "行前提醒", trigger: "預約前 N 小時", headline: "你的預約快到了", body: "以台北時間顯示日期、星期與時段，附上處理入口。", details: [["時間", "08/18（二）14:30"], ["提醒", "請提早 10 分鐘抵達"], ["地點", "品牌門市"]], primaryAction: "查看預約詳情", secondaryAction: "需要改期", badge: "行前提醒", accent: "#326C78", systemManaged: true },
  { key: "appointment_changed", category: "booking", title: "改期／取消結果", trigger: "狀態異動完成", headline: "預約時間已更新", body: "只呈現最新有效狀態，避免舊通知與新狀態互相衝突。", details: [["新時間", "08/20（四）16:00"], ["狀態", "已改期"], ["通知", "以此卡為準"]], primaryAction: "查看最新預約", secondaryAction: "再次預約", badge: "時間已更新", accent: "#53658A", systemManaged: true },
  { key: "waitlist_joined", category: "booking", title: "候補登記", trigger: "加入候補", headline: "已排入候補名單", body: "顯示順位與候補目標，降低顧客對遞補進度的疑慮。", details: [["候補順位", "第 2 位"], ["希望日期", "08/22（六）"], ["通知方式", "LINE 自動通知"]], primaryAction: "查看候補狀態", secondaryAction: "取消候補", badge: "候補登記完成", accent: "#5F6E67", systemManaged: true },
  { key: "waitlist_offer", category: "booking", title: "候補名額釋出", trigger: "名額遞補成功", headline: "候補名額已釋出", body: "把保留期限與接受動作放在第一視線，減少名額閒置。", details: [["保留至", "今天 18:30"], ["服務", "體驗諮詢"], ["狀態", "等待接受"]], primaryAction: "接受這個名額", secondaryAction: "放棄名額", badge: "需要你的確認", accent: "#A66B16", systemManaged: true },
  { key: "quick_rebook", category: "booking", title: "快速再次預約", trigger: "服務完成／顧客主動開啟", headline: "要預約同一項服務嗎？", body: "帶入上次服務與偏好，縮短回訪預約步驟。", details: [["上次服務", "體驗諮詢"], ["偏好人員", "王老師"], ["步驟", "只需選日期時間"]], primaryAction: "快速再次預約", secondaryAction: "選其他服務", badge: "再次預約", accent: "#147A5B", systemManaged: true },
  { key: "registration_confirmed", category: "events", title: "活動報名成功", trigger: "報名／付款確認", headline: "報名完成", body: "活動時間、地點與票數集中顯示，接著就能開啟票券。", details: [["活動", "夏日體驗課"], ["時間", "08/29（六）10:00"], ["票數", "2 張"]], primaryAction: "開啟電子票券", secondaryAction: "活動資訊", badge: "報名已確認", accent: "#6656B8", systemManaged: true },
  { key: "ticket_ready", category: "events", title: "票券與 QR 報到", trigger: "報名完成／活動前提醒", headline: "電子票券可以使用了", body: "QR 留在已驗證的票券頁，不放進可轉傳的長文字。", details: [["票券", "一般票 × 2"], ["報到", "出示動態 QR"], ["狀態", "可使用"]], primaryAction: "開啟票券 QR", secondaryAction: "查看活動", badge: "電子票券", accent: "#6656B8", systemManaged: true },
  { key: "membership_balance", category: "member", title: "會員／套票餘額", trigger: "購買完成／餘額查詢", headline: "你的會員權益", body: "顯示方案、剩餘堂數與期限，並直接銜接可使用的預約入口。", details: [["方案", "安心體驗套票"], ["剩餘", "4 堂"], ["有效至", "2026/12/31"]], primaryAction: "使用套票預約", secondaryAction: "查看使用紀錄", badge: "會員權益", accent: "#9A7125", systemManaged: true },
  { key: "campaign", category: "marketing", title: "分眾行銷活動", trigger: "CRM Lite 規則／人工發送", headline: "為你保留的本月活動", body: "一則訊息只服務一個目標，搭配同意、排除與不重複投遞規則。", details: [["對象", "90 天未回訪"], ["優惠", "指定服務 9 折"], ["期限", "08/31 前"]], primaryAction: "查看活動內容", secondaryAction: "暫停行銷通知", badge: "為你推薦", accent: "#A64F66", systemManaged: false },
  { key: "support_handoff", category: "support", title: "客服接手與離線回覆", trigger: "需要真人／非服務時段", headline: "已為你轉交客服", body: "說明回覆時段與案件狀態，避免顧客持續重複傳送。", details: [["案件狀態", "等待客服接手"], ["服務時間", "週一至週五 09:00–18:00"], ["預計回覆", "1 個工作日內"]], primaryAction: "查看常見問題", secondaryAction: "回到服務選單", badge: "客服處理中", accent: "#326C78", systemManaged: true },
];

type FlexButton = { label: string; uri: string; primary?: boolean };

function detailRows(details: Array<[string, string]>): Array<Record<string, unknown>> {
  return details.map(([label, value]) => ({
    type: "box",
    layout: "baseline",
    spacing: "sm",
    contents: [
      { type: "text", text: label, color: "#7A8580", size: "sm", flex: 3 },
      { type: "text", text: value, color: "#1A2822", size: "sm", weight: "bold", wrap: true, flex: 7, align: "end" },
    ],
  }));
}

function flexCard(input: {
  altText: string;
  context: string;
  badge: string;
  title: string;
  body: string;
  accent: string;
  details: Array<[string, string]>;
  buttons: FlexButton[];
}): Record<string, unknown> {
  return {
    type: "flex",
    altText: input.altText.slice(0, 400),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        paddingTop: "18px",
        paddingBottom: "16px",
        paddingStart: "20px",
        paddingEnd: "20px",
        backgroundColor: "#FFFFFF",
        contents: [
          { type: "text", text: input.context, size: "xs", color: "#7A8580", wrap: true },
          { type: "text", text: input.badge, size: "xs", weight: "bold", color: input.accent, margin: "lg" },
          { type: "text", text: input.title, size: "xl", weight: "bold", color: "#17231E", wrap: true, margin: "sm" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingTop: "16px",
        paddingBottom: "18px",
        paddingStart: "20px",
        paddingEnd: "20px",
        contents: [
          { type: "text", text: input.body, size: "sm", color: "#5F6E67", wrap: true, lineSpacing: "5px" },
          { type: "separator", margin: "lg", color: "#E3E8E5" },
          { type: "box", layout: "vertical", margin: "lg", spacing: "md", contents: detailRows(input.details) },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        spacing: "sm",
        paddingTop: "12px",
        paddingBottom: "16px",
        paddingStart: "16px",
        paddingEnd: "16px",
        backgroundColor: "#FAFBFA",
        contents: input.buttons.map((button) => ({
          type: "button",
          height: "sm",
          style: button.primary ? "primary" : "secondary",
          color: button.primary ? "#173F48" : "#315C50",
          action: { type: "uri", label: button.label.slice(0, 40), uri: button.uri },
        })),
      },
      styles: { body: { separator: true, separatorColor: input.accent }, footer: { separator: true, separatorColor: "#E5E9E7" } },
    },
  };
}

export type AppointmentFlexKind = "pending" | "confirmed" | "cancelled" | "rescheduled" | "reminder";

export function buildAppointmentStatusFlex(input: {
  kind: AppointmentFlexKind;
  clinicName: string;
  dateTime: string;
  serviceName: string;
  providerName: string;
  manageUrl: string;
  depositAmount?: number;
  queueNumber?: number | null;
}): Record<string, unknown> {
  const config = {
    pending: { badge: "需要完成付款", title: "訂金尚未完成", body: "預約已暫時保留；完成付款後，系統才會正式確認。", accent: "#A66B16", action: "立即完成付款" },
    confirmed: { badge: "預約已確認", title: "時間已為你保留", body: "預約資訊整理如下；行前若有異動，可從按鈕直接處理。", accent: "#147A5B", action: "查看預約詳情" },
    cancelled: { badge: "預約已取消", title: "這次預約已取消", body: "這筆預約不再保留時段；需要時可重新查看可約時間。", accent: "#5F6E67", action: "重新查看時段" },
    rescheduled: { badge: "時間已更新", title: "預約改期完成", body: "請以這則訊息顯示的最新時間為準。", accent: "#53658A", action: "查看最新內容" },
    reminder: { badge: "行前提醒", title: "你的預約快到了", body: "請確認下方時間與服務；若行程有變，請提早處理。", accent: "#326C78", action: "查看預約詳情" },
  } as const;
  const selected = config[input.kind];
  const details: Array<[string, string]> = [
    ["時間", input.dateTime],
    ["服務", input.serviceName],
    ["服務人員", input.providerName],
  ];
  if (input.queueNumber) details.push(["號碼", String(input.queueNumber)]);
  if (input.kind === "pending" && input.depositAmount) details.push(["待付訂金", `NT$ ${input.depositAmount.toLocaleString("zh-TW")}`]);
  return flexCard({
    altText: `${input.clinicName}｜${selected.title}`,
    context: input.clinicName,
    badge: selected.badge,
    title: selected.title,
    body: selected.body,
    accent: selected.accent,
    details,
    buttons: [{ label: selected.action, uri: input.manageUrl, primary: true }],
  });
}

export function buildWaitlistStatusFlex(input: {
  kind: "joined" | "offered" | "booked" | "cancelled" | "expired";
  clinicName: string;
  target: string;
  position: number;
  offerDeadline?: string | null;
  manageUrl: string;
}): Record<string, unknown> {
  const config = {
    joined: { badge: "候補登記完成", title: "已排入候補名單", body: "名額釋出時會透過 LINE 通知你，不需要重複登記。", accent: "#5F6E67", action: "查看候補進度" },
    offered: { badge: "需要你的確認", title: "候補名額已釋出", body: "請在保留期限前確認；逾時後名額會依序提供給下一位。", accent: "#A66B16", action: "接受這個名額" },
    booked: { badge: "候補已轉為預約", title: "名額已為你保留", body: "候補已成功建立預約；若需要訂金，請接著完成付款。", accent: "#147A5B", action: "查看預約詳情" },
    cancelled: { badge: "候補已取消", title: "已取消候補登記", body: "這筆候補不會再遞補，需要時可以重新登記。", accent: "#5F6E67", action: "重新查看時段" },
    expired: { badge: "保留時間已結束", title: "候補名額已逾期", body: "名額已依序提供給下一位，需要時可重新登記。", accent: "#5F6E67", action: "重新查看時段" },
  } as const;
  const selected = config[input.kind];
  const details: Array<[string, string]> = [["候補目標", input.target], ["原候補順位", `第 ${input.position} 位`]];
  if (input.offerDeadline && input.kind === "offered") details.push(["保留期限", input.offerDeadline]);
  return flexCard({
    altText: `${input.clinicName}｜${selected.title}`,
    context: input.clinicName,
    badge: selected.badge,
    title: selected.title,
    body: selected.body,
    accent: selected.accent,
    details,
    buttons: [{ label: selected.action, uri: input.manageUrl, primary: true }],
  });
}

export function buildRegistrationStatusFlex(input: {
  kind: "pending" | "confirmed" | "waitlisted" | "cancelled";
  clinicName: string;
  eventTitle: string;
  registrationNo: string;
  sessionName: string;
  dateTime: string;
  venue: string;
  amount: string;
  actionUrl: string;
}): Record<string, unknown> {
  const config = {
    pending: { badge: "等待付款", title: "報名資料已保留", body: "完成付款後才會取得票券；逾期未付，系統會釋出名額。", accent: "#A66B16", action: "立即完成付款" },
    confirmed: { badge: "報名已確認", title: "報名完成", body: "電子票券已放在你的紀錄中；報到時請出示動態 QR。", accent: "#6656B8", action: "開啟電子票券" },
    waitlisted: { badge: "活動候補中", title: "已排入活動候補", body: "名額釋出時會透過 LINE 再次通知你。", accent: "#5F6E67", action: "查看候補狀態" },
    cancelled: { badge: "報名已取消", title: "這次報名已取消", body: "這筆報名不再保留名額，需要時可回到活動頁重新報名。", accent: "#5F6E67", action: "瀏覽其他活動" },
  } as const;
  const selected = config[input.kind];
  const details: Array<[string, string]> = [
    ["活動", input.eventTitle],
    ["場次", input.sessionName || input.dateTime],
    ["時間", input.dateTime],
    ["報名編號", input.registrationNo],
  ];
  if (input.venue) details.push(["地點", input.venue]);
  if (input.amount) details.push(["金額", input.amount]);
  return flexCard({
    altText: `${input.clinicName}｜${selected.title}`,
    context: input.clinicName,
    badge: selected.badge,
    title: selected.title,
    body: selected.body,
    accent: selected.accent,
    details,
    buttons: [{ label: selected.action, uri: input.actionUrl, primary: true }],
  });
}
