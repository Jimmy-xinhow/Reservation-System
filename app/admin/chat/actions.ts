"use server";

import { requireMember } from "@/lib/admin";
import { CLINIC_ID } from "@/lib/supabase";

export interface ChatThread {
  lineUserId: string;
  name: string | null;
  lastBody: string;
  lastAt: string;
  lastSender: "patient" | "staff";
  unread: number;
}
export interface ChatMsg {
  id: string;
  sender: "patient" | "staff";
  body: string;
  created_at: string;
}

/** 對話串列表:依 line_user_id 聚合最近訊息、未讀數,並帶入病患姓名。 */
export async function listChatThreads(): Promise<ChatThread[]> {
  const { supabase } = await requireMember();
  const { data: rows } = await supabase
    .from("chat_messages")
    .select("line_user_id, sender, body, read_by_staff, created_at")
    .eq("clinic_id", CLINIC_ID)
    .order("created_at", { ascending: false })
    .limit(800);
  const msgs = rows ?? [];

  const map = new Map<string, ChatThread>();
  for (const m of msgs) {
    const uid = m.line_user_id as string;
    let t = map.get(uid);
    if (!t) {
      // rows 由新到舊,第一次遇到即為最後一則
      t = {
        lineUserId: uid,
        name: null,
        lastBody: m.body as string,
        lastAt: m.created_at as string,
        lastSender: m.sender as "patient" | "staff",
        unread: 0,
      };
      map.set(uid, t);
    }
    if (m.sender === "patient" && m.read_by_staff === false) t.unread += 1;
  }

  const uids = [...map.keys()];
  if (uids.length > 0) {
    const { data: pats } = await supabase
      .from("patients")
      .select("line_user_id, name")
      .eq("clinic_id", CLINIC_ID)
      .in("line_user_id", uids);
    for (const p of pats ?? []) {
      const t = map.get(p.line_user_id as string);
      if (t && !t.name) t.name = p.name as string;
    }
  }

  return [...map.values()].sort((a, b) => (a.lastAt < b.lastAt ? 1 : -1));
}

/** 讀取某對話串訊息(由舊到新),並把病患未讀訊息標記為櫃檯已讀。 */
export async function getChatMessages(lineUserId: string): Promise<ChatMsg[]> {
  const { supabase } = await requireMember();
  if (!lineUserId) return [];
  const { data } = await supabase
    .from("chat_messages")
    .select("id, sender, body, created_at")
    .eq("clinic_id", CLINIC_ID)
    .eq("line_user_id", lineUserId)
    .order("created_at", { ascending: true })
    .limit(500);

  await supabase
    .from("chat_messages")
    .update({ read_by_staff: true })
    .eq("clinic_id", CLINIC_ID)
    .eq("line_user_id", lineUserId)
    .eq("sender", "patient")
    .eq("read_by_staff", false);

  return (data ?? []) as ChatMsg[];
}

/** 櫃檯回覆一則。 */
export async function sendStaffChat(lineUserId: string, body: string): Promise<void> {
  const { supabase } = await requireMember();
  const text = body.trim();
  if (!lineUserId) throw new Error("缺少對話對象");
  if (!text) throw new Error("請輸入訊息");
  if (text.length > 2000) throw new Error("訊息過長");
  const { error } = await supabase.from("chat_messages").insert({
    clinic_id: CLINIC_ID,
    line_user_id: lineUserId,
    sender: "staff",
    body: text,
    read_by_staff: true,
  });
  if (error) throw new Error(error.message);
}
