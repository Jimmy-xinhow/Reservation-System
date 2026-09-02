"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createHash, randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";
import {
  pushMessages,
  lineAccessTokenForDestination,
  getBotInfo,
  getWebhookEndpointInfo,
  createRichMenu,
  uploadRichMenuImage,
  setDefaultRichMenu,
  deleteRichMenu,
  clearDefaultRichMenu,
  getRichMenuAlias,
  createRichMenuAlias,
  updateRichMenuAlias,
  deleteRichMenuAlias,
} from "@/lib/line";
import {
  LAYOUTS,
  RICH_MENU_ALIAS_ID_PATTERN,
  slotBounds,
  slotAction,
  validateRichMenuSlots,
  type Layout,
  type RichMenuEntryUrls,
  type RichMenuModuleAvailability,
  type RichMenuTemplateKey,
  type Slot,
} from "@/lib/richmenu";
import { getClinicLineChannelContext } from "@/lib/line-channel";
import { customerEntryUrl, type CustomerEntryKey } from "@/lib/customer-entry";

function str(fd: FormData, key: string): string {
  return (fd.get(key) ?? "").toString().trim();
}

function bool(fd: FormData, key: string): boolean {
  const value = fd.get(key);
  return value === "on" || value === "true" || value === "1";
}

function intOr(fd: FormData, key: string, fallback: number): number {
  const value = Number(str(fd, key));
  return Number.isFinite(value) ? value : fallback;
}

function redirectRichMenuFailure(userMessage: string, cause?: unknown): never {
  const errorId = randomUUID().slice(0, 8).toUpperCase();
  if (cause) {
    console.error(`[richmenu:${errorId}]`, cause instanceof Error ? cause.message.slice(0, 500) : cause);
  }
  redirect(`/admin/richmenu?err=${encodeURIComponent(userMessage)}&error_id=${errorId}`);
}

class RichMenuUserError extends Error {}

// ── LINE 測試推播 ─────────────────────────────────────────
export async function sendTestPushAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const to = str(fd, "line_user_id");
  if (!to) redirect("/admin/line?test=err&reason=" + encodeURIComponent("請填 line_user_id"));

  let failed = false;
  try {
    const { data: clinic, error } = await supabase
      .from("clinics")
      .select("line_destination")
      .eq("id", clinicId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    const token = lineAccessTokenForDestination(clinic?.line_destination as string | undefined);
    await pushMessages(to, [{ type: "text", text: "【品牌】測試推播 ✅ 連線正常。" }], token);
  } catch (e) {
    failed = true;
    const errorId = randomUUID().slice(0, 8).toUpperCase();
    console.error(`[line-test-push:${errorId}]`, e instanceof Error ? e.message.slice(0, 500) : e);
  }
  // redirect() 放在 try/catch 外,避免吞掉其控制流
  redirect(failed ? "/admin/line?test=err" : "/admin/line?test=ok");
}


