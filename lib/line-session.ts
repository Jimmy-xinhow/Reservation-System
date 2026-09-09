import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type LineCustomerIntent = "booking" | "support" | "events" | "membership";

export interface LineCustomerSession {
  intent: LineCustomerIntent;
  step: string;
  context: Record<string, string>;
}

function expiresAt(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export async function claimLineWebhookEvent(
  service: SupabaseClient,
  clinicId: string,
  eventId: string | undefined,
  eventType: string,
): Promise<boolean> {
  if (!eventId?.trim()) return true;
  const { data, error } = await service.rpc("claim_line_webhook_event", {
    p_clinic_id: clinicId,
    p_event_id: eventId.trim(),
    p_event_type: eventType,
  });
  if (error) throw new Error(`LINE event 去重失敗: ${error.message}`);
  return data === true;
}

export async function finishLineWebhookEvent(
  service: SupabaseClient,
  clinicId: string,
  eventId: string | undefined,
  error?: unknown,
): Promise<void> {
  if (!eventId?.trim()) return;
  const message = error instanceof Error ? error.message.slice(0, 1000) : error ? String(error).slice(0, 1000) : null;
  const { error: updateError } = await service
    .from("line_webhook_events")
    .update({
      status: message ? "failed" : "processed",
      error: message,
      processed_at: message ? null : new Date().toISOString(),
    })
    .eq("clinic_id", clinicId)
    .eq("event_id", eventId.trim());
  if (updateError) throw new Error(`LINE event 完成狀態寫入失敗: ${updateError.message}`);
}

export async function getLineCustomerSession(
  service: SupabaseClient,
  clinicId: string,
  lineUserId: string,
): Promise<LineCustomerSession | null> {
  const { data, error } = await service
    .from("line_customer_sessions")
    .select("intent, step, context")
    .eq("clinic_id", clinicId)
    .eq("line_user_id", lineUserId)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (error) throw new Error(`LINE 操作狀態讀取失敗: ${error.message}`);
  if (!data) return null;
  const context = data.context && typeof data.context === "object" && !Array.isArray(data.context)
    ? Object.fromEntries(Object.entries(data.context).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : {};
  return { intent: data.intent as LineCustomerIntent, step: data.step as string, context };
}

export async function saveLineCustomerSession(
  service: SupabaseClient,
  clinicId: string,
  lineUserId: string,
  session: LineCustomerSession,
  ttlMinutes = 15,
): Promise<void> {
  const { error } = await service.from("line_customer_sessions").upsert(
    {
      clinic_id: clinicId,
      line_user_id: lineUserId,
      intent: session.intent,
      step: session.step,
      context: session.context,
      expires_at: expiresAt(ttlMinutes),
    },
    { onConflict: "clinic_id,line_user_id" },
  );
  if (error) throw new Error(`LINE 操作狀態儲存失敗: ${error.message}`);
}

export async function clearLineCustomerSession(
  service: SupabaseClient,
  clinicId: string,
  lineUserId: string,
): Promise<void> {
  const { error } = await service
    .from("line_customer_sessions")
    .delete()
    .eq("clinic_id", clinicId)
    .eq("line_user_id", lineUserId);
  if (error) throw new Error(`LINE 操作狀態清除失敗: ${error.message}`);
}
