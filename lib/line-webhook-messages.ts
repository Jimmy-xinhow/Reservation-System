import type { SupabaseClient } from "@supabase/supabase-js";
import { getClinicSettings } from "@/lib/http";
import { issueLineAccountLinkToken, replyMessages, type LineMessage } from "@/lib/line";
import { getLineCustomerIdentity } from "@/lib/line-customer-identity";
import { buildLineMessage, type MsgData, type MsgKind } from "@/lib/lineMessage";
import { safeReply } from "@/lib/line-webhook-reply";
import { getPatientQueueToday, getQueueForDate, taipeiToday } from "@/lib/queue";
import { formatDateSession, formatTime } from "@/lib/slots";
import { buildLineExperienceCard, lineBrandTheme, type LineFlexButton } from "@/lib/line-ui-templates";

// ── 訊息樣板 ────────────────────────────────────────────────
function liffUrl(liffId: string | null, clinicSlug?: string | null): string | null {
  if (!liffId) return null;
  const url = new URL(`https://liff.line.me/${liffId}`);
  if (clinicSlug) url.searchParams.set("clinic_slug", clinicSlug);
  return url.toString();
}


export interface MenuConfig {
  title: string | null;
  booking: boolean;
  query: boolean;
  progress: boolean;
  info: boolean;
  linkLabel: string | null;
  linkUrl: string | null;
}

interface LineMessageBranding {
  clinicName: string;
  brandTemplate: string | null;
  brandPrimaryColor: string | null;
  brandAccentColor: string | null;
}

// 主選單卡片(歡迎 / 預設回覆共用):標題 + 內文 + 可自訂按鈕(只顯示文字,不露網址)
function menuBubble(title: string, body: string, baseUrl: string, cfg?: MenuConfig, branding?: LineMessageBranding): LineMessage {
  void baseUrl;
  const c = cfg ?? { title: null, booking: true, query: true, progress: false, info: true, linkLabel: null, linkUrl: null };
  const theme = lineBrandTheme(branding?.brandTemplate, branding?.brandPrimaryColor, branding?.brandAccentColor);
  const buttons: LineFlexButton[] = [];
  if (c.booking) {
    buttons.push({ label: "立即預約", primary: true, action: { type: "postback", data: "action=booking", displayText: "立即預約" } });
  }
  if (c.query) {
    buttons.push({ label: "查詢我的預約", action: { type: "postback", data: "action=my", displayText: "查詢我的預約" } });
  }
  if (c.progress) {
    buttons.push({ label: "服務進度", action: { type: "postback", data: "action=progress", displayText: "服務進度" } });
  }
  if (c.info) {
    buttons.push({ label: "品牌資訊", action: { type: "postback", data: "action=brand", displayText: "品牌資訊" } });
  }
  if (c.linkLabel && c.linkUrl) {
    buttons.push({ label: c.linkLabel, action: { type: "uri", uri: c.linkUrl } });
  }
  return buildLineExperienceCard({
    altText: title,
    context: branding?.clinicName ?? title,
    badge: "官方服務台",
    title,
    body,
    accent: theme.primary,
    softAccent: theme.soft,
    markerColor: theme.accent,
    highlight: ["快速入口", "預約・查詢・品牌服務"],
    details: [["使用方式", "直接點選下方需要辦理的事項"]],
    buttons: buttons.slice(0, 5),
  });
}

export function welcomeMessage(baseUrl: string, custom: string | null | undefined, cfg: MenuConfig | undefined, liffId: string | null, clinicSlug?: string | null, clinicName = "預約與報名平台", branding?: LineMessageBranding): LineMessage {
  void liffId;
  void clinicSlug;
  return menuBubble(
    cfg?.title || `歡迎加入 ${clinicName}`,
    custom || "您可以在這裡線上預約、查詢或取消預約。請點下方按鈕開始。",
    baseUrl,
    cfg,
    branding,
  );
}

export function menuMessage(baseUrl: string, custom: string | null | undefined, cfg: MenuConfig | undefined, liffId: string | null, clinicSlug?: string | null, clinicName = "預約與報名平台", branding?: LineMessageBranding): LineMessage {
  void liffId;
  void clinicSlug;
  return menuBubble(cfg?.title || clinicName, custom || "請選擇目前想辦理的服務。", baseUrl, cfg, branding);
}