// ── LINE 自動回覆規則 ─────────────────────────────────────
const REPLY_ACTIONS = ["text", "booking", "query", "progress", "message"] as const;
export async function createReplyAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const keywords = str(fd, "keywords");
  const action = str(fd, "action");
  if (!keywords) throw new Error("請填關鍵字");
  if (!REPLY_ACTIONS.includes(action as (typeof REPLY_ACTIONS)[number])) throw new Error("動作錯誤");
  const { error } = await supabase.from("line_auto_replies").insert({
    clinic_id: clinicId,
    keywords,
    action,
    reply_text: str(fd, "reply_text") || null,
    message_id: str(fd, "message_id") || null,
    sort: intOr(fd, "sort", 0),
    active: true,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function updateReplyAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const keywords = str(fd, "keywords");
  const action = str(fd, "action");
  if (!id || !keywords) throw new Error("缺少必要欄位");
  if (!REPLY_ACTIONS.includes(action as (typeof REPLY_ACTIONS)[number])) throw new Error("動作錯誤");
  const { error } = await supabase
    .from("line_auto_replies")
    .update({
      keywords,
      action,
      reply_text: str(fd, "reply_text") || null,
      message_id: str(fd, "message_id") || null,
      sort: intOr(fd, "sort", 0),
    })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function toggleReplyAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const active = bool(fd, "active");
  const { error } = await supabase
    .from("line_auto_replies")
    .update({ active: !active })
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function deleteReplyAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("line_auto_replies")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

export async function updateLineTextsAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const { error } = await supabase
    .from("clinic_settings")
    .update({
      line_welcome_text: str(fd, "line_welcome_text") || null,
      line_fallback_text: str(fd, "line_fallback_text") || null,
      line_menu_title: str(fd, "line_menu_title") || null,
      line_menu_btn_booking: bool(fd, "line_menu_btn_booking"),
      line_menu_btn_query: bool(fd, "line_menu_btn_query"),
      line_menu_btn_progress: bool(fd, "line_menu_btn_progress"),
      line_menu_btn_info: bool(fd, "line_menu_btn_info"),
      line_menu_link_label: str(fd, "line_menu_link_label") || null,
      line_menu_link_url: str(fd, "line_menu_link_url") || null,
    })
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/replies");
}

// ── LINE 訊息素材 line_messages ───────────────────────────
export async function saveMessageAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const name = str(fd, "name");
  const kind = str(fd, "kind");
  const dataRaw = str(fd, "data");
  if (!name) throw new Error("請填訊息名稱");
  if (!["text", "card", "carousel"].includes(kind)) throw new Error("類型錯誤");
  let data: unknown;
  try {
    data = JSON.parse(dataRaw || "{}");
  } catch {
    throw new Error("內容格式錯誤");
  }
  if (id) {
    const { error } = await supabase
      .from("line_messages")
      .update({ name, kind, data })
      .eq("id", id)
      .eq("clinic_id", clinicId);
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase
      .from("line_messages")
      .insert({ clinic_id: clinicId, name, kind, data });
    if (error) throw new Error(error.message);
  }
  revalidatePath("/admin/messages");
}

