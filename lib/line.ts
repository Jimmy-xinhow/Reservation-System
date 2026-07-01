import crypto from "node:crypto";

const LINE_API = "https://api.line.me/v2/bot";
const LINE_VERIFY = "https://api.line.me/oauth2/v2.1/verify";

function accessToken(): string {
  const t = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");
  return t;
}

/** LINE 任意 message 物件(Flex / text 等),不細究內部結構。 */
export type LineMessage = Record<string, unknown>;

export interface VerifiedLineProfile {
  /** line_user_id */
  sub: string;
  name?: string;
  picture?: string;
}

/**
 * 後端驗證 LIFF ID token。
 * 前端送來的 line_user_id 不可信;必須用此函式向 LINE 驗證後才採用回傳的 sub。
 */
export async function verifyLiffIdToken(idToken: string): Promise<VerifiedLineProfile> {
  const clientId = process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId) throw new Error("缺少 LINE_LOGIN_CHANNEL_ID");
  if (!idToken) throw new Error("缺少 id_token");

  const res = await fetch(LINE_VERIFY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
  });
  if (!res.ok) {
    throw new Error("LINE ID token 驗證失敗");
  }
  const data = (await res.json()) as {
    sub?: string;
    name?: string;
    picture?: string;
  };
  if (!data.sub) throw new Error("LINE ID token 無 sub");
  return { sub: data.sub, name: data.name, picture: data.picture };
}

/**
 * 驗 webhook 的 x-line-signature(HMAC-SHA256 / LINE_CHANNEL_SECRET,Base64)。
 * @param rawBody 必須是「未經 parse」的原始 request body 字串。
 */
export function verifyLineSignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.LINE_CHANNEL_SECRET;
  if (!secret || !signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("base64");
  const a = Buffer.from(expected);
  const b = Buffer.from(signature);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export interface LineBotInfo {
  userId: string;
  basicId?: string;
  displayName?: string;
  pictureUrl?: string;
  chatMode?: string;
}

/** 取得官方帳號資訊(可用來驗證 access token 是否有效)。 */
export async function getBotInfo(): Promise<LineBotInfo> {
  const res = await fetch(`${LINE_API}/info`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) throw new Error(`LINE 連線失敗 (${res.status})`);
  return (await res.json()) as LineBotInfo;
}

/** 取得推播額度。 */
export async function getQuota(): Promise<{ type: string; value?: number }> {
  const res = await fetch(`${LINE_API}/message/quota`, {
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) throw new Error(`LINE 額度查詢失敗 (${res.status})`);
  return (await res.json()) as { type: string; value?: number };
}

// ── Rich Menu(圖文選單)──────────────────────────────────
const LINE_DATA_API = "https://api-data.line.me/v2/bot";

export interface RichMenuArea {
  bounds: { x: number; y: number; width: number; height: number };
  action: Record<string, unknown>;
}

/** 建立 rich menu 物件,回傳 richMenuId。 */
export async function createRichMenu(body: {
  size: { width: number; height: number };
  selected: boolean;
  name: string;
  chatBarText: string;
  areas: RichMenuArea[];
}): Promise<string> {
  const res = await fetch(`${LINE_API}/richmenu`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken()}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`建立圖文選單失敗 (${res.status}): ${await res.text().catch(() => "")}`);
  const data = (await res.json()) as { richMenuId: string };
  return data.richMenuId;
}

/** 上傳 rich menu 圖片(jpeg/png,尺寸須完全符合)。 */
export async function uploadRichMenuImage(
  richMenuId: string,
  bytes: ArrayBuffer,
  contentType: string,
): Promise<void> {
  const res = await fetch(`${LINE_DATA_API}/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": contentType, Authorization: `Bearer ${accessToken()}` },
    body: bytes,
  });
  if (!res.ok) throw new Error(`上傳圖片失敗 (${res.status}): ${await res.text().catch(() => "")}`);
}

/** 設為所有使用者的預設 rich menu。 */
export async function setDefaultRichMenu(richMenuId: string): Promise<void> {
  const res = await fetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken()}` },
  });
  if (!res.ok) throw new Error(`設定預設選單失敗 (${res.status}): ${await res.text().catch(() => "")}`);
}

/** 刪除 rich menu。 */
export async function deleteRichMenu(richMenuId: string): Promise<void> {
  await fetch(`${LINE_API}/richmenu/${richMenuId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken()}` },
  }).catch(() => {});
}

/** 取消所有使用者的預設 rich menu。 */
export async function clearDefaultRichMenu(): Promise<void> {
  await fetch(`${LINE_API}/user/all/richmenu`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken()}` },
  }).catch(() => {});
}

/** 主動推播一則或多則訊息給某 line_user_id。 */
export async function pushMessages(to: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(`${LINE_API}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE push 失敗 (${res.status}): ${detail}`);
  }
}

/** 以 replyToken 回覆訊息(webhook 用)。 */
export async function replyMessages(replyToken: string, messages: LineMessage[]): Promise<void> {
  const res = await fetch(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken()}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`LINE reply 失敗 (${res.status}): ${detail}`);
  }
}