export function bookingPrompt(baseUrl: string, liffId: string | null, clinicSlug?: string | null, clinicName = "預約與報名平台"): LineMessage {
  const liff = liffUrl(liffId, clinicSlug);
  if (liff) {
    const rule = (text: string): LineMessage => ({
      type: "box",
      layout: "baseline",
      spacing: "sm",
      contents: [
        { type: "text", text: "•", size: "sm", color: "#0d9488", flex: 0 },
        { type: "text", text, size: "sm", color: "#475569", wrap: true, flex: 1 },
      ],
    });
    return {
      type: "flex",
      altText: "線上預約",
      contents: {
        type: "bubble",
        size: "kilo",
        header: {
          type: "box",
          layout: "vertical",
          backgroundColor: "#0d9488",
          paddingAll: "sm",
          contents: [{ type: "text", text: "線上預約", weight: "bold", size: "md", color: "#ffffff", align: "center" }],
        },
        body: {
          type: "box",
          layout: "vertical",
          paddingAll: "lg",
          spacing: "md",
          contents: [
            { type: "text", text: "預約前請留意", size: "sm", weight: "bold", color: "#0f172a" },
            rule("請依實際顧客資料預約，一位顧客同一天限預約一筆。"),
            rule("首次服務可能需要較完整資料，所需時間可能較長，請預留充足時間。"),
            rule("無法前來請務必提前取消，以免影響他人。"),
            {
              type: "box",
              layout: "vertical",
              backgroundColor: "#fef2f2",
              cornerRadius: "md",
              paddingAll: "sm",
              contents: [
                {
                  type: "text",
                  text: "累計三次未提前取消而未到，將暫停一個月線上預約資格。",
                  size: "xs",
                  color: "#dc2626",
                  wrap: true,
                },
              ],
            },
          ],
        },
        footer: {
          type: "box",
          layout: "vertical",
          contents: [
            {
              type: "button",
              style: "primary",
              color: "#2563eb",
              height: "sm",
              action: { type: "uri", label: "開始預約", uri: liff },
            },
          ],
        },
      },
    };
  }
  return menuBubble(clinicName, "預約功能即將開放，請稍後或洽服務人員。", baseUrl);
}

// ── 查詢我的預約 ────────────────────────────────────────────
interface ApptRow {
  id: string;
  start_at: string;
  queue_number: number | null;
  status: string;
  visit_type: string;
  doctors: { name: string } | null;
  patients: { name: string } | null;
  services: { name: string } | null;
}