export async function deleteMessageAction(fd: FormData) {
  const { supabase, clinicId } = await requireAdmin();
  const id = str(fd, "id");
  const { error } = await supabase
    .from("line_messages")
    .delete()
    .eq("id", id)
    .eq("clinic_id", clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/messages");
}

// ── LINE 圖文選單 Rich Menu ───────────────────────────────
// 依版本建立新 rich menu、上傳圖並切為預設。舊版本保留供回復。
async function buildAndPublishRichMenu(opts: {
  versionId: string;
  versionName: string;
  layout: Layout;
  slots: Slot[];
  chatBarText: string;
  imageBytes: ArrayBuffer;
  contentType: string;
  accessToken: string;
  urls: RichMenuEntryUrls;
}): Promise<string> {
  const spec = LAYOUTS[opts.layout];
  const bounds = slotBounds(opts.layout);
  const areas = bounds
    .map((b, i) => {
      const action = opts.slots[i] ? slotAction(opts.slots[i], opts.urls, { versionId: opts.versionId, slotIndex: i }) : null;
      return action ? { bounds: b, action } : null;
    })
    .filter(Boolean) as { bounds: (typeof bounds)[number]; action: Record<string, unknown> }[];
  if (areas.length === 0) throw new Error("請至少設定一個有動作的格子");
  const newId = await createRichMenu({
    size: { width: spec.width, height: spec.height },
    selected: true,
    name: opts.versionName.slice(0, 300),
    chatBarText: opts.chatBarText || "選單",
    areas,
  }, opts.accessToken);
  try {
    await uploadRichMenuImage(newId, opts.imageBytes, opts.contentType, opts.accessToken);
    await setDefaultRichMenu(newId, opts.accessToken);
  } catch (e) {
    try { await deleteRichMenu(newId, opts.accessToken); }
    catch (cleanupError) { console.error("Failed to remove incomplete Rich Menu", cleanupError); }
    throw e;
  }
  return newId;
}

async function getRichMenuLineContext(supabase: SupabaseClient, clinicId: string, requireReady = false): Promise<{ accessToken: string; clinicSlug: string | null; liffId: string; destination: string | null }> {
  const context = await getClinicLineChannelContext(supabase, clinicId);
  if (!context.enabled) throw new Error("此品牌尚未啟用 LINE／LIFF");
  if (!context.liffId) throw new Error("此品牌尚未設定 LIFF ID");
  if (requireReady && context.verificationStatus !== "ready") throw new Error("LINE／LIFF 尚未完成正式連線驗證");
  return {
    accessToken: lineAccessTokenForDestination(context.destination ?? undefined),
    clinicSlug: context.clinicSlug,
    liffId: context.liffId,
    destination: context.destination,
  };
}

function reqBaseUrl(h: Headers): string {
  const configured = process.env.APP_URL?.trim();
  if (configured) return new URL(configured).origin;
  if (process.env.NODE_ENV === "production") throw new Error("正式環境必須設定 APP_URL");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? "https";
  return host ? `${proto}://${host}` : "";
}

async function richMenuAvailability(supabase: SupabaseClient, clinicId: string): Promise<RichMenuModuleAvailability> {
  const { data, error } = await supabase.from("clinic_settings")
    .select("public_booking_enabled, events_enabled, public_registration_enabled, memberships_enabled, line_channel_enabled, legacy_progress_enabled")
    .eq("clinic_id", clinicId).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("品牌設定不存在");
  return {
    booking: data.public_booking_enabled === true,
    events: data.events_enabled === true && data.public_registration_enabled === true,
    tickets: data.events_enabled === true,
    memberships: data.memberships_enabled === true,
    line: data.line_channel_enabled === true,
    legacyProgress: data.legacy_progress_enabled === true,
  };
}

function buildRichMenuEntryUrls(baseUrl: string, clinicSlug: string | null, liffId: string): RichMenuEntryUrls {
  const keys: CustomerEntryKey[] = ["booking", "appointments", "events", "tickets", "membership", "support", "brand"];
  return Object.fromEntries(keys.map((key) => [key, customerEntryUrl(key, { baseUrl, clinicSlug, liffId })])) as unknown as RichMenuEntryUrls;
}

function inspectRichMenuImage(bytes: ArrayBuffer): { contentType: "image/png" | "image/jpeg"; width: number; height: number; sha256: string } {
  const view = new DataView(bytes);
  let contentType: "image/png" | "image/jpeg";
  let width = 0;
  let height = 0;
  if (view.byteLength >= 24 && view.getUint32(0) === 0x89504e47 && view.getUint32(4) === 0x0d0a1a0a) {
    contentType = "image/png";
    width = view.getUint32(16);
    height = view.getUint32(20);
  } else if (view.byteLength >= 4 && view.getUint16(0) === 0xffd8) {
    contentType = "image/jpeg";
    let offset = 2;
    while (offset + 8 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) { offset += 1; continue; }
      const marker = view.getUint8(offset + 1);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        height = view.getUint16(offset + 5); width = view.getUint16(offset + 7); break;
      }
      if (marker === 0xd9 || marker === 0xda) break;
      const length = view.getUint16(offset + 2);
      if (length < 2) break;
      offset += 2 + length;
    }
  } else throw new Error("圖片內容必須是 PNG 或 JPEG");
  if (!width || !height) throw new Error("無法讀取圖片尺寸");
  return { contentType, width, height, sha256: createHash("sha256").update(Buffer.from(bytes)).digest("hex") };
}

export async function saveRichMenuAction(fd: FormData) {
  const { supabase, clinicId, user } = await requireAdmin();
  const layout = str(fd, "layout") as Layout;
  if (!LAYOUTS[layout]) throw new Error("版型錯誤");
  const count = LAYOUTS[layout].slots;
  const slots: Slot[] = [];
  for (let i = 0; i < count; i++) {
    slots.push({
      label: str(fd, `label_${i}`),
      accessibilityLabel: str(fd, `accessibility_label_${i}`),
      action: (str(fd, `action_${i}`) || "none") as Slot["action"],
      value: str(fd, `value_${i}`) || undefined,
    });
  }
  const name = str(fd, "name") || `Rich Menu ${new Date().toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}`;
  const chatBarText = str(fd, "chat_bar_text") || "選單";
  const templateKey = (["booking", "events", "mixed", "custom"] as const).includes(str(fd, "template_key") as RichMenuTemplateKey) ? str(fd, "template_key") as RichMenuTemplateKey : "custom";
  const errors = validateRichMenuSlots(layout, slots, await richMenuAvailability(supabase, clinicId));
  if (chatBarText.length > 14) errors.push("選單列文字不可超過 14 字");
  if (errors.length > 0) redirect(`/admin/richmenu?err=${encodeURIComponent(errors.join("；").slice(0, 500))}`);
  const service = createServiceClient();
  const { data: versionId, error } = await service.rpc("create_line_richmenu_version", {
    p_clinic_id: clinicId, p_actor_user_id: user.id, p_name: name, p_template_key: templateKey,
    p_layout: layout, p_chat_bar_text: chatBarText, p_slots: slots,
  });
  if (error) redirectRichMenuFailure("草稿暫時無法儲存，請稍後再試。", error);
  redirect(`/admin/richmenu?saved=1&draft=${encodeURIComponent(String(versionId))}`);
}

