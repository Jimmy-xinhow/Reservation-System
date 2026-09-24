import "server-only";
import { providerFetch, providerOperation, providerJson } from "@/lib/provider-boundary";

import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase";

const LINE_API = "https://api.line.me/v2/bot";
const LINE_VERIFY = "https://api.line.me/oauth2/v2.1/verify";

function accessToken(override?: string): string {
  const t = override || process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!t) throw new Error("缺少 LINE_CHANNEL_ACCESS_TOKEN");
  return t;
}

/** LINE 任意 message 物件(Flex / text 等),不細究內部結構。 */
function credentialMap(name: "LINE_CHANNEL_ACCESS_TOKENS_JSON" | "LINE_CHANNEL_SECRETS_JSON"): Record<string, string> {
  const raw = process.env[name];
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
  } catch {
    return {};
  }
}

function credentialMapsConfigured(): boolean {
  return Boolean(process.env.LINE_CHANNEL_ACCESS_TOKENS_JSON?.trim() || process.env.LINE_CHANNEL_SECRETS_JSON?.trim());
}

export interface LineCredentials {
  accessToken?: string;
  channelSecret?: string;
  source: "vault" | "environment";
}

export interface LineCredentialStatus {
  configured: boolean;
  source: "vault" | "environment" | null;
}

/**
 * 品牌憑證以 Supabase Vault 為主；尚未完成後台設定的品牌才使用既有部署變數。
 * 此函式僅供 server 使用，禁止把回傳值傳進 Client Component。
 */
export async function lineCredentialsForDestination(
  destination?: string,
  service: SupabaseClient = createServiceClient(),
): Promise<LineCredentials> {
  if (destination) {
    const { data, error } = await providerOperation(() => service.rpc("get_clinic_line_secrets_by_destination", {
      p_destination: destination,
    }), "品牌憑證讀取失敗");
    if (error) throw new Error(`LINE 憑證讀取失敗`);
    const row = (Array.isArray(data) ? data[0] : null) as
      | { access_token?: unknown; channel_secret?: unknown }
      | null;
    if (typeof row?.access_token === "string" && typeof row?.channel_secret === "string") {
      return {
        accessToken: row.access_token,
        channelSecret: row.channel_secret,
        source: "vault",
      };
    }
  }

  if (credentialMapsConfigured()) {
    if (!destination) throw new Error("LINE destination 必須對應品牌憑證");
    return {
      accessToken: credentialMap("LINE_CHANNEL_ACCESS_TOKENS_JSON")[destination],
      channelSecret: credentialMap("LINE_CHANNEL_SECRETS_JSON")[destination],
      source: "environment",
    };
  }
  return {
    accessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN,
    channelSecret: process.env.LINE_CHANNEL_SECRET,
    source: "environment",
  };
}

export async function lineAccessTokenForDestination(destination?: string): Promise<string> {
  const credentials = await lineCredentialsForDestination(destination);
  if (!credentials.accessToken) throw new Error("此 LINE 品牌尚未設定 access token");
  return accessToken(credentials.accessToken);
}

export async function lineSecretForDestination(destination?: string): Promise<string | undefined> {
  const credentials = await lineCredentialsForDestination(destination);
  return credentials.channelSecret;
}

