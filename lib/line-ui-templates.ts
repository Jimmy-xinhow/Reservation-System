export type LineUiCategory = "entry" | "booking" | "events" | "member" | "marketing" | "support" | "staff";

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
  { key: "staff", label: "員工作業" },
];

export const LINE_UI_TEMPLATES: LineUiTemplateDefinition[] = [
  { key: "welcome", category: "entry", title: "加入好友歡迎", trigger: "首次加入好友", headline: "歡迎加入，想先做什麼？", body: "用清楚入口取代一大段歡迎文字，讓顧客直接開始。", details: [["預約服務", "查看可約時間"], ["其他服務", "活動／會員"]], primaryAction: "開啟服務選單", secondaryAction: "聯絡客服", badge: "歡迎加入", accent: "#06A94D", systemManaged: true },
  { key: "service_hub", category: "entry", title: "LINE 原生服務選單", trigger: "點選圖文選單／輸入關鍵字", headline: "想先辦理哪一件事？", body: "直接在 LINE 選擇預約、活動、票券、會員或客服，不先跳到網站首頁。", details: [["主要入口", "預約・活動・票券"], ["帳戶服務", "會員・客服・品牌資訊"]], primaryAction: "立即預約", secondaryAction: "瀏覽活動", badge: "LINE 服務選單", accent: "#173F48", systemManaged: true },
  { key: "booking_service_select", category: "booking", title: "選擇預約服務", trigger: "點選立即預約", headline: "先選擇要預約的服務", body: "以 LINE 快速選項顯示品牌目前開放的服務，顧客不必先進入完整網站。", details: [["選擇方式", "LINE 快速選項"], ["資料來源", "即時開放服務"]], primaryAction: "選擇一項服務", secondaryAction: "查看全部服務", badge: "步驟 1／2", accent: "#126248", systemManaged: true },
  { key: "booking_date_select", category: "booking", title: "選擇預約日期", trigger: "選定服務", headline: "哪一天方便前來？", body: "使用 LINE 日期選擇器，依品牌可預約區間限制日期，再開啟單一時段任務頁。", details: [["已選服務", "體驗諮詢"], ["可選日期", "今天起 30 天內"]], primaryAction: "選擇日期", badge: "步驟 2／2", accent: "#126248", systemManaged: true },
  { key: "booking_confirmed", category: "booking", title: "預約成立", trigger: "預約確認／付款完成", headline: "時間已為你保留", body: "先突出最新預約時間，再列出服務與服務人員，避免顧客回頭翻找。", details: [["預約時間", "08/18（二）14:30"], ["服務", "體驗諮詢"], ["服務人員", "王老師"]], primaryAction: "查看／管理這筆預約", badge: "預約已確認", accent: "#126248", systemManaged: true },
  { key: "payment_pending", category: "booking", title: "訂金待付款", trigger: "建立需訂金的預約", headline: "訂金尚未完成", body: "先說明目前只是暫時保留，再讓顧客直接進入這筆預約完成付款。", details: [["預約時間", "08/18（二）14:30"], ["待付訂金", "NT$ 500"], ["付款狀態", "尚未完成"]], primaryAction: "前往完成訂金付款", badge: "待完成付款", accent: "#8A5A16", systemManaged: true },
  { key: "appointment_reminder", category: "booking", title: "行前提醒", trigger: "預約前 N 小時", headline: "你的預約快到了", body: "使用與預約成立相同的資訊順序，並提供管理預約與取消兩個明確動作。", details: [["預約時間", "08/18（二）14:30"], ["服務", "體驗諮詢"], ["服務人員", "王老師"]], primaryAction: "查看／管理這筆預約", secondaryAction: "取消這筆預約", badge: "預約行前提醒", accent: "#286675", systemManaged: true },
  { key: "appointment_changed", category: "booking", title: "改期／取消結果", trigger: "狀態異動完成", headline: "預約改期完成", body: "突出最新有效時間，清楚告知舊時間已失效，避免新舊通知互相衝突。", details: [["最新預約時間", "08/20（四）16:00"], ["服務", "體驗諮詢"], ["狀態", "改期完成"]], primaryAction: "查看最新預約時間", badge: "時間已更新", accent: "#4B5F86", systemManaged: true },
  { key: "waitlist_joined", category: "booking", title: "候補登記", trigger: "加入候補", headline: "已排入候補名單", body: "先顯示候補服務與順位，並說明有名額時會主動通知。", details: [["候補服務", "08/22（六）體驗諮詢"], ["登記順位", "第 2 位"], ["通知方式", "LINE 自動通知"]], primaryAction: "查看目前候補進度", badge: "候補登記完成", accent: "#53615B", systemManaged: true },
  { key: "waitlist_offer", category: "booking", title: "候補名額釋出", trigger: "名額遞補成功", headline: "候補名額已釋出", body: "把候補服務、保留期限與接受動作放在第一視線。", details: [["候補服務", "08/22（六）體驗諮詢"], ["保留期限", "今天 18:30"], ["狀態", "等待接受"]], primaryAction: "接受這次候補名額", badge: "需要你的確認", accent: "#8A5A16", systemManaged: true },
  { key: "quick_rebook", category: "booking", title: "快速再次預約", trigger: "服務完成／顧客主動開啟", headline: "要預約同一項服務嗎？", body: "帶入上次服務與偏好，縮短回訪預約步驟。", details: [["上次服務", "體驗諮詢"], ["偏好人員", "王老師"], ["步驟", "只需選日期時間"]], primaryAction: "快速再次預約", secondaryAction: "選其他服務", badge: "再次預約", accent: "#147A5B", systemManaged: true },
  { key: "registration_confirmed", category: "events", title: "活動報名成功", trigger: "報名／付款確認", headline: "報名完成", body: "先顯示活動名稱，再依序列出時間、場次、地點與報名編號。", details: [["活動／課程", "夏日體驗課"], ["日期時間", "08/29（六）10:00"], ["報名編號", "REG-20260829-001"]], primaryAction: "開啟這筆報名的電子票券", badge: "報名已確認", accent: "#594B99", systemManaged: true },
  { key: "ticket_ready", category: "events", title: "票券與 QR 報到", trigger: "報名完成／活動前提醒", headline: "電子票券可以使用了", body: "QR 留在已驗證的票券頁，不放進可轉傳的長文字。", details: [["票券", "一般票 × 2"], ["報到", "出示動態 QR"], ["狀態", "可使用"]], primaryAction: "開啟票券 QR", secondaryAction: "查看活動", badge: "電子票券", accent: "#6656B8", systemManaged: true },
  { key: "membership_balance", category: "member", title: "會員／套票餘額", trigger: "購買完成／餘額查詢", headline: "你的會員權益", body: "顯示方案、剩餘堂數與期限，並直接銜接可使用的預約入口。", details: [["方案", "安心體驗套票"], ["剩餘", "4 堂"], ["有效至", "2026/12/31"]], primaryAction: "使用套票預約", secondaryAction: "查看使用紀錄", badge: "會員權益", accent: "#9A7125", systemManaged: true },
  { key: "account_link", category: "member", title: "LINE 會員綁定", trigger: "首次查詢個人資料", headline: "綁定後即可直接查詢", body: "透過 LINE 官方帳號連結流程驗證既有會員，不把會員資料或一次性憑證放在聊天訊息內。", details: [["完成後可用", "預約・票券・會員權益"], ["驗證方式", "姓名・電話・生日"]], primaryAction: "開始安全綁定", badge: "會員身分驗證", accent: "#315C50", systemManaged: true },
  { key: "campaign", category: "marketing", title: "分眾行銷活動", trigger: "CRM Lite 規則／人工發送", headline: "為你保留的本月活動", body: "一則訊息只服務一個目標，搭配同意、排除與不重複投遞規則。", details: [["對象", "90 天未回訪"], ["優惠", "指定服務 9 折"], ["期限", "08/31 前"]], primaryAction: "查看活動內容", secondaryAction: "暫停行銷通知", badge: "為你推薦", accent: "#A64F66", systemManaged: false },
  { key: "support_handoff", category: "support", title: "客服接手與離線回覆", trigger: "需要真人／非服務時段", headline: "已為你轉交客服", body: "說明回覆時段與案件狀態，避免顧客持續重複傳送。", details: [["案件狀態", "等待客服接手"], ["服務時間", "週一至週五 09:00–18:00"], ["預計回覆", "1 個工作日內"]], primaryAction: "查看常見問題", secondaryAction: "回到服務選單", badge: "客服處理中", accent: "#326C78", systemManaged: true },
  { key: "support_active", category: "support", title: "LINE 客服對話", trigger: "點選 LINE 客服", headline: "請直接輸入你的問題", body: "顧客訊息會進入品牌後台對話；品牌人員的回覆會真正推送回同一個 LINE 帳號。", details: [["目前狀態", "客服對話中"], ["離線處理", "保留訊息，服務時間回覆"]], primaryAction: "結束客服", secondaryAction: "回到服務選單", badge: "客服已連線", accent: "#326C78", systemManaged: true },
  { key: "staff_today", category: "staff", title: "員工今日工作", trigger: "已綁定員工輸入今日工作", headline: "今天需要處理的工作", body: "依員工權限顯示今日行程、待確認事項與交班待辦；不回傳其他品牌資料。", details: [["今日行程", "6 筆"], ["待確認", "2 筆"], ["交班待辦", "1 筆"]], primaryAction: "查看今日行程", secondaryAction: "查看待確認", badge: "員工作業", accent: "#34495E", systemManaged: true },
];