export async function publishRichMenuAction(fd: FormData): Promise<{ ok: boolean; error?: string }> {
  const { supabase, clinicId, user } = await requireAdmin();
  const service = createServiceClient();
  const versionId = str(fd, "version_id");
  let errMsg: string | null = null;
  let failureDetail: string | null = null;
  let newId: string | null = null;
  let oldId: string | null = null;
  try {
    if (!versionId) throw new RichMenuUserError("請先建立草稿版本");
    const [{ data: version, error: versionError }, { data: cfg, error: cfgError }] = await Promise.all([
      service.from("line_richmenu_versions").select("id, name, layout, chat_bar_text, slots, status").eq("id", versionId).eq("clinic_id", clinicId).maybeSingle(),
      service.from("line_richmenu").select("published_id").eq("clinic_id", clinicId).maybeSingle(),
    ]);
    if (versionError || cfgError) throw new Error(versionError?.message ?? cfgError?.message);
    if (!version) throw new RichMenuUserError("找不到草稿版本");
    const layout = version.layout as Layout;
    const spec = LAYOUTS[layout];
    if (!spec) throw new RichMenuUserError("選單版型無法辨識，請重新選擇版型。");
    const slots = (version.slots as Slot[]) ?? [];
    const validationErrors = validateRichMenuSlots(layout, slots, await richMenuAvailability(supabase, clinicId));
    if (validationErrors.length > 0) throw new RichMenuUserError(validationErrors.join("；"));

    const file = fd.get("image");
    if (!(file instanceof File) || file.size === 0) throw new RichMenuUserError("請選擇圖片");
    if (file.size > 1024 * 1024) throw new RichMenuUserError("圖片檔案需小於 1MB");
    const imageBytes = await file.arrayBuffer();
    const image = inspectRichMenuImage(imageBytes);
    if (image.width !== spec.width || image.height !== spec.height) throw new RichMenuUserError(`圖片尺寸必須是 ${spec.width} × ${spec.height} 像素`);
    const context = await getRichMenuLineContext(supabase, clinicId, true);
    const baseUrl = reqBaseUrl(await headers());
    oldId = (cfg?.published_id as string | null) ?? null;
    const { error: readyError } = await service
      .from("line_richmenu_versions")
      .update({ status: "ready", validation_errors: [] })
      .eq("id", versionId)
      .eq("clinic_id", clinicId);
    if (readyError) throw new Error(readyError.message);
    const { error: validationEventError } = await service
      .from("line_richmenu_publication_events")
      .insert({ clinic_id: clinicId, version_id: versionId, kind: "validated", actor_id: user.id });
    if (validationEventError) throw new Error(validationEventError.message);
    const { error: publishingError } = await service
      .from("line_richmenu_versions")
      .update({ status: "publishing" })
      .eq("id", versionId)
      .eq("clinic_id", clinicId);
    if (publishingError) throw new Error(publishingError.message);
    newId = await buildAndPublishRichMenu({
      versionId,
      versionName: String(version.name),
      layout,
      slots,
      chatBarText: (version.chat_bar_text as string) || "選單",
      imageBytes,
      contentType: image.contentType,
      accessToken: context.accessToken,
      urls: buildRichMenuEntryUrls(baseUrl, context.clinicSlug, context.liffId),
    });
    const { error: recordError } = await service.rpc("record_line_richmenu_publication", {
      p_clinic_id: clinicId, p_actor_user_id: user.id, p_version_id: versionId,
      p_line_rich_menu_id: newId, p_kind: "published", p_image_sha256: image.sha256,
      p_image_width: image.width, p_image_height: image.height,
    });
    if (recordError) {
      try {
        if (oldId) await setDefaultRichMenu(oldId, context.accessToken); else await clearDefaultRichMenu(context.accessToken);
      } catch (compensationError) {
        console.error("Failed to restore previous Rich Menu default", compensationError);
      }
      try { await deleteRichMenu(newId, context.accessToken); }
      catch (cleanupError) { console.error("Failed to remove unrecorded Rich Menu", cleanupError); }
      newId = null;
      throw new Error(recordError.message);
    }
  } catch (e) {
    failureDetail = e instanceof Error ? e.message : "發布失敗";
    if (e instanceof RichMenuUserError) {
      errMsg = e.message;
    } else {
      const errorId = randomUUID().slice(0, 8).toUpperCase();
      console.error(`[richmenu-publish:${errorId}]`, failureDetail.slice(0, 500));
      errMsg = `目前無法發布選單，請稍後再試。錯誤識別碼：${errorId}`;
    }
    if (versionId) {
      try {
        const { error: failureRecordError } = await service.rpc("record_line_richmenu_publish_failure", {
          p_clinic_id: clinicId,
          p_actor_user_id: user.id,
          p_version_id: versionId,
          p_error: failureDetail,
        });
        if (failureRecordError) console.error("Failed to record Rich Menu publication failure", failureRecordError);
      } catch (auditError) {
        // 保留原始發布錯誤；稽核寫入失敗會由 server log／後續驗收追查。
        console.error("Failed to record Rich Menu publication failure", auditError);
      }
    }
  }
  revalidatePath("/admin/richmenu");
  // 回傳結果(此 action 由 client 端程式呼叫,不能用 redirect,否則會丟出 NEXT_REDIRECT)
  return errMsg ? { ok: false, error: errMsg } : { ok: true };
}

