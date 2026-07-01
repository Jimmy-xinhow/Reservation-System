import { NextRequest } from "next/server";
import { createServiceClient, CLINIC_ID } from "@/lib/supabase";
import { getClinicSettings } from "@/lib/http";
import { verifyLineSignature, replyMessages, type LineMessage } from "@/lib/line";
import { formatDateSession, formatTime } from "@/lib/slots";
import { getPatientQueueToday, getQueueForDate, taipeiToday } from "@/lib/queue";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { userId?: string };
  message?: { type?: string; text?: string };
  postback?: { data?: string };
}

/**
 * POST /api/line/webhook
 * 驗 x-line-signature 後處理:
 *  - follow:加好友歡迎訊息
 *  - message(text):選單自動回覆 / 關鍵字(預約、查詢)
 *  - postback:confirm/cancel(提醒按鈕)、my(查詢我的預約)
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const signature = req.headers.get("x-line-signature");
  if (!verifyLineSignature(raw, signature)) {
    return new Response("invalid signature", { status: 401 });
  }

  let events: LineEvent[] = [];
  try {
    events = (JSON.parse(raw) as { events?: LineEvent[] }).events ?? [];
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const baseUrl = host ? `${proto}://${host}` : "";

  const svc = createServiceClient();

  // 讀取後台自訂的回覆規則與歡迎/預設文字
  const [{ data: rules }, { data: cs }] = await Promise.all([
    svc
      .from("line_auto_replies")
      .select("keywords, action, reply_text")
      .eq("clinic_id", CLINIC_ID)
      .eq("active", true)
      .order("sort"),
    svc
      .from("clinic_settings")
      .select(
        "line_welcome_text, line_fallback_text, line_menu_title, line_menu_btn_booking, line_menu_btn_query, line_menu_btn_progress, line_menu_btn_info, line_menu_link_label, line_menu_link_url",
      )
      .eq("clinic_id", CLINIC_ID)
      .maybeSingle(),
  ]);
  const replyRules = (rules ?? []) as { keywords: string; action: string; reply_text: string | null }[];
  const welcomeText = cs?.line_welcome_text || null;
  const fallbackText = cs?.line_fallback_text || null;
  const menuCfg: MenuConfig = {
    title: cs?.line_menu_title || null,
    booking: cs?.line_menu_btn_booking ?? true,
    query: cs?.line_menu_btn_query ?? true,
    progress: cs?.line_menu_btn_progress ?? true,
    info: cs?.line_menu_btn_info ?? true,
    linkLabel: cs?.line_menu_link_label || null,
    linkUrl: cs?.line_menu_link_url || null,
  };

  for (const ev of events) {
    if (!ev.replyToken) continue;
    try {
      if (ev.type === "follow") {
        await replyMessages(ev.replyToken, [welcomeMessage(baseUrl, welcomeText, menuCfg)]);
      } else if (ev.type === "message" && ev.message?.type === "text") {
        const text = (ev.message.text ?? "").trim();
        // 依後台規則(排序)找第一個命中的關鍵字
        const rule = replyRules.find((r) =>
          r.keywords
            .split(/[,,、\s]+/)
            .map((k) => k.trim())
            .filter(Boolean)
            .some((k) => text.includes(k)),
        );
        if (rule?.action === "progress") {
          await replyProgress(ev.replyToken, ev.source?.userId, svc, baseUrl);
        } else if (rule?.action === "query") {
          await replyMyAppointments(ev.replyToken, ev.source?.userId, svc);
        } else if (rule?.action === "booking") {
          await replyMessages(ev.replyToken, [bookingPrompt(baseUrl)]);
        } else if (rule?.action === "text" && rule.reply_text) {
          await replyMessages(ev.replyToken, [{ type: "text", text: rule.reply_text }]);
        } else {
          await replyMessages(ev.replyToken, [menuMessage(baseUrl, fallbackText, menuCfg)]);
        }
      } else if (ev.type === "postback" && ev.postback?.data) {
        const params = new URLSearchParams(ev.postback.data);
        const action = params.get("action");
        if (action === "my") {
          await replyMyAppointments(ev.replyToken, ev.source?.userId, svc);
        } else if (action === "progress") {
          await replyProgress(ev.replyToken, ev.source?.userId, svc, baseUrl);
        } else if (action === "confirm" || action === "cancel") {
          await handleStatusPostback(ev.replyToken, action, params.get("id"), svc);
        } else {
          await safeReply(ev.replyToken, "無法辨識的操作");
        }
      }
    } catch {
      await safeReply(ev.replyToken, "處理失敗,請稍後再試。");
    }
  }

  return new Response("ok", { status: 200 });
}

// ── 訊息樣板 ────────────────────────────────────────────────
function liffUrl(): string | null {
  const id = process.env.NEXT_PUBLIC_LIFF_ID;
  return id ? `https://liff.line.me/${id}` : null;
}


interface MenuConfig {
  title: string | null;
  booking: boolean;
  query: boolean;
  progress: boolean;
  info: boolean;
  linkLabel: string | null;
  linkUrl: string | null;
}

// 主選單卡片(歡迎 / 預設回覆共用):標題 + 內文 + 可自訂按鈕(只顯示文字,不露網址)
function menuBubble(title: string, body: string, baseUrl: string, cfg?: MenuConfig): LineMessage {
  const liff = liffUrl();
  const c = cfg ?? { title: null, booking: true, query: true, progress: true, info: true, linkLabel: null, linkUrl: null };
  const buttons: LineMessage[] = [];
  if (c.booking) {
    buttons.push({
      type: "button",
      style: "primary",
      color: "#2563eb",
      height: "sm",
      action: liff
        ? { type: "uri", label: "立即預約", uri: liff }
        : { type: "message", label: "立即預約", text: "預約" },
    });
  }
  if (c.query) {
    buttons.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: { type: "postback", label: "查詢我的預約", data: "action=my", displayText: "查詢我的預約" },
    });
  }
  if (c.progress) {
    buttons.push({
      type: "button",
      style: "secondary",
      height: "sm",
      action: { type: "postback", label: "看診進度", data: "action=progress", displayText: "看診進度" },
    });
  }
  if (c.info && baseUrl) {
    buttons.push({
      type: "button",
      style: "link",
      height: "sm",
      action: { type: "uri", label: "診所資訊", uri: baseUrl },
    });
  }
  if (c.linkLabel && c.linkUrl) {
    buttons.push({
      type: "button",
      style: "link",
      height: "sm",
      action: { type: "uri", label: c.linkLabel, uri: c.linkUrl },
    });
  }
  return {
    type: "flex",
    altText: title,
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        spacing: "md",
        contents: [
          { type: "text", text: title, weight: "bold", size: "lg", color: "#0d9488", wrap: true },
          { type: "text", text: body, size: "sm", color: "#555555", wrap: true },
        ],
      },
      footer: { type: "box", layout: "vertical", spacing: "sm", contents: buttons },
    },
  };
}

function welcomeMessage(baseUrl: string, custom?: string | null, cfg?: MenuConfig): LineMessage {
  return menuBubble(
    cfg?.title || "歡迎加入慈愛中醫診所 🌿",
    custom || "您可以在這裡線上預約、查詢或取消看診。請點下方按鈕開始。",
    baseUrl,
    cfg,
  );
}

function menuMessage(baseUrl: string, custom?: string | null, cfg?: MenuConfig): LineMessage {
  return menuBubble(cfg?.title || "慈愛中醫診所", custom || "請問需要什麼服務?請點下方按鈕。", baseUrl, cfg);
}

function bookingPrompt(baseUrl: string): LineMessage {
  const liff = liffUrl();
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
            rule("請依實際看診者資料預約,一位就診者同一天限預約一筆。"),
            rule("初診需較完整問診,看診時間較長,請預留充足時間。"),
            rule("無法前來請務必提前取消,以免影響他人。"),
            {
              type: "box",
              layout: "vertical",
              backgroundColor: "#fef2f2",
              cornerRadius: "md",
              paddingAll: "sm",
              contents: [
                {
                  type: "text",
                  text: "⚠️ 累計三次未提前取消而未到,將暫停一個月線上預約資格。",
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
  return menuBubble("慈愛中醫診所", "預約功能即將開放,請稍後或洽櫃檯。", baseUrl);
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

async function replyMyAppointments(
  replyToken: string,
  lineUserId: string | undefined,
  svc: SupabaseClient,
): Promise<void> {
  if (!lineUserId) {
    await safeReply(replyToken, "無法取得您的 LINE 身分,請稍後再試。");
    return;
  }
  const settings = await getClinicSettings(svc, CLINIC_ID);
  const mode = settings?.booking_mode ?? "time";

  const { data: patients } = await svc
    .from("patients")
    .select("id")
    .eq("clinic_id", CLINIC_ID)
    .eq("line_user_id", lineUserId);
  const ids = (patients ?? []).map((p) => p.id);
  if (ids.length === 0) {
    await safeReply(replyToken, "查無您名下的預約。若已是初次使用,請先完成預約。");
    return;
  }

  // 以「今天開始」為界(而非現在),否則號次制當天已到時段但仍候診的預約會被漏掉
  const todayStartIso = new Date(`${taipeiToday()}T00:00:00+08:00`).toISOString();
  const { data } = await svc
    .from("appointments")
    .select("id, start_at, queue_number, status, visit_type, doctors(name), patients(name), services(name)")
    .eq("clinic_id", CLINIC_ID)
    .in("patient_id", ids)
    .in("status", ["booked", "confirmed"])
    .gte("start_at", todayStartIso)
    .order("start_at")
    .limit(10);

  const rows = (data ?? []) as unknown as ApptRow[];
  if (rows.length === 0) {
    await safeReply(replyToken, "您目前沒有未來的預約。");
    return;
  }

  // 每筆一個 bubble:標題表頭 + 主視覺(日期/號碼)+ 分隔線 + 資訊列 + 取消
  const bubbles = rows.map((r) => {
    // 主視覺:診次(日期)與號碼/時間分開呈現
    const hero: LineMessage[] = [
      { type: "text", text: formatDateSession(r.start_at), size: "sm", color: "#0d9488", align: "center", weight: "bold", wrap: true },
    ];
    if (mode === "number") {
      hero.push({
        type: "box",
        layout: "vertical",
        backgroundColor: "#0d9488",
        cornerRadius: "lg",
        paddingAll: "md",
        margin: "md",
        contents: [
          { type: "text", text: "看診號碼", size: "xxs", color: "#d1fae5", align: "center" },
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
        backgroundColor: "#0d9488",
        paddingAll: "sm",
        contents: [
          { type: "text", text: "我的預約", size: "md", weight: "bold", color: "#ffffff", align: "center" },
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
              infoRow("就診者", r.patients?.name ?? "—"),
              infoRow("醫師", r.doctors?.name ?? "—"),
              infoRow("服務", r.services?.name ?? "一般看診"),
              infoRow("類型", r.visit_type === "first" ? "初診" : "複診"),
            ],
          },
          {
            type: "box",
            layout: "vertical",
            backgroundColor: "#f0fdfa",
            cornerRadius: "md",
            paddingAll: "sm",
            margin: "lg",
            contents: [
              { type: "text", text: "✓ 預約成功", size: "xs", weight: "bold", align: "center", color: "#0d9488" },
            ],
          },
        ],
      },
      footer: {
        type: "box",
        layout: "vertical",
        paddingTop: "none",
        contents: [
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
  ]);
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

// ── 看診進度 ────────────────────────────────────────────────
async function replyProgress(
  replyToken: string,
  lineUserId: string | undefined,
  svc: SupabaseClient,
  baseUrl: string,
): Promise<void> {
  if (!lineUserId) {
    await safeReply(replyToken, "無法取得您的 LINE 身分,請稍後再試。");
    return;
  }
  const settings = await getClinicSettings(svc, CLINIC_ID);
  const mode = settings?.booking_mode ?? "time";
  const allSessions = await getQueueForDate(svc, CLINIC_ID, taipeiToday(), mode);
  const mine = await getPatientQueueToday(svc, CLINIC_ID, lineUserId, mode);

  // 只保留:病患有號碼、且診次尚未結束的診次(過診次後不再顯示)
  const nowMs = Date.now();
  const sessions = allSessions.filter((s) => {
    const notEnded = !s.sessionEnd || new Date(s.sessionEnd).getTime() > nowMs;
    const hasMine = mine.some((m) => m.doctorName === s.doctorName && m.label === s.label);
    return notEnded && hasMine;
  });

  if (sessions.length === 0) {
    await replyMessages(replyToken, [
      { type: "text", text: "您目前沒有進行中的看診。若已看診完成或診次已結束,恕不再顯示進度。" },
    ]);
    return;
  }

  // 每個門診段一張卡:色塊分類、內容置中
  const bubbles = sessions.map((s) => {
    const myItems = mine.filter((m) => m.doctorName === s.doctorName && m.label === s.label);
    const myBlocks = myItems.map((m) => {
      // 狀態:過號 / 看診中 / 即將(前2位內)/ 候診
      const passed = m.current > 0 && m.current > m.yourNumber;
      const serving = m.current > 0 && m.current === m.yourNumber;
      const near = m.current > 0 && m.yourNumber - m.current > 0 && m.yourNumber - m.current <= 2;
      const waiting = m.current ? Math.max(0, m.yourNumber - m.current) : m.yourNumber;
      const statusText = passed
        ? "您的號碼已過,如仍需看診請洽櫃檯"
        : serving
          ? "輪到您看診了,請就位"
          : near
            ? "即將輪到您,請就位"
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
          { type: "text", text: "看診進度", size: "md", weight: "bold", color: "#ffffff", align: "center" },
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
    { type: "flex", altText: "今日看診進度", contents: { type: "carousel", contents: bubbles } },
  ]);
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
// ── 確認 / 取消(提醒按鈕 + LINE 查詢內的取消)──────────────
async function handleStatusPostback(
  replyToken: string,
  action: "confirm" | "cancel",
  id: string | null,
  svc: SupabaseClient,
): Promise<void> {
  if (!id) {
    await safeReply(replyToken, "無法辨識的操作");
    return;
  }
  const { data: appt } = await svc
    .from("appointments")
    .select("id, status, clinic_id")
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID)
    .maybeSingle();

  if (!appt) {
    await safeReply(replyToken, "查無此預約");
    return;
  }
  if (appt.status === "cancelled" || appt.status === "done" || appt.status === "no_show") {
    await safeReply(replyToken, "此預約已無法變更,請洽櫃檯。");
    return;
  }

  const newStatus = action === "confirm" ? "confirmed" : "cancelled";
  const { error } = await svc
    .from("appointments")
    .update({ status: newStatus })
    .eq("id", id)
    .eq("clinic_id", CLINIC_ID);
  if (error) {
    await safeReply(replyToken, "處理失敗,請稍後再試或洽櫃檯。");
    return;
  }
  await safeReply(
    replyToken,
    action === "confirm" ? "已收到您的確認,期待為您服務。" : "已為您取消此預約。",
  );
}

async function safeReply(replyToken: string, text: string): Promise<void> {
  const msg: LineMessage = { type: "text", text };
  try {
    await replyMessages(replyToken, [msg]);
  } catch {
    // 回覆失敗不影響 webhook 回 200
  }
}