export async function replyMyAppointments(
  replyToken: string,
  lineUserId: string | undefined,
  svc: SupabaseClient,
  clinicId: string,
  lineAccessToken: string,
  navigation?: { baseUrl: string; clinicSlug: string | null; liffId?: string | null } & Partial<LineMessageBranding>,
): Promise<void> {
  if (!lineUserId) {
    await safeReply(replyToken, "無法取得您的 LINE 身分，請稍後再試。", lineAccessToken);
    return;
  }
  const settings = await getClinicSettings(svc, clinicId);
  const mode = settings?.booking_mode ?? "time";

  const { data: patients } = await svc
    .from("patients")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("line_user_id", lineUserId);
  const ids = (patients ?? []).map((p) => p.id);
  if (ids.length === 0) {
    if (navigation?.clinicSlug) {
      const identity = await getLineCustomerIdentity(svc, clinicId, lineUserId);
      const theme = lineBrandTheme(navigation.brandTemplate, navigation.brandPrimaryColor, navigation.brandAccentColor);
      if (identity) {
        await replyMessages(replyToken, [buildLineExperienceCard({
          altText: `${navigation.clinicName ?? "品牌"}｜目前沒有未來預約`,
          context: navigation.clinicName ?? "品牌官方帳號",
          badge: "我的預約",
          title: "目前沒有即將到來的預約",
          body: "LINE 會員身分已綁定；完成預約後，日期與服務會顯示在這裡。",
          accent: theme.primary,
          softAccent: theme.soft,
          markerColor: theme.accent,
          highlight: ["未來預約", "0 筆"],
          details: [["LINE 身分", "已完成綁定"]],
          buttons: [{ label: "立即選擇預約服務", primary: true, action: { type: "postback", data: "action=booking", displayText: "立即預約" } }],
        })], lineAccessToken);
        return;
      }
      const linkToken = await issueLineAccountLinkToken(lineUserId, lineAccessToken).catch(() => null);
      const linkUrl = new URL("/line/account-link", navigation.baseUrl);
      linkUrl.searchParams.set("clinic_slug", navigation.clinicSlug);
      if (linkToken) linkUrl.searchParams.set("linkToken", linkToken);
      linkUrl.searchParams.set("mode", "existing");
      await replyMessages(replyToken, [buildLineExperienceCard({
        altText: `${navigation.clinicName ?? "品牌"}｜綁定 LINE 會員資料`,
        context: navigation.clinicName ?? "品牌官方帳號",
        badge: "會員服務",
        title: "啟用 LINE 會員",
        body: "直接使用目前這個 LINE 帳號完成綁定，不需要離開聊天室。",
        accent: theme.primary,
        softAccent: theme.soft,
        markerColor: theme.accent,
        highlight: ["綁定方式", "LINE 內一鍵完成"],
        details: [["個人資料", "需要預約或付款時再補"]],
        buttons: [
          { label: "直接綁定目前 LINE", primary: true, action: { type: "postback", data: "action=bind_member", displayText: "啟用 LINE 會員" } },
          ...(linkToken ? [{ label: "找回品牌既有會員", action: { type: "uri" as const, uri: linkUrl.toString() } }] : []),
        ],
      })], lineAccessToken);
    } else {
      await safeReply(replyToken, "查無您名下的預約。若為初次使用，請先完成預約。", lineAccessToken);
    }
    return;
  }

  // 以「今天開始」為界(而非現在),否則號次制當天已到時段但仍候診的預約會被漏掉
  const todayStartIso = new Date(`${taipeiToday()}T00:00:00+08:00`).toISOString();
  const { data } = await svc
    .from("appointments")
    .select("id, start_at, queue_number, status, visit_type, doctors(name), patients(name), services(name)")
    .eq("clinic_id", clinicId)
    .in("patient_id", ids)
    .in("status", ["booked", "confirmed"])
    .gte("start_at", todayStartIso)
    .order("start_at")
    .limit(10);

  const rows = (data ?? []) as unknown as ApptRow[];
  if (rows.length === 0) {
    if (navigation) {
      const theme = lineBrandTheme(navigation.brandTemplate, navigation.brandPrimaryColor, navigation.brandAccentColor);
      await replyMessages(replyToken, [buildLineExperienceCard({
        altText: `${navigation.clinicName ?? "品牌"}｜目前沒有未來預約`,
        context: navigation.clinicName ?? "品牌官方帳號",
        badge: "我的預約",
        title: "目前沒有即將到來的預約",
        body: "完成預約後，日期、時間、服務與管理入口會集中顯示在這裡。",
        accent: theme.primary,
        softAccent: theme.soft,
        markerColor: theme.accent,
        highlight: ["未來預約", "0 筆"],
        details: [["下一步", "選擇服務並查看可用時段"]],
        buttons: [{ label: "立即選擇預約服務", primary: true, action: { type: "postback", data: "action=booking", displayText: "立即預約" } }],
      })], lineAccessToken);
    } else {
      await safeReply(replyToken, "您目前沒有未來的預約。", lineAccessToken);
    }
    return;
  }

  const theme = lineBrandTheme(navigation?.brandTemplate, navigation?.brandPrimaryColor, navigation?.brandAccentColor);

  // 每筆一個 bubble:標題表頭 + 主視覺(日期/號碼)+ 分隔線 + 資訊列 + 取消
  const bubbles = rows.map((r) => {
    // 主視覺:診次(日期)與號碼/時間分開呈現
    const hero: LineMessage[] = [
      { type: "text", text: formatDateSession(r.start_at), size: "sm", color: theme.primary, align: "center", weight: "bold", wrap: true },
    ];
    if (mode === "number") {
      hero.push({
        type: "box",
        layout: "vertical",
        backgroundColor: theme.primary,
        cornerRadius: "lg",
        paddingAll: "md",
        margin: "md",
        contents: [
          { type: "text", text: "服務號次", size: "xxs", color: "#d1fae5", align: "center" },
          { type: "text", text: `${r.queue_number ?? "?"}`, size: "3xl", weight: "bold", color: "#ffffff", align: "center" },
        ],
      });
    } else {
      hero.push({
        type: "text",
        text: formatTime(r.start_at),
        size: "3xl",
        weight: "bold",
        color: "#0f172a",
        align: "center",
        margin: "sm",
      });
    }

    return {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: theme.primary,
        paddingAll: "sm",
        contents: [
          { type: "box", layout: "vertical", width: "36px", height: "3px", backgroundColor: theme.accent, contents: [{ type: "filler" }] },
          { type: "text", text: navigation?.clinicName ?? "我的預約", size: "xs", weight: "bold", color: "#ffffff", margin: "md", wrap: true },
          { type: "text", text: "我的預約", size: "lg", weight: "bold", color: "#ffffff", margin: "sm" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        paddingAll: "lg",
        contents: [
          ...hero,
          { type: "separator", margin: "lg", color: "#e2e8f0" },
          {
            type: "box",
            layout: "vertical",
            spacing: "md",
            margin: "lg",
            contents: [
              infoRow("顧客", r.patients?.name ?? "—"),
              infoRow("服務提供者", r.doctors?.name ?? "—"),
              infoRow("服務", r.services?.name ?? "一般服務"),
              infoRow("類型", r.visit_type === "first" ? "首次服務" : "再次服務"),
            ],
          },
          {
            type: "box",
            layout: "vertical",
            backgroundColor: theme.soft,
            cornerRadius: "md",
            paddingAll: "sm",
            margin: "lg",
            contents: [
              { type: "text", text: "預約已確認", size: "xs", weight: "bold", align: "center", color: theme.primary },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingTop: "none",
        spacing: "sm",
        contents: [
          ...(navigation ? [{
            type: "button",
            style: "primary",
            color: theme.primary,
            height: "sm",
            action: {
              type: "uri",
              label: "改期這筆預約",
              uri: `${navigation.baseUrl}/book/reschedule?appointment_id=${encodeURIComponent(r.id)}${navigation.clinicSlug ? `&clinic_slug=${encodeURIComponent(navigation.clinicSlug)}` : ""}&liff=1`,
            },
          }] : []),
          {
            type: "button",
            style: "secondary",
            height: "sm",
            action: { type: "postback", label: "取消這筆", data: `action=cancel&id=${r.id}`, displayText: "取消預約" },
          },
        ],
      },
    };
  });

  await replyMessages(replyToken, [
    { type: "flex", altText: "您的預約", contents: { type: "carousel", contents: bubbles } },
  ], lineAccessToken);
}

// 依訊息素材 id 建構 LINE 訊息
export async function buildMessageById(
  svc: SupabaseClient,
  messageId: string,
  baseUrl: string,
  clinicId: string,
  liffId: string | null,
  clinicSlug: string | null,
): Promise<LineMessage | null> {
  const { data } = await svc
    .from("line_messages")
    .select("kind, data")
    .eq("id", messageId)
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (!data) return null;
  return buildLineMessage(data.kind as MsgKind, data.data as MsgData, { liffUrl: liffUrl(liffId, clinicSlug), baseUrl }) as LineMessage | null;
}

// 分類資訊列:左標籤(圖示)+ 右內容
function infoRow(label: string, value: string): LineMessage {
  return {
    type: "box",
    layout: "horizontal",
    contents: [
      { type: "text", text: label, size: "sm", color: "#94a3b8", flex: 2, gravity: "center" },
      { type: "text", text: value, size: "sm", color: "#334155", weight: "bold", flex: 5, wrap: true, align: "end", gravity: "center" },
    ],
  };
}

// ── 服務進度(相容舊版號次流程) ─────────────────────────────
export async function replyProgress(
  replyToken: string,
  lineUserId: string | undefined,
  svc: SupabaseClient,
  clinicId: string,
  lineAccessToken: string,
): Promise<void> {
  if (!lineUserId) {
    await safeReply(replyToken, "無法取得您的 LINE 身分，請稍後再試。", lineAccessToken);
    return;
  }
  const settings = await getClinicSettings(svc, clinicId);
  const mode = settings?.booking_mode ?? "time";
  const allSessions = await getQueueForDate(svc, clinicId, taipeiToday(), mode);
  const mine = await getPatientQueueToday(svc, clinicId, lineUserId, mode);

  // 只保留:顧客有號碼、且場次尚未結束的場次(過場次後不再顯示)
  const nowMs = Date.now();
  const sessions = allSessions.filter((s) => {
    const notEnded = !s.sessionEnd || new Date(s.sessionEnd).getTime() > nowMs;
    const hasMine = mine.some((m) => m.doctorName === s.doctorName && m.label === s.label);
    return notEnded && hasMine;
  });

  if (sessions.length === 0) {
    await replyMessages(replyToken, [
      { type: "text", text: "您目前沒有進行中的服務。若服務已完成或場次已結束，將不再顯示進度。" },
    ], lineAccessToken);
    return;
  }

  // 每個服務時段一張卡:色塊分類、內容置中
  const bubbles = sessions.map((s) => {
    const myItems = mine.filter((m) => m.doctorName === s.doctorName && m.label === s.label);
    const myBlocks = myItems.map((m) => {
      // 狀態:過號 / 服務中 / 即將(前2位內)/ 等候中
      const passed = m.current > 0 && m.current > m.yourNumber;
      const serving = m.current > 0 && m.current === m.yourNumber;
      const near = m.current > 0 && m.yourNumber - m.current > 0 && m.yourNumber - m.current <= 2;
      const waiting = m.current ? Math.max(0, m.yourNumber - m.current) : m.yourNumber;
      const statusText = passed
        ? "您的號碼已過，如仍需服務請洽服務人員"
        : serving
          ? "輪到您了，請依現場指示"
          : near
            ? "即將輪到您，請就位"
            : `尚有約 ${waiting} 位候診`;
      const highlight = serving || near;
      const bg = passed ? "#f1f5f9" : highlight ? "#fef2f2" : "#eff6ff";
      const fg = passed ? "#94a3b8" : highlight ? "#dc2626" : "#1d4ed8";
      return {
        type: "box",
        layout: "vertical",
        backgroundColor: bg,
        cornerRadius: "md",
        paddingAll: "md",
        margin: "md",
        contents: [
          {
            type: "text",
            text: `您的號碼　${m.source === "offline" ? "現場" : "線上"} ${m.yourNumber} 號`,
            size: "sm",
            weight: "bold",
            align: "center",
            color: fg,
          },
          {
            type: "text",
            text: statusText,
            size: "xs",
            align: "center",
            color: passed ? "#94a3b8" : highlight ? "#dc2626" : "#64748b",
            margin: "xs",
            wrap: true,
          },
        ],
      };
    });
    return {
      type: "bubble",
      size: "kilo",
      header: {
        type: "box",
        layout: "vertical",
        backgroundColor: "#0d9488",
        paddingAll: "sm",
        contents: [
          { type: "text", text: "服務進度", size: "md", weight: "bold", color: "#ffffff", align: "center" },
        ],
      },
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        paddingAll: "lg",
        contents: [
          { type: "text", text: `${s.doctorName}　${s.label}`, size: "xs", color: "#64748b", align: "center", wrap: true },
          {
            type: "box",
            layout: "horizontal",
            spacing: "md",
            contents: [
              currentBlock("線上目前", s.onlineCurrent, "#eff6ff", "#2563eb"),
              currentBlock("現場目前", s.offlineCurrent, "#f0fdfa", "#0d9488"),
            ],
          },
          ...myBlocks,
        ],
      },
    };
  });

  await replyMessages(replyToken, [
    { type: "flex", altText: "今日服務進度", contents: { type: "carousel", contents: bubbles } },
  ], lineAccessToken);
}

// 目前叫號色塊(置中)
function currentBlock(label: string, value: number, bg: string, color: string): LineMessage {
  return {
    type: "box",
    layout: "vertical",
    flex: 1,
    backgroundColor: bg,
    cornerRadius: "md",
    paddingAll: "md",
    contents: [
      { type: "text", text: label, size: "xxs", color: "#94a3b8", align: "center" },
      { type: "text", text: value ? `${value}` : "未開始", size: "xxl", weight: "bold", color, align: "center" },
    ],
  };
}

// 通用資訊卡(標題 + 內文 + 選單按鈕)