export async function unpublishRichMenuAction() {
  const { supabase, clinicId, user } = await requireAdmin();
  const service = createServiceClient();
  const { data: cfg } = await service
    .from("line_richmenu")
    .select("published_id")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  const context = await getRichMenuLineContext(supabase, clinicId);
  await clearDefaultRichMenu(context.accessToken);
  const id = (cfg?.published_id as string | null) ?? null;
  const { error } = await service.rpc("record_line_richmenu_unpublished", { p_clinic_id: clinicId, p_actor_user_id: user.id });
  if (error) {
    if (id) await setDefaultRichMenu(id, context.accessToken);
    throw new Error(error.message);
  }
  revalidatePath("/admin/richmenu");
}

export async function rollbackRichMenuVersionAction(fd: FormData) {
  const { supabase, clinicId, user } = await requireAdmin();
  const versionId = str(fd, "version_id");
  const service = createServiceClient();
  const [{ data: target }, { data: current }] = await Promise.all([
    service.from("line_richmenu_versions").select("id, line_rich_menu_id").eq("id", versionId).eq("clinic_id", clinicId).maybeSingle(),
    service.from("line_richmenu").select("published_id").eq("clinic_id", clinicId).maybeSingle(),
  ]);
  const targetLineId = target?.line_rich_menu_id as string | null;
  if (!targetLineId) throw new Error("此版本沒有可回復的 LINE Rich Menu ID");
  const currentLineId = (current?.published_id as string | null) ?? null;
  const context = await getRichMenuLineContext(supabase, clinicId);
  await setDefaultRichMenu(targetLineId, context.accessToken);
  const { error } = await service.rpc("record_line_richmenu_publication", {
    p_clinic_id: clinicId, p_actor_user_id: user.id, p_version_id: versionId,
    p_line_rich_menu_id: targetLineId, p_kind: "rolled_back",
  });
  if (error) {
    if (currentLineId) await setDefaultRichMenu(currentLineId, context.accessToken); else await clearDefaultRichMenu(context.accessToken);
    throw new Error(error.message);
  }
  revalidatePath("/admin/richmenu");
}

export async function cloneRichMenuVersionAction(fd: FormData) {
  const { clinicId, user } = await requireAdmin();
  const sourceVersionId = str(fd, "version_id");
  const name = str(fd, "name") || null;
  if (!sourceVersionId) redirect("/admin/richmenu?err=%E6%89%BE%E4%B8%8D%E5%88%B0%E8%A6%81%E8%A4%87%E8%A3%BD%E7%9A%84%E7%89%88%E6%9C%AC");
  const { data: versionId, error } = await createServiceClient().rpc("clone_line_richmenu_version", {
    p_clinic_id: clinicId,
    p_actor_user_id: user.id,
    p_source_version_id: sourceVersionId,
    p_name: name,
  });
  if (error) redirectRichMenuFailure("版本暫時無法複製，請稍後再試。", error);
  revalidatePath("/admin/richmenu");
  redirect(`/admin/richmenu?cloned=1&draft=${encodeURIComponent(String(versionId))}`);
}

