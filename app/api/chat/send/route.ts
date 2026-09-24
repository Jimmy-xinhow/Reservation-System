import { deliveryError } from "@/lib/delivery-error";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { ok, fail } from "@/lib/http";
import { verifyClinicLiffIdToken } from "@/lib/line-channel";
import { isClinicOpenNow } from "@/lib/queue";
import { checkRateLimit } from "@/lib/rate-limit";
import { resolvePublicClinicId } from "@/lib/public-brand";
import { recordCrmInteraction } from "@/lib/crm-interactions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 非服務時間的自動回覆
const OFFHOURS_REPLY = "目前非服務時間,我們將在服務時間盡快回覆您";

/**
 * POST /api/chat/send
 * body: { idToken, body }
 * 病患在系統客服頁送出一句話。以驗證後的 line_user_id 存檔(sender=patient)。
 */
export async function POST(req: NextRequest) {
  try {
    const rate = await checkRateLimit(req, "chat:send", 20);
    if (!rate.allowed) {
      const response = fail("請稍後再試", rate.unavailable ? 503 : 429);
      response.headers.set("Retry-After", String(rate.retryAfterSeconds));
      return response;
    }
    const payload = (await req.json().catch(() => null)) as {
      idToken?: string;
      body?: string;
      messageId?: string;
    } | null;
    if (!payload) return fail("請求格式錯誤");

    const body = (payload.body ?? "").trim();
    if (!body) return fail("請輸入訊息");
    if (body.length > 2000) return fail("訊息過長");
    if (!payload.idToken) return fail("缺少 LINE 身分驗證");
    if (payload.messageId !== undefined && (typeof payload.messageId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.messageId))) {
      return fail("訊息識別碼無效");
    }
    const messageId = payload.messageId ?? randomUUID();

    const svc = createServiceClient();
    const clinicId = await resolvePublicClinicId(req, svc);
    if (!clinicId) return fail("缺少品牌設定", 500);

    let lineUserId: string;
    try {
      const profile = await verifyClinicLiffIdToken(svc, clinicId, payload.idToken);
      lineUserId = profile.sub;
    } catch {
      return fail("LINE 身分驗證失敗，請重新開啟頁面。", 401);
    }

    // 黑名單:被封鎖者訊息一律靜默丟棄(不存、不回,對方無從得知被封,避免激怒)
    const { data: blk, error: blockError } = await svc
      .from("chat_blocks")
      .select("line_user_id")
      .eq("clinic_id", clinicId)
      .eq("line_user_id", lineUserId)
      .maybeSingle();
    if (blockError) return fail(blockError.message, 500);
    if (blk) return ok({ sent: true });

    // A retry key is scoped to the verified customer and brand. Never overwrite a row.
    const findMessage = () => svc.from("chat_messages").select("body, sender")
      .eq("id", messageId).eq("clinic_id", clinicId).eq("line_user_id", lineUserId).maybeSingle();
    if (payload.messageId) {
      const { data: existing, error: existingError } = await findMessage();
      if (existingError) return fail(existingError.message, 500);
      if (existing) {
        if (existing.sender !== "patient" || existing.body !== body) return fail("此訊息識別碼已使用，請重新開啟頁面。", 409);
        return ok({ sent: true });
      }
    }

    // 非看診時間:先看最後一則,避免連續訊息重複貼同一句自動回覆
    const open = await isClinicOpenNow(svc, clinicId);
    let lastBody: string | null = null;
    if (!open) {
      const { data: last, error: lastError } = await svc
        .from("chat_messages")
        .select("body")
        .eq("clinic_id", clinicId)
        .eq("line_user_id", lineUserId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (lastError) return fail(lastError.message, 500);
      lastBody = (last?.body as string) ?? null;
    }

    try {
      const { error } = await svc.from("chat_messages").insert({
        id: messageId,
        clinic_id: clinicId,
        line_user_id: lineUserId,
        sender: "patient",
        body,
      });
      if (error) throw error;
    } catch (error) {
      // The insert may have committed before the response was lost. A PK conflict
      // may also be another request with the same key; reconcile only our own row.
      console.error("Customer chat write unresolved", { category: deliveryError(error) });
      try {
        const { data: existing, error: readError } = await findMessage();
        if (!readError && existing?.sender === "patient" && existing.body === body) return ok({ sent: true });
      } catch { /* An unavailable read cannot prove the message was not stored. */ }
      return ok({ sent: false, delivery: "unconfirmed" });
    }
    try {
      const { data: patient, error: patientError } = await svc
        .from("patients")
        .select("id")
        .eq("clinic_id", clinicId)
        .eq("line_user_id", lineUserId)
        .eq("active", true)
        .order("created_at")
        .limit(1)
        .maybeSingle();
      if (patientError) throw patientError;
      if (patient?.id) {
        await recordCrmInteraction(svc, {
          clinicId,
          patientId: patient.id as string,
          kind: "message",
          channel: "line",
          title: "顧客客服訊息",
          body,
        });
      }
    } catch (error) {
      console.error("CRM chat interaction failed", { category: deliveryError(error) });
    }

    // 非看診時間且上一則不是同一句自動回覆 → 自動回覆一次(以 staff 身分,病患看得到)
    if (!open && lastBody !== OFFHOURS_REPLY) {
      try {
        const { error: replyError } = await svc.from("chat_messages").insert({
          clinic_id: clinicId,
          line_user_id: lineUserId,
          sender: "staff",
          body: OFFHOURS_REPLY,
          read_by_staff: true, // 自動回覆不算櫃檯未讀
        });
        if (replyError) throw replyError;
      } catch (error) {
        console.error("Chat automatic reply failed", { category: deliveryError(error) });
      }
    }
    return ok({ sent: true });
  } catch (e) {
    return fail(e instanceof Error ? e.message : "送出失敗", 500);
  }
}
