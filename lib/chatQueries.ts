import "server-only";
import { adminErrorMessage, adminQuery } from "@/lib/admin-query";
import { deliveryError } from "@/lib/delivery-error";
import { fetchAllSupabasePages } from "@/lib/supabase-pagination";
import type { SupabaseClient } from "@supabase/supabase-js";

export interface ChatThread {
  lineUserId: string;
  name: string | null;
  lastBody: string;
  lastAt: string;
  lastSender: "patient" | "staff";
  unread: number;
  blocked: boolean;
}
export interface ChatMsg {
  id: string;
  sender: "patient" | "staff";
  body: string;
  created_at: string;
}

export interface ChatMessagePage {
  messages: ChatMsg[];
  hasMore: boolean;
  nextCursor: string | null;
}

interface ChatThreadRow {
  line_user_id: string;
  name: string | null;
  last_body: string;
  last_at: string;
  last_sender: "patient" | "staff";
  unread: number;
  blocked: boolean;
}

const CHAT_PAGE_SIZE = 500;

function decodeChatCursor(cursor: string): { createdAt: string; id: string } {
  if (cursor.length > 160 || !/^[A-Za-z0-9_-]+$/.test(cursor)) throw new Error("訊息游標無效");
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (!value || typeof value !== "object") throw new Error();
    const row = value as Record<string, unknown>;
    const createdAt = row.createdAt;
    const id = row.id;
    if (typeof createdAt !== "string" || typeof id !== "string"
      || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|[+-]\d\d:\d\d)$/.test(createdAt)
      || Number.isNaN(Date.parse(createdAt))
      || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) throw new Error();
    return { createdAt, id };
  } catch {
    throw new Error("訊息游標無效");
  }
}

function encodeChatCursor(row: { created_at: string; id: string }): string {
  return Buffer.from(JSON.stringify({ createdAt: row.created_at, id: row.id })).toString("base64url");
}