export async function syncRichMenuAliasAction(fd: FormData) {
  const { supabase, clinicId, user } = await requireAdmin();
  const aliasId = str(fd, "alias_id");
  const label = str(fd, "label");
  const versionId = str(fd, "version_id");
  if (!RICH_MENU_ALIAS_ID_PATTERN.test(aliasId)) redirect(`/admin/richmenu?err=${encodeURIComponent("Alias ID 僅能使用 1–32 個小寫英數字、底線或連字號")}`);
  if (!label || label.length > 40) redirect(`/admin/richmenu?err=${encodeURIComponent("Alias 名稱需為 1–40 字")}`);

  const service = createServiceClient();
  const [{ data: version, error: versionError }, { data: localAlias, error: localAliasError }] = await Promise.all([
    service.from("line_richmenu_versions").select("id, line_rich_menu_id").eq("id", versionId).eq("clinic_id", clinicId).maybeSingle(),
    service.from("line_richmenu_aliases").select("id, channel_destination, status").eq("clinic_id", clinicId).eq("alias_id", aliasId).maybeSingle(),
  ]);
  if (localAliasError) redirectRichMenuFailure("選單頁籤資料暫時無法讀取，請稍後再試。", localAliasError);
  if (versionError) redirectRichMenuFailure("選單版本暫時無法讀取，請稍後再試。", versionError);
  if (!version?.line_rich_menu_id) redirect(`/admin/richmenu?err=${encodeURIComponent("選單頁籤只能連到此品牌已上傳至 LINE 的版本")}`);

  const context = await getRichMenuLineContext(supabase, clinicId, true);
  if (!context.destination) redirect(`/admin/richmenu?err=${encodeURIComponent("建立 Alias 前必須先設定品牌 LINE destination")}`);
  if (localAlias && localAlias.status !== "removed" && localAlias.channel_destination !== context.destination) {
    redirect(`/admin/richmenu?err=${encodeURIComponent("此 Alias 仍屬於舊 LINE 渠道，請先移除後再於新渠道建立")}`);
  }
  const { data: channelConflict, error: conflictError } = await service
    .from("line_richmenu_aliases")
    .select("id")
    .eq("channel_destination", context.destination)
    .eq("alias_id", aliasId)
    .neq("clinic_id", clinicId)
    .neq("status", "removed")
    .limit(1)
    .maybeSingle();
  if (conflictError) redirectRichMenuFailure("目前無法確認選單頁籤代碼是否可用，請稍後再試。", conflictError);
  if (channelConflict) redirect(`/admin/richmenu?err=${encodeURIComponent("此選單頁籤代碼已由同一 LINE 渠道的其他品牌使用")}`);
  const remoteBefore = await getRichMenuAlias(aliasId, context.accessToken);
  const ownsRemoteAlias = Boolean(localAlias && localAlias.channel_destination === context.destination && localAlias.status !== "removed");
  if (remoteBefore && !ownsRemoteAlias) redirect(`/admin/richmenu?err=${encodeURIComponent("此 Alias ID 已存在於 LINE 渠道且不屬於本品牌，請改用其他 ID")}`);
  if (remoteBefore) await updateRichMenuAlias(aliasId, version.line_rich_menu_id, context.accessToken);
  else await createRichMenuAlias(aliasId, version.line_rich_menu_id, context.accessToken);

  const { error } = await service.from("line_richmenu_aliases").upsert({
    clinic_id: clinicId,
    channel_destination: context.destination,
    alias_id: aliasId,
    label,
    version_id: version.id,
    line_rich_menu_id: version.line_rich_menu_id,
    status: "ready",
    last_error: null,
    last_synced_at: new Date().toISOString(),
    created_by: user.id,
    updated_by: user.id,
  }, { onConflict: "clinic_id,alias_id" });
  if (error) {
    try {
      if (remoteBefore) await updateRichMenuAlias(aliasId, remoteBefore.richMenuId, context.accessToken);
      else await deleteRichMenuAlias(aliasId, context.accessToken);
    } catch (compensationError) {
      console.error("Failed to restore Rich Menu Alias after database error", compensationError);
    }
    redirectRichMenuFailure("選單頁籤暫時無法儲存，LINE 線上設定已嘗試還原。", error);
  }
  revalidatePath("/admin/richmenu");
  redirect("/admin/richmenu?alias_saved=1");
}

