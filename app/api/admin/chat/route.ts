import { NextRequest } from "next/server";
import { requireMember, requireOperator } from "@/lib/admin";
import { ok, fail } from "@/lib/http";
import {
  buildThreads,
  getThreadMessages,
  unreadCount,
  insertStaffMessage,
  setChatBlock,
} from "@/lib/chatQueries";
import { recordCrmInteraction } from "@/lib/crm-interactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 後台客服的收發改走 route handler(不像 Server Action 會序列化/重算整頁),避免送出卡頓。
// GET  ?type=threads | ?type=messages&u=<lineUserId> | ?type=unread
// POST { lineUserId, body }

export async function GET(req: NextRequest) {
  let member;
  try {
    member = await requireMember();
  } catch {
    return fail("未授權", 401);
  }
  const { supabase, clinicId } = member;
  const type = req.nextUrl.searchParams.get("type");
  try {
    if (member.role === "provider") {
      if (type === "unread") return ok({ count: 0 });
      if (type === "messages") return ok({ messages: [] });
      return ok({ threads: [] });
    }
    if (type === "unread") return ok({ count: await unreadCount(supabase, clinicId) });
    if (type === "messages") {
      const u = req.nextUrl.searchParams.get("u") ?? "";
      return ok({ messages: await getThreadMessages(supabase, clinicId, u) });
    }
    return ok({ threads: await buildThreads(supabase, clinicId) });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "讀取失敗", 500);
  }
}

export async function POST(req: NextRequest) {
  let supabase;
  let clinicId: string;
  let userId: string;
  try {
    const member = await requireOperator();
    supabase = member.supabase;
    clinicId = member.clinicId;
    userId = member.user.id;
  } catch {
    return fail("未授權", 401);
  }
  const payload = (await req.json().catch(() => null)) as {
    action?: "send" | "block" | "unblock";
    lineUserId?: string;
    body?: string;
  } | null;
  if (!payload?.lineUserId) return fail("缺少對話對象");
  try {
    if (payload.action === "block") {
      await setChatBlock(supabase, clinicId, payload.lineUserId, true);
      return ok({ blocked: true });
    }
    if (payload.action === "unblock") {
      await setChatBlock(supabase, clinicId, payload.lineUserId, false);
      return ok({ blocked: false });
    }
    const body = payload.body ?? "";
    await insertStaffMessage(supabase, clinicId, payload.lineUserId, body);
    const { data: patient } = await supabase
      .from("patients")
      .select("id")
      .eq("clinic_id", clinicId)
      .eq("line_user_id", payload.lineUserId)
      .eq("active", true)
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (patient?.id) {
      await recordCrmInteraction(supabase, {
        clinicId,
        patientId: patient.id as string,
        kind: "message",
        channel: "staff",
        title: "櫃檯客服回覆",
        body,
        createdBy: userId,
      });
    }
    return ok({ sent: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "操作失敗", 500);
  }
}