/** 僅讀取是否已設定，不解密也不回傳任何秘密值。 */
export async function getLineCredentialStatus(
  service: SupabaseClient,
  clinicId: string,
  destination?: string,
): Promise<LineCredentialStatus> {
  const { data, error } = await providerOperation(() => service
    .from("clinic_line_secret_refs")
    .select("access_token_secret_id, channel_secret_secret_id")
    .eq("clinic_id", clinicId)
    .maybeSingle(), "品牌設定狀態讀取失敗");
  if (error) throw new Error(`LINE 設定狀態讀取失敗`);
  if (data?.access_token_secret_id && data?.channel_secret_secret_id) {
    return { configured: true, source: "vault" };
  }

  const environment = credentialMapsConfigured()
    ? Boolean(
        destination &&
          credentialMap("LINE_CHANNEL_ACCESS_TOKENS_JSON")[destination] &&
          credentialMap("LINE_CHANNEL_SECRETS_JSON")[destination],
      )
    : Boolean(process.env.LINE_CHANNEL_ACCESS_TOKEN && process.env.LINE_CHANNEL_SECRET);
  return { configured: environment, source: environment ? "environment" : null };
}

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
export async function verifyLiffIdToken(idToken: string, clientIdOverride?: string): Promise<VerifiedLineProfile> {
  const clientId = clientIdOverride?.trim() || process.env.LINE_LOGIN_CHANNEL_ID;
  if (!clientId) throw new Error("缺少 LINE_LOGIN_CHANNEL_ID");
  if (!idToken) throw new Error("缺少 id_token");

  const res = await providerFetch(LINE_VERIFY, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ id_token: idToken, client_id: clientId }),
  });
  if (!res.ok) {
    throw new Error(`LINE ID token 驗證失敗 (${res.status})`);
  }
  const data = (await providerJson(res)) as {
    sub?: string;
    name?: string;
    picture?: string;
  };
  if (!data || typeof data.sub !== "string" || !data.sub) throw new Error("LINE ID token 無 sub");
  return { sub: data.sub, name: data.name, picture: data.picture };
}

/**
 * 驗 webhook 的 x-line-signature(HMAC-SHA256 / LINE_CHANNEL_SECRET,Base64)。
 * @param rawBody 必須是「未經 parse」的原始 request body 字串。
 */
