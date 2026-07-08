import { NextRequest } from "next/server";
import { requireMember } from "@/lib/admin";
import { CLINIC_ID } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";
import {
  buildThreads,
  getThreadMessages,
  unreadCount,
  insertStaffMessage,
} from "@/lib/chatQueries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 後台客服的收發改走 route handler(不像 Server Action 會序列化/重算整頁),避免送出卡頓。
// GET  ?type=threads | ?type=messages&u=<lineUserId> | ?type=unread
// POST { lineUserId, body }

export async function GET(req: NextRequest) {
  let supabase;
  try {
    ({ supabase } = await requireMember());
  } catch {
    return fail("未授權", 401);
  }
  const type = req.nextUrl.searchParams.get("type");
  try {
    if (type === "unread") return ok({ count: await unreadCount(supabase, CLINIC_ID) });
    if (type === "messages") {
      const u = req.nextUrl.searchParams.get("u") ?? "";
      return ok({ messages: await getThreadMessages(supabase, CLINIC_ID, u) });
    }
    return ok({ threads: await buildThreads(supabase, CLINIC_ID) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "讀取失敗", 500);
  }
}

export async function POST(req: NextRequest) {
  let supabase;
  try {
    ({ supabase } = await requireMember());
  } catch {
    return fail("未授權", 401);
  }
  const payload = (await req.json().catch(() => null)) as {
    lineUserId?: string;
    body?: string;
  } | null;
  if (!payload?.lineUserId) return fail("缺少對話對象");
  try {
    await insertStaffMessage(supabase, CLINIC_ID, payload.lineUserId, payload.body ?? "");
    return ok({ sent: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "送出失敗", 500);
  }
}
