// LINE 訊息素材資料模型 + 轉 Flex/文字 的建構器。client(編輯器)與 server(webhook)共用。

export type MsgKind = "text" | "card" | "carousel";
export type BtnAction = "booking" | "query" | "progress" | "uri" | "text";

export interface MsgButton {
  label: string;
  action: BtnAction;
  value?: string; // uri / text 用
}
export interface MsgCard {
  imageUrl?: string;
  title?: string;
  text?: string;
  linkUrl?: string; // 設了則「整張卡片(圖+內文)點擊」會開啟此網址
  buttons: MsgButton[];
}
export interface MsgData {
  // text
  text?: string;
  // card(單張)
  card?: MsgCard;
  // carousel(多頁)
  cards?: MsgCard[];
}

export const BTN_ACTION_OPTIONS: { value: BtnAction; label: string }[] = [
  { value: "booking", label: "開啟預約" },
  { value: "query", label: "查詢預約" },
  { value: "progress", label: "看診進度" },
  { value: "uri", label: "自訂連結" },
  { value: "text", label: "送出文字" },
];

interface BuildCtx {
  liffUrl: string | null;
  baseUrl: string;
}

type Flex = Record<string, unknown>;

function actionObj(b: MsgButton, ctx: BuildCtx): Flex | null {
  const lbl = (b.label ?? "").trim();
  if (!lbl) return null; // Flex 按鈕的文字即 label,空白則不建立此按鈕
  // 內建動作用 uri/postback,點了直接生效,不需另設關鍵字規則
  switch (b.action) {
    case "booking":
      return ctx.liffUrl
        ? { type: "uri", label: lbl, uri: ctx.liffUrl }
        : { type: "postback", label: lbl, data: "action=booking", displayText: "預約" };
    case "query":
      return { type: "postback", label: lbl, data: "action=my", displayText: "查詢預約" };
    case "progress":
      return { type: "postback", label: lbl, data: "action=progress", displayText: "看診進度" };
    case "uri":
      return b.value ? { type: "uri", label: lbl, uri: b.value } : null;
    case "text":
      return b.value ? { type: "message", label: lbl, text: b.value } : null;
    default:
      return null;
  }
}

function cardBubble(c: MsgCard, ctx: BuildCtx): Flex {
  const bubble: Flex = { type: "bubble", size: "kilo" };
  const tapAction = (c.linkUrl ?? "").trim()
    ? { type: "uri", uri: (c.linkUrl ?? "").trim() }
    : null;
  if (c.imageUrl) {
    bubble.hero = {
      type: "image",
      url: c.imageUrl,
      size: "full",
      aspectRatio: "20:13",
      aspectMode: "cover",
      ...(tapAction ? { action: tapAction } : {}),
    };
  }
  const body: Flex[] = [];
  if (c.title) body.push({ type: "text", text: c.title, weight: "bold", size: "md", wrap: true });
  if (c.text) body.push({ type: "text", text: c.text, size: "sm", color: "#555555", wrap: true, margin: "sm" });
  if (body.length) {
    bubble.body = {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: body,
      ...(tapAction ? { action: tapAction } : {}),
    };
  }
  const btns = (c.buttons ?? [])
    .map((b) => actionObj(b, ctx))
    .filter(Boolean)
    .map((action) => ({ type: "button", style: "primary", color: "#2563eb", height: "sm", action }));
  if (btns.length) {
    bubble.footer = { type: "box", layout: "vertical", spacing: "sm", contents: btns };
  }
  return bubble;
}

/** 依訊息素材建構 LINE 訊息物件;無法建構回 null。 */
export function buildLineMessage(kind: MsgKind, data: MsgData, ctx: BuildCtx): Flex | null {
  if (kind === "text") {
    const t = (data.text ?? "").trim();
    return t ? { type: "text", text: t } : null;
  }
  if (kind === "card") {
    if (!data.card) return null;
    const bubble = cardBubble(data.card, ctx);
    if (!bubble.hero && !bubble.body && !bubble.footer) return null; // 空卡不送
    return { type: "flex", altText: data.card.title || "訊息", contents: bubble };
  }
  if (kind === "carousel") {
    const cards = (data.cards ?? []).filter((c) => c.imageUrl || c.title || c.text);
    if (cards.length === 0) return null;
    return {
      type: "flex",
      altText: cards[0]?.title || "訊息",
      contents: { type: "carousel", contents: cards.slice(0, 12).map((c) => cardBubble(c, ctx)) },
    };
  }
  return null;
}