type FlexButton = {
  label: string;
  primary?: boolean;
  action:
    | { type: "uri"; uri: string }
    | { type: "postback"; data: string; displayText?: string };
};

function detailRows(details: Array<[string, string]>): Array<Record<string, unknown>> {
  return details.flatMap(([label, value], index) => [
    {
      type: "box",
      layout: "horizontal",
      spacing: "md",
      contents: [
        { type: "text", text: label, color: "#68736E", size: "xs", flex: 3, scaling: true },
        { type: "text", text: value, color: "#17231E", size: "sm", weight: "bold", wrap: true, flex: 7, align: "end", scaling: true },
      ],
    },
    ...(index < details.length - 1 ? [{ type: "separator", color: "#E7EBE9" }] : []),
  ]);
}

function flexAction(button: FlexButton): Record<string, unknown> {
  const label = button.label.slice(0, 40);
  return button.action.type === "uri"
    ? { type: "uri", label, uri: button.action.uri }
    : { type: "postback", label, data: button.action.data, ...(button.action.displayText ? { displayText: button.action.displayText } : {}) };
}

function statusCard(input: {
  altText: string;
  context: string;
  badge: string;
  title: string;
  body: string;
  accent: string;
  softAccent: string;
  highlight: [string, string];
  details: Array<[string, string]>;
  buttons: FlexButton[];
}): Record<string, unknown> {
  return {
    type: "flex",
    altText: input.altText.slice(0, 1500),
    contents: {
      type: "bubble",
      size: "mega",
      header: {
        type: "box",
        layout: "vertical",
        paddingTop: "16px",
        paddingBottom: "18px",
        paddingStart: "20px",
        paddingEnd: "20px",
        backgroundColor: input.accent,
        contents: [
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            contents: [
              { type: "text", text: input.context, size: "xs", color: "#FFFFFF", weight: "bold", wrap: true, flex: 7, scaling: true },
              { type: "text", text: input.badge, size: "xs", color: "#FFFFFF", weight: "bold", align: "end", wrap: true, flex: 5, scaling: true },
            ],
          },
          { type: "text", text: input.title, size: "xl", weight: "bold", color: "#FFFFFF", wrap: true, margin: "lg", scaling: true },
          { type: "text", text: input.body, size: "sm", color: "#FFFFFF", wrap: true, margin: "sm", scaling: true },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingTop: "18px",
        paddingBottom: "20px",
        paddingStart: "20px",
        paddingEnd: "20px",
        contents: [
          {
            type: "box",
            layout: "vertical",
            backgroundColor: input.softAccent,
            cornerRadius: "8px",
            paddingAll: "14px",
            contents: [
              { type: "text", text: input.highlight[0], size: "xs", color: "#68736E", weight: "bold", scaling: true },
              { type: "text", text: input.highlight[1], size: "lg", color: "#17231E", weight: "bold", wrap: true, margin: "sm", scaling: true },
            ],
          },
          { type: "box", layout: "vertical", margin: "xl", spacing: "md", contents: detailRows(input.details) },
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
          color: button.primary ? input.accent : "#315C50",
          scaling: true,
          adjustMode: "shrink-to-fit",
          action: flexAction(button),
        })),
      },
      styles: { footer: { separator: true, separatorColor: "#E5E9E7" } },
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
  cancelPostbackData?: string;
}): Record<string, unknown> {
  const config = {
    pending: { badge: "待完成付款", title: "訂金尚未完成", body: "預約目前暫時保留，完成訂金付款後才會正式確認。", accent: "#8A5A16", softAccent: "#FBF5E9", action: "前往完成訂金付款" },
    confirmed: { badge: "預約已確認", title: "時間已為你保留", body: "以下是這次預約的最新資訊；若需要改期或取消，請從下方按鈕處理。", accent: "#126248", softAccent: "#EDF7F2", action: "查看／管理這筆預約" },
    cancelled: { badge: "預約已取消", title: "這次預約已取消", body: "原時段已經釋出；需要再次安排時，可以重新選擇可預約時間。", accent: "#5B6460", softAccent: "#F1F3F2", action: "重新選擇預約時段" },
    rescheduled: { badge: "時間已更新", title: "預約改期完成", body: "舊時間已失效，請以這張卡片顯示的最新預約時間為準。", accent: "#4B5F86", softAccent: "#F0F2F8", action: "查看最新預約時間" },
    reminder: { badge: "預約行前提醒", title: "你的預約快到了", body: "請再次確認時間與服務內容；若無法前往，請提早改期或取消。", accent: "#286675", softAccent: "#EDF6F7", action: "查看／管理這筆預約" },
  } as const;
  const selected = config[input.kind];
  const details: Array<[string, string]> = [
    ["服務", input.serviceName],
    ["服務人員", input.providerName],
  ];
  if (input.queueNumber) details.push(["號碼", String(input.queueNumber)]);
  if (input.kind === "pending" && input.depositAmount) details.push(["待付訂金", `NT$ ${input.depositAmount.toLocaleString("zh-TW")}`]);
  const buttons: FlexButton[] = [{ label: selected.action, primary: true, action: { type: "uri", uri: input.manageUrl } }];
  if (input.kind === "reminder" && input.cancelPostbackData) {
    buttons.push({ label: "取消這筆預約", action: { type: "postback", data: input.cancelPostbackData, displayText: "取消這筆預約" } });
  }
  return statusCard({
    altText: `${input.clinicName}｜${selected.badge}｜${input.dateTime}｜${input.serviceName}｜下一步：${selected.action}`,
    context: input.clinicName,
    badge: selected.badge,
    title: selected.title,
    body: selected.body,
    accent: selected.accent,
    softAccent: selected.softAccent,
    highlight: ["預約時間", input.dateTime],
    details,
    buttons,
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
    joined: { badge: "候補登記完成", title: "已排入候補名單", body: "名額釋出時會透過 LINE 通知，不需要重複登記。", accent: "#53615B", softAccent: "#F1F4F2", action: "查看目前候補進度" },
    offered: { badge: "需要你的確認", title: "候補名額已釋出", body: "請在保留期限前確認；逾時後名額會依序提供給下一位。", accent: "#8A5A16", softAccent: "#FBF5E9", action: "接受這次候補名額" },
    booked: { badge: "候補轉為預約", title: "名額已為你保留", body: "候補已成功建立預約；若需要訂金，請接著完成付款。", accent: "#126248", softAccent: "#EDF7F2", action: "查看／管理這筆預約" },
    cancelled: { badge: "候補已取消", title: "已取消候補登記", body: "這筆候補不會再遞補，需要時可以重新登記。", accent: "#5B6460", softAccent: "#F1F3F2", action: "重新查看可預約時段" },
    expired: { badge: "保留時間已結束", title: "候補名額已逾期", body: "名額已依序提供給下一位，需要時可以重新登記。", accent: "#5B6460", softAccent: "#F1F3F2", action: "重新查看可預約時段" },
  } as const;
  const selected = config[input.kind];
  const details: Array<[string, string]> = [["登記順位", `第 ${input.position} 位`]];
  if (input.offerDeadline && input.kind === "offered") details.push(["保留期限", input.offerDeadline]);
  return statusCard({
    altText: `${input.clinicName}｜${selected.badge}｜${input.target}｜下一步：${selected.action}`,
    context: input.clinicName,
    badge: selected.badge,
    title: selected.title,
    body: selected.body,
    accent: selected.accent,
    softAccent: selected.softAccent,
    highlight: ["候補服務", input.target],
    details,
    buttons: [{ label: selected.action, primary: true, action: { type: "uri", uri: input.manageUrl } }],
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
    pending: { badge: "等待完成付款", title: "報名資料已保留", body: "完成付款後才會取得電子票券；逾期未付，系統會自動釋出名額。", accent: "#8A5A16", softAccent: "#FBF5E9", action: "前往完成這筆報名付款" },
    confirmed: { badge: "報名已確認", title: "報名完成", body: "電子票券已經建立；活動報到時，請開啟票券並出示動態 QR。", accent: "#594B99", softAccent: "#F2F0FA", action: "開啟這筆報名的電子票券" },
    waitlisted: { badge: "活動候補中", title: "已排入活動候補", body: "目前尚未取得名額；有名額釋出時，系統會再透過 LINE 通知。", accent: "#53615B", softAccent: "#F1F4F2", action: "查看這筆報名候補狀態" },
    cancelled: { badge: "報名已取消", title: "這次報名已取消", body: "這筆報名不再保留名額，需要時可以回到活動頁重新報名。", accent: "#5B6460", softAccent: "#F1F3F2", action: "查看目前可報名的活動" },
  } as const;
  const selected = config[input.kind];
  const details: Array<[string, string]> = [
    ["日期時間", input.dateTime],
    ...(input.sessionName ? [["場次", input.sessionName] as [string, string]] : []),
    ["報名編號", input.registrationNo],
  ];
  if (input.venue) details.push(["地點", input.venue]);
  if (input.amount) details.push(["金額", input.amount]);
  return statusCard({
    altText: `${input.clinicName}｜${selected.badge}｜${input.eventTitle}｜${input.dateTime}｜下一步：${selected.action}`,
    context: input.clinicName,
    badge: selected.badge,
    title: selected.title,
    body: selected.body,
    accent: selected.accent,
    softAccent: selected.softAccent,
    highlight: ["活動／課程", input.eventTitle],
    details,
    buttons: [{ label: selected.action, primary: true, action: { type: "uri", uri: input.actionUrl } }],
  });
}