export async function removeRichMenuAliasAction(fd: FormData) {
  const { clinicId, user } = await requireAdmin();
  const aliasId = str(fd, "alias_id");
  if (!RICH_MENU_ALIAS_ID_PATTERN.test(aliasId)) redirect(`/admin/richmenu?err=${encodeURIComponent("Alias ID 格式錯誤")}`);
  const service = createServiceClient();
  const { data: local, error: localError } = await service
    .from("line_richmenu_aliases")
    .select("id, channel_destination")
    .eq("clinic_id", clinicId)
    .eq("alias_id", aliasId)
    .maybeSingle();
  if (localError) redirectRichMenuFailure("選單頁籤資料暫時無法讀取，請稍後再試。", localError);
  if (!local) redirect(`/admin/richmenu?err=${encodeURIComponent("找不到此品牌的選單頁籤")}`);
  const aliasAccessToken = lineAccessTokenForDestination(local.channel_destination);
  const remoteBefore = await getRichMenuAlias(aliasId, aliasAccessToken);
  await deleteRichMenuAlias(aliasId, aliasAccessToken);
  const { error } = await service
    .from("line_richmenu_aliases")
    .update({ status: "removed", last_error: null, last_synced_at: new Date().toISOString(), updated_by: user.id })
    .eq("id", local.id)
    .eq("clinic_id", clinicId);
  if (error) {
    if (remoteBefore) {
      try { await createRichMenuAlias(aliasId, remoteBefore.richMenuId, aliasAccessToken); }
      catch (compensationError) { console.error("Failed to restore deleted Rich Menu Alias", compensationError); }
    }
    redirectRichMenuFailure("選單頁籤暫時無法移除，LINE 線上設定已嘗試還原。", error);
  }
  revalidatePath("/admin/richmenu");
  redirect("/admin/richmenu?alias_removed=1");
}

function taipeiLocalDateTime(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, yearText, monthText, dayText, hourText, minuteText] = match;
  const [year, month, day, hour, minute] = [yearText, monthText, dayText, hourText, minuteText].map(Number);
  const maxDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > maxDay || hour > 23 || minute > 59) return null;
  return new Date(Date.UTC(year, month - 1, day, hour - 8, minute)).toISOString();
}

export async function createRichMenuScheduleAction(fd: FormData) {
  const { supabase, clinicId, user } = await requireAdmin();
  const versionId = str(fd, "version_id");
  const startsAt = taipeiLocalDateTime(str(fd, "starts_at"));
  const endsAt = taipeiLocalDateTime(str(fd, "ends_at"));
  if (!startsAt || !endsAt) redirect(`/admin/richmenu?err=${encodeURIComponent("顯示期間格式錯誤")}`);
  await getRichMenuLineContext(supabase, clinicId, true);
  const { error } = await createServiceClient().rpc("create_line_richmenu_schedule", {
    p_clinic_id: clinicId,
    p_actor_user_id: user.id,
    p_version_id: versionId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
  });
  if (error) redirectRichMenuFailure("顯示期間暫時無法排程，請稍後再試。", error);
  revalidatePath("/admin/richmenu");
  redirect("/admin/richmenu?scheduled=1");
}

export async function cancelRichMenuScheduleAction(fd: FormData) {
  const { clinicId, user } = await requireAdmin();
  const scheduleId = str(fd, "schedule_id");
  const { error } = await createServiceClient().rpc("cancel_line_richmenu_schedule", {
    p_clinic_id: clinicId,
    p_actor_user_id: user.id,
    p_schedule_id: scheduleId,
  });
  if (error) redirectRichMenuFailure("排程暫時無法取消，請稍後再試。", error);
  revalidatePath("/admin/richmenu");
  redirect("/admin/richmenu?schedule_cancelled=1");
}