/** 資料庫按品牌聚合完整對話串，避免單一高量對話擠掉其他顧客。 */
export async function buildThreads(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<ChatThread[]> {
  const rows = await fetchAllSupabasePages<ChatThreadRow>((from, to) => supabase
    .rpc("list_chat_threads", { p_clinic_id: clinicId })
    .order("last_at", { ascending: false })
    .order("line_user_id")
    .range(from, to));
  return rows.map((row) => ({
    lineUserId: row.line_user_id,
    name: row.name,
    lastBody: row.last_body,
    lastAt: row.last_at,
    lastSender: row.last_sender,
    unread: Number(row.unread),
    blocked: row.blocked,
  }));
}

/** 本診所客服黑名單的 line_user_id 集合（查詢失敗時拒絕繼續）。 */
export async function getBlockedSet(
  supabase: SupabaseClient,
  clinicId: string,
): Promise<Set<string>> {
  const { data, error } = await adminQuery(supabase
    .from("chat_blocks")
    .select("line_user_id")
    .eq("clinic_id", clinicId));
  if (error) throw new Error(adminErrorMessage(error));
  return new Set((data ?? []).map((r) => r.line_user_id as string));
}

/** 封鎖 / 解除封鎖某 line_user_id。 */
export async function setChatBlock(
  supabase: SupabaseClient,
  clinicId: string,
  lineUserId: string,
  blocked: boolean,
): Promise<void> {
  if (!lineUserId) throw new Error("缺少對話對象");
  if (blocked) {
    const { error } = await adminQuery(supabase
      .from("chat_blocks")
      .upsert({ clinic_id: clinicId, line_user_id: lineUserId }, { onConflict: "clinic_id,line_user_id" }));
    if (error) throw new Error(adminErrorMessage(error));
  } else {
    const { error } = await adminQuery(supabase
      .from("chat_blocks")
      .delete()
      .eq("clinic_id", clinicId)
      .eq("line_user_id", lineUserId));
    if (error) throw new Error(adminErrorMessage(error));
  }
}

/** 讀取某對話串訊息(由舊到新),並把顧客未讀訊息標記為服務人員已讀。 */
export async function getThreadMessages(
  supabase: SupabaseClient,
  clinicId: string,
  lineUserId: string,
  before?: string | null,
): Promise<ChatMessagePage> {
  if (!lineUserId) return { messages: [], hasMore: false, nextCursor: null };
  const cursor = before ? decodeChatCursor(before) : null;
  let query = supabase
    .from("chat_messages")
    .select("id, sender, body, created_at, read_by_staff")
    .eq("clinic_id", clinicId)
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(CHAT_PAGE_SIZE + 1);
  if (cursor) query = query.or(`created_at.lt.${cursor.createdAt},and(created_at.eq.${cursor.createdAt},id.lt.${cursor.id})`);
  const { data, error } = await adminQuery(query);

  if (error) throw new Error(adminErrorMessage(error));
  const newestFirst = (data ?? []).slice(0, CHAT_PAGE_SIZE);
  const unreadIds = newestFirst.filter((row) => row.sender === "patient" && row.read_by_staff === false)
    .map((row) => row.id as string);
  for (let start = 0; start < unreadIds.length; start += 100) {
    const { error: readError } = await adminQuery(supabase
      .from("chat_messages")
      .update({ read_by_staff: true })
      .eq("clinic_id", clinicId)
      .eq("line_user_id", lineUserId)
      .eq("sender", "patient")
      .eq("read_by_staff", false)
      .in("id", unreadIds.slice(start, start + 100)));
    if (readError) throw new Error(adminErrorMessage(readError));
  }
  const oldest = newestFirst.at(-1);
  return {
    messages: newestFirst.reverse().map((row) => ({ id: row.id as string,
      sender: row.sender as "patient" | "staff", body: row.body as string,
      created_at: row.created_at as string })),
    hasMore: (data ?? []).length > CHAT_PAGE_SIZE,
    nextCursor: oldest && (data ?? []).length > CHAT_PAGE_SIZE ? encodeChatCursor(oldest) : null,
  };
}

/** 尚未被服務人員讀取的顧客訊息數。查詢失敗時不冒充零未讀。 */
export async function unreadCount(supabase: SupabaseClient, clinicId: string): Promise<number> {
  const { count, error } = await adminQuery(supabase
    .from("chat_messages")
    .select("id", { count: "exact", head: true })
    .eq("clinic_id", clinicId)
    .eq("sender", "patient")
    .eq("read_by_staff", false));
  if (error) throw new Error(adminErrorMessage(error));
  return count ?? 0;
}

/** 櫃檯回覆一則。 */
export async function insertStaffMessage(
  supabase: SupabaseClient,
  clinicId: string,
  lineUserId: string,
  body: string,
): Promise<string> {
  const text = body.trim();
  if (!lineUserId) throw new Error("缺少對話對象");
  if (!text) throw new Error("請輸入訊息");
  if (text.length > 2000) throw new Error("訊息過長");
  const { data, error } = await adminQuery(supabase.from("chat_messages").insert({
    clinic_id: clinicId,
    line_user_id: lineUserId,
    sender: "staff",
    body: text,
    read_by_staff: true,
    delivery_status: "sending",
  }).select("id").single());
  if (error) throw new Error(adminErrorMessage(error));
  return String(data.id);
}

export async function updateStaffMessageDelivery(
  supabase: SupabaseClient,
  clinicId: string,
  messageId: string,
  status: "sent" | "failed",
  errorMessage?: string,
): Promise<void> {
  const { error } = await adminQuery(supabase
    .from("chat_messages")
    .update({ delivery_status: status, delivery_error: errorMessage ? deliveryError(errorMessage) : null })
    .eq("clinic_id", clinicId)
    .eq("id", messageId)
    .eq("sender", "staff"));
  if (error) throw new Error(adminErrorMessage(error));
}