export function verifyLineSignature(rawBody: string, signature: string | null, secretOverride?: string): boolean {
  const secret = secretOverride === undefined ? process.env.LINE_CHANNEL_SECRET : secretOverride;
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
export async function getBotInfo(accessTokenOverride?: string): Promise<LineBotInfo> {
  const res = await providerFetch(`${LINE_API}/info`, {
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok) throw new Error(`LINE 連線失敗 (${res.status})`);
  return (await providerJson(res)) as LineBotInfo;
}

export interface LineWebhookEndpointInfo {
  endpoint: string;
  active: boolean;
}

/** 讀取 Messaging API channel 目前的 webhook URL 與啟用狀態。 */
export async function getWebhookEndpointInfo(accessTokenOverride?: string): Promise<LineWebhookEndpointInfo> {
  const res = await providerFetch(`${LINE_API}/channel/webhook/endpoint`, {
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok) throw new Error(`LINE Webhook 設定取得失敗 (${res.status})`);
  const data = (await providerJson(res)) as Partial<LineWebhookEndpointInfo>;
  if (!data || typeof data.endpoint !== "string" || typeof data.active !== "boolean") {
    throw new Error("LINE Webhook 回應格式不正確");
  }
  return { endpoint: data.endpoint, active: data.active };
}

/** 取得推播額度。 */
export async function getQuota(accessTokenOverride?: string): Promise<{ type: string; value?: number }> {
  const res = await providerFetch(`${LINE_API}/message/quota`, {
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok) throw new Error(`LINE 額度查詢失敗 (${res.status})`);
  return (await providerJson(res)) as { type: string; value?: number };
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
}, accessTokenOverride?: string): Promise<string> {
  const res = await providerFetch(`${LINE_API}/richmenu`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`建立圖文選單失敗 (${res.status})`);
  const data = (await providerJson(res)) as { richMenuId: string };
  if (!data || typeof data.richMenuId !== "string" || !data.richMenuId) throw new Error("LINE 未回傳圖文選單 ID");
  return data.richMenuId;
}

/** 上傳 rich menu 圖片(jpeg/png,尺寸須完全符合)。 */
export async function uploadRichMenuImage(
  richMenuId: string,
  bytes: ArrayBuffer,
  contentType: string,
  accessTokenOverride?: string,
): Promise<void> {
  const res = await providerFetch(`${LINE_DATA_API}/richmenu/${richMenuId}/content`, {
    method: "POST",
    headers: { "Content-Type": contentType, Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
    body: bytes,
  });
  if (!res.ok) throw new Error(`上傳圖片失敗 (${res.status})`);
}

/** 取得已上傳的 rich menu 圖片內容(供後台預覽)。 */
export async function getRichMenuImage(
  richMenuId: string,
  accessTokenOverride?: string,
): Promise<{ bytes: ArrayBuffer; contentType: string } | null> {
  const res = await providerFetch(`${LINE_DATA_API}/richmenu/${richMenuId}/content`, {
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok) return null;
  const contentType = res.headers.get("content-type") || "image/jpeg";
  return { bytes: await providerOperation(() => res.arrayBuffer(), "LINE 圖片讀取失敗"), contentType };
}

/** 設為所有使用者的預設 rich menu。 */
export async function setDefaultRichMenu(richMenuId: string, accessTokenOverride?: string): Promise<void> {
  const res = await providerFetch(`${LINE_API}/user/all/richmenu/${richMenuId}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok) throw new Error(`設定預設選單失敗 (${res.status})`);
}

/** 刪除 rich menu。 */
export async function deleteRichMenu(richMenuId: string, accessTokenOverride?: string): Promise<void> {
  const res = await providerFetch(`${LINE_API}/richmenu/${richMenuId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`刪除 Rich Menu 失敗 (${res.status})`);
}

/** 取消所有使用者的預設 rich menu。 */
export async function clearDefaultRichMenu(accessTokenOverride?: string): Promise<void> {
  const res = await providerFetch(`${LINE_API}/user/all/richmenu`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`取消預設 Rich Menu 失敗 (${res.status})`);
}

export interface RichMenuAliasInfo {
  richMenuAliasId: string;
  richMenuId: string;
}

export async function getRichMenuAlias(aliasId: string, accessTokenOverride?: string): Promise<RichMenuAliasInfo | null> {
  const res = await providerFetch(`${LINE_API}/richmenu/alias/${encodeURIComponent(aliasId)}`, {
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`讀取 Rich Menu Alias 失敗 (${res.status})`);
  return (await providerJson(res)) as RichMenuAliasInfo;
}

export async function createRichMenuAlias(aliasId: string, richMenuId: string, accessTokenOverride?: string): Promise<void> {
  const res = await providerFetch(`${LINE_API}/richmenu/alias`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });
  if (!res.ok) throw new Error(`建立 Rich Menu Alias 失敗 (${res.status})`);
}

export async function updateRichMenuAlias(aliasId: string, richMenuId: string, accessTokenOverride?: string): Promise<void> {
  const res = await providerFetch(`${LINE_API}/richmenu/alias/${encodeURIComponent(aliasId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
    body: JSON.stringify({ richMenuId }),
  });
  if (!res.ok) throw new Error(`更新 Rich Menu Alias 失敗 (${res.status})`);
}

export async function deleteRichMenuAlias(aliasId: string, accessTokenOverride?: string): Promise<void> {
  const res = await providerFetch(`${LINE_API}/richmenu/alias/${encodeURIComponent(aliasId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok && res.status !== 404) throw new Error(`刪除 Rich Menu Alias 失敗 (${res.status})`);
}

/** 取得 LINE 官方帳號本月已使用訊息數；LINE 表示此數值為近似值。 */
export async function getQuotaConsumption(accessTokenOverride?: string): Promise<number> {
  const res = await providerFetch(`${LINE_API}/message/quota/consumption`, {
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok) throw new Error(`LINE 已用訊息查詢失敗 (${res.status})`);
  const data = (await providerJson(res)) as { totalUsage?: unknown };
  if (!Number.isSafeInteger(data?.totalUsage) || Number(data.totalUsage) < 0) {
    throw new Error("LINE 已用訊息回應格式不正確");
  }
  return Number(data.totalUsage);
}

export interface LineUserProfile {
  userId: string;
  displayName: string;
  pictureUrl?: string;
  statusMessage?: string;
  language?: string;
}

/** 以品牌 Messaging API token 取得已加好友使用者的 LINE 公開個人資料。 */
export async function getLineUserProfile(userId: string, accessTokenOverride?: string): Promise<LineUserProfile> {
  const res = await providerFetch(`${LINE_API}/profile/${encodeURIComponent(userId)}`, {
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok) throw new Error(`LINE 使用者資料讀取失敗 (${res.status})`);
  const data = (await providerJson(res)) as Partial<LineUserProfile>;
  if (!data || typeof data.userId !== "string" || typeof data.displayName !== "string") {
    throw new Error("LINE 使用者資料格式不正確");
  }
  return data as LineUserProfile;
}

/** 對單一使用者套用指定 Rich Menu；會員／員工選單不得改成全帳號預設。 */
export async function linkRichMenuToUser(
  userId: string,
  richMenuId: string,
  accessTokenOverride?: string,
): Promise<void> {
  const res = await providerFetch(`${LINE_API}/user/${encodeURIComponent(userId)}/richmenu/${encodeURIComponent(richMenuId)}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok) throw new Error(`套用個人 Rich Menu 失敗 (${res.status})`);
}

/** 移除使用者個人 Rich Menu，讓 LINE 自動回到品牌預設選單。 */
export async function unlinkRichMenuFromUser(userId: string, accessTokenOverride?: string): Promise<void> {
  const res = await providerFetch(`${LINE_API}/user/${encodeURIComponent(userId)}/richmenu`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`移除個人 Rich Menu 失敗 (${res.status})`);
  }
}

/** 取得官方 Account Linking 一次性 link token（LINE 有效期 10 分鐘）。 */
export async function issueLineAccountLinkToken(userId: string, accessTokenOverride?: string): Promise<string> {
  const res = await providerFetch(`${LINE_API}/user/${encodeURIComponent(userId)}/linkToken`, {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
  });
  if (!res.ok) throw new Error(`取得 LINE 綁定憑證失敗 (${res.status})`);
  const data = (await providerJson(res)) as { linkToken?: unknown };
  if (!data || typeof data.linkToken !== "string" || !data.linkToken) throw new Error("LINE 未回傳綁定憑證");
  return data.linkToken;
}

export interface RichMenuInsightSummary {
  richMenuId: string;
  metricsFrom?: string;
  metricsTo?: string;
  impression?: { metrics: { count: number; uniqueUsers: number } };
  clicks?: Array<{
    bounds: { x: number; y: number; width: number; height: number };
    metrics: { count: number; uniqueUsers: number };
  }>;
}

export async function getRichMenuInsightSummary(
  richMenuId: string,
  from: string,
  to: string,
  accessTokenOverride?: string,
): Promise<RichMenuInsightSummary> {
  if (!/^\d{8}$/.test(from) || !/^\d{8}$/.test(to) || from > to) throw new Error("Rich Menu Insights 日期格式錯誤");
  const query = new URLSearchParams({ from, to });
  const res = await providerFetch(`${LINE_API}/insight/richmenu/${encodeURIComponent(richMenuId)}/summary?${query.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken(accessTokenOverride)}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`讀取 Rich Menu Insights 失敗 (${res.status})`);
  return (await providerJson(res)) as RichMenuInsightSummary;
}

/** 主動推播一則或多則訊息給某 line_user_id。 */
export async function pushMessages(to: string, messages: LineMessage[], accessTokenOverride?: string): Promise<void> {
  const res = await providerFetch(`${LINE_API}/message/push`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken(accessTokenOverride)}`,
    },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) {
    throw new Error(`LINE push 失敗 (${res.status})`);
  }
}

/** 以 replyToken 回覆訊息(webhook 用)。 */
export async function replyMessages(replyToken: string, messages: LineMessage[], accessTokenOverride?: string): Promise<void> {
  const res = await providerFetch(`${LINE_API}/message/reply`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken(accessTokenOverride)}`,
    },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!res.ok) {
    throw new Error(`LINE reply 失敗 (${res.status})`);
  }
}