export async function updateLineChannelSettingsAction(fd: FormData) {
  const { supabase, clinicId, user } = await requireAdmin();
  const enabled = bool(fd, "line_channel_enabled");
  const connectionMode = str(fd, "connection_mode") === "brand" ? "brand" : "shared";
  const destination = str(fd, "line_destination") || null;
  const loginChannelId = str(fd, "login_channel_id") || null;
  const liffId = str(fd, "liff_id") || null;
  const endpointPath = str(fd, "liff_endpoint_path") || "/book";

  if (destination && !/^U[A-Za-z0-9_-]{8,100}$/.test(destination)) throw new Error("LINE destination 格式不正確");
  if (loginChannelId && !/^[0-9]{6,30}$/.test(loginChannelId)) throw new Error("LINE Login Channel ID 格式不正確");
  if (liffId && !/^[0-9]{6,30}-[A-Za-z0-9_-]{4,100}$/.test(liffId)) throw new Error("LIFF ID 格式不正確");
  if (!endpointPath.startsWith("/") || endpointPath.startsWith("//") || endpointPath.includes("\\") || endpointPath.length > 200) {
    throw new Error("LIFF Endpoint Path 格式不正確");
  }
  if (enabled && connectionMode === "brand" && (!destination || !loginChannelId || !liffId)) {
    throw new Error("品牌獨立渠道必須填寫 destination、LINE Login Channel ID 與 LIFF ID");
  }

  const { error } = await supabase.rpc("update_clinic_line_channel", {
    p_clinic_id: clinicId,
    p_actor_user_id: user.id,
    p_enabled: enabled,
    p_connection_mode: connectionMode,
    p_destination: destination,
    p_login_channel_id: loginChannelId,
    p_liff_id: liffId,
    p_liff_endpoint_path: endpointPath,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/admin/line");
  revalidatePath("/admin/richmenu");
  redirect("/admin/line?saved=1");
}

function normalizedWebhookUrl(value: string): string {
  const url = new URL(value);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  return `${url.origin}${pathname}${url.search}`;
}

export async function verifyLineChannelSettingsAction() {
  const { supabase, clinicId } = await requireAdmin();
  const service = createServiceClient();
  const verifiedAt = new Date().toISOString();
  let result: "ok" | "err" = "ok";
  let reason = "";

  try {
    const context = await getClinicLineChannelContext(supabase, clinicId);
    if (!context.enabled) throw new Error("請先啟用並儲存此品牌的 LINE／LIFF 渠道");
    if (!context.destination) throw new Error("缺少 LINE webhook destination");
    if (!context.loginChannelId) throw new Error("缺少 LINE Login Channel ID");
    if (!context.liffId) throw new Error("缺少 LIFF ID");

    const token = lineAccessTokenForDestination(context.destination);
    const [bot, webhook] = await Promise.all([
      getBotInfo(token),
      getWebhookEndpointInfo(token),
    ]);
    if (bot.userId !== context.destination) {
      throw new Error("LINE destination 與目前 access token 的 Bot 不一致");
    }
    if (!webhook.active) throw new Error("LINE Developers 尚未啟用 webhook");

    const expectedWebhook = normalizedWebhookUrl(`${reqBaseUrl(await headers())}/api/line/webhook`);
    const configuredWebhook = normalizedWebhookUrl(webhook.endpoint);
    if (configuredWebhook !== expectedWebhook) {
      throw new Error(`LINE Webhook URL 不一致，應設定為 ${expectedWebhook}`);
    }

    const { data: verifiedChannel, error } = await service
      .from("clinic_line_channels")
      .update({ verification_status: "ready", verification_error: null, last_verified_at: verifiedAt })
      .eq("clinic_id", clinicId)
      .select("clinic_id")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!verifiedChannel) throw new Error("找不到此品牌的 LINE 渠道設定，請先儲存後再驗證");
  } catch (error) {
    result = "err";
    reason = (error instanceof Error ? error.message : "LINE 渠道驗證失敗").slice(0, 500);
    const { error: updateError } = await service
      .from("clinic_line_channels")
      .update({ verification_status: "error", verification_error: reason, last_verified_at: verifiedAt })
      .eq("clinic_id", clinicId);
    if (updateError) reason = `${reason}；狀態寫入失敗：${updateError.message}`.slice(0, 500);
  }

  revalidatePath("/admin/line");
  revalidatePath("/admin/dashboard");
  revalidatePath("/admin/richmenu");
  redirect(`/admin/line?verified=${result}`);
}
