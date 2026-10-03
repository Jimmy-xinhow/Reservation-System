"use server";

import { errorCategory } from "@/lib/error-category";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { emailConfigForClinic, sendEmail } from "@/lib/email";
import { getBotInfo, getWebhookEndpointInfo, lineAccessTokenForDestination, type LineBotInfo, type LineWebhookEndpointInfo } from "@/lib/line";
import { getClinicLineChannelContext } from "@/lib/line-channel";
import { getPaymentSettings } from "@/lib/payment";
import { resolvePublicClinicIdFromScope } from "@/lib/public-brand";
import { publicRequestOrigin } from "@/lib/public-origin";
import { createServiceClient } from "@/lib/supabase";

type CheckStatus = "passed" | "warning" | "failed";
interface Check { label: string; status: CheckStatus; detail: string; }
interface Run { channel: "line" | "liff" | "email" | "payment" | "domain"; status: CheckStatus; checks: Check[]; }
type EmailProof = Check & { kind?: string; receiptId?: string; configRevision?: string };
interface EmailRun { checks: EmailProof[]; ran_by: string | null; created_at: string; }

function matchingEmailProof(run: EmailRun | null | undefined, kind: string, revision: string): EmailProof | undefined {
  return (Array.isArray(run?.checks) ? run.checks : []).find((check) => check?.kind === kind
    && check.configRevision === revision
    && typeof check.receiptId === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(check.receiptId));
}

async function emailRevision(service: ReturnType<typeof createServiceClient>, clinicId: string): Promise<string | null> {
  const { data, error } = await service.from("clinic_email_secret_refs")
    .select("api_key_secret_id, updated_at")
    .eq("clinic_id", clinicId)
    .maybeSingle();
  if (error) throw new Error("Email 測試狀態暫時無法讀取");
  return data?.api_key_secret_id && data.updated_at ? `${data.api_key_secret_id}:${data.updated_at}` : null;
}

async function recentEmailRuns(service: ReturnType<typeof createServiceClient>, clinicId: string, since: string): Promise<EmailRun[]> {
  const { data, error } = await service.from("channel_test_runs")
    .select("checks, ran_by, created_at")
    .eq("clinic_id", clinicId)
    .eq("channel", "email")
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw new Error("Email 測試紀錄暫時無法讀取");
  return (data ?? []) as EmailRun[];
}

export async function sendChannelEmailTestAction(): Promise<void> {
  const member = await requireAdmin();
  const recipient = member.user.email;
  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) throw new Error("目前帳號沒有可用的 Email 收件地址");
  const service = createServiceClient();
  const { data: settings, error: settingsError } = await service.from("clinic_settings")
    .select("email_enabled").eq("clinic_id", member.clinicId).single();
  if (settingsError || !settings?.email_enabled) throw new Error("請先啟用品牌 Email 通知");
  const revision = await emailRevision(service, member.clinicId);
  if (!revision) throw new Error("請先在品牌後台儲存 Email 寄件憑證");
  const config = await emailConfigForClinic(member.clinicId, service);
  if (!config?.apiKey || !config.from) throw new Error("Email 寄件設定尚未完成");

  const now = Date.now();
  const previous = await recentEmailRuns(service, member.clinicId, new Date(now - 10 * 60_000).toISOString());
  if (previous.some((run) => run.ran_by === member.user.id && matchingEmailProof(run, "email_test_sent", revision))) {
    revalidatePath("/admin/channels");
    redirect("/admin/channels?email_test=sent");
  }
  const windowId = Math.floor(now / (10 * 60_000));
  let receiptId: string | null;
  try {
    receiptId = await sendEmail(config, recipient, `Email 渠道測試 ${windowId}`,
      `<p>這是品牌後台的 Email 渠道測試信。請確認實際收到後，回到後台按「我已收到測試信」。</p><p>測試編號：${windowId}</p>`,
      { idempotencyKey: `channel-email-test-${member.clinicId}-${member.user.id}-${revision.replace(/[^a-zA-Z0-9]/g, "")}-${windowId}` });
  } catch (error) {
    console.error("Channel Email test failed", { clinicId: member.clinicId, category: errorCategory(error instanceof Error ? error.message : "") });
    throw new Error("測試信未能確認寄出，請稍後查看收件匣；避免立即重複寄送");
  }
  if (!receiptId) throw new Error("寄件服務未回傳可核對的收據，請先查看收件匣；避免立即重複寄送");
  const checks: EmailProof[] = [{ label: "測試信", status: "warning", detail: "寄件服務已接受，等待目前管理者確認實際收件", kind: "email_test_sent", receiptId, configRevision: revision }];
  const { error } = await service.from("channel_test_runs").insert({ clinic_id: member.clinicId, channel: "email", status: "warning", checks, ran_by: member.user.id });
  if (error) throw new Error("測試信可能已寄出，但無法保存收據；請勿立即重送");
  revalidatePath("/admin/channels");
  redirect("/admin/channels?email_test=sent");
}

export async function confirmChannelEmailReceiptAction(): Promise<void> {
  const member = await requireAdmin();
  const service = createServiceClient();
  const { data: settings, error: settingsError } = await service.from("clinic_settings")
    .select("email_enabled").eq("clinic_id", member.clinicId).single();
  if (settingsError || !settings?.email_enabled) throw new Error("請先啟用品牌 Email 通知");
  const revision = await emailRevision(service, member.clinicId);
  if (!revision) throw new Error("目前 Email 寄件憑證尚未設定");
  const runs = await recentEmailRuns(service, member.clinicId, new Date(Date.now() - 30 * 60_000).toISOString());
  const proof = runs
    .filter((run) => run.ran_by === member.user.id)
    .map((run) => matchingEmailProof(run, "email_test_sent", revision))
    .find((check): check is EmailProof => Boolean(check));
  if (!proof) throw new Error("找不到目前憑證、本人寄出的近期測試信；請先寄送並確認收件");
  if (runs.some((run) => matchingEmailProof(run, "email_test_receipt_confirmed", revision)?.receiptId === proof.receiptId)) {
    revalidatePath("/admin/channels");
    redirect("/admin/channels?email_test=confirmed");
  }
  const checks: EmailProof[] = [{ label: "實際收件", status: "passed", detail: "管理者已確認本人信箱收到測試信", kind: "email_test_receipt_confirmed", receiptId: proof.receiptId, configRevision: revision }];
  const { error } = await service.from("channel_test_runs").insert({ clinic_id: member.clinicId, channel: "email", status: "passed", checks, ran_by: member.user.id });
  if (error) throw new Error("無法保存收件確認，請稍後重試");
  revalidatePath("/admin/channels");
  redirect("/admin/channels?email_test=confirmed");
}

function summarize(checks: Check[]): CheckStatus {
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "passed";
}

function normalizedWebhookUrl(value: string): string {
  const url = new URL(value);
  const pathname = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, "") : url.pathname;
  return `${url.origin}${pathname}${url.search}`;
}

function lineDeliveryChecks(bot: LineBotInfo, webhook: LineWebhookEndpointInfo, destination: string, expectedWebhook: string): Check[] {
  if (bot.userId !== destination) {
    return [{ label: "官方帳號歸屬", status: "failed", detail: "授權資料對應另一個 LINE 官方帳號，請重新核對此品牌設定" }];
  }
  const checks: Check[] = [
    { label: "Messaging API", status: "passed", detail: `${bot.displayName}（${bot.basicId ?? "無 Basic ID"}）` },
    { label: "回應模式", status: bot.chatMode === "bot" ? "passed" : "warning", detail: bot.chatMode === "bot" ? "Bot 模式已啟用" : `目前為 ${bot.chatMode ?? "未知"}` },
  ];
  let webhookStatus: CheckStatus = "warning";
  let webhookDetail = "LINE Developers 尚未啟用 Webhook";
  if (webhook.active) {
    try {
      const matches = normalizedWebhookUrl(webhook.endpoint) === normalizedWebhookUrl(expectedWebhook);
      webhookStatus = matches ? "passed" : "warning";
      webhookDetail = matches
        ? "訊息接收網址與本環境相符"
        : "Webhook 指向另一環境；共用官方帳號請勿直接覆蓋原網址";
    } catch {
      webhookStatus = "failed";
      webhookDetail = "LINE Webhook 網址格式無法確認";
    }
  }
  checks.push({ label: "Webhook 接收", status: webhookStatus, detail: webhookDetail });
  return checks;
}

async function hasAcceptedPaymentWebhook(
  service: ReturnType<typeof createServiceClient>,
  clinicId: string,
  payment: NonNullable<Awaited<ReturnType<typeof getPaymentSettings>>>,
): Promise<boolean> {
  const { data: setting, error: settingError } = await service.from("clinic_payment_settings")
    .select("updated_at")
    .eq("clinic_id", clinicId)
    .eq("provider", payment.provider)
    .eq("environment", payment.environment)
    .eq("active", true)
    .maybeSingle();
  if (settingError) throw settingError;
  if (!setting?.updated_at) return false;

  const { data: webhooks, error: webhookError } = await service.from("payment_webhook_events")
    .select("event_key")
    .eq("clinic_id", clinicId)
    .eq("provider", payment.provider)
    .not("processed_at", "is", null)
    .is("error", null)
    .gte("created_at", setting.updated_at)
    .order("created_at", { ascending: false })
    .limit(20);
  if (webhookError) throw webhookError;
  const eventKeys = [...new Set((webhooks ?? []).map((row) => row.event_key))];
  if (eventKeys.length === 0) return false;

  const { data: transactions, error: transactionError } = await service.from("payment_transactions")
    .select("payment_order_id")
    .eq("clinic_id", clinicId)
    .eq("status", "accepted")
    .in("event_key", eventKeys);
  if (transactionError) throw transactionError;
  const orderIds = [...new Set((transactions ?? []).map((row) => row.payment_order_id))];
  if (orderIds.length === 0) return false;

  const { data: orders, error: orderError } = await service.from("payment_orders")
    .select("id")
    .eq("clinic_id", clinicId)
    .eq("provider", payment.provider)
    .eq("status", "paid")
    .gte("created_at", setting.updated_at)
    .in("id", orderIds)
    .limit(1);
  if (orderError) throw orderError;
  return (orders?.length ?? 0) > 0;
}
export async function runChannelTestsAction(): Promise<void> {
  const member = await requireAdmin();
  try {
    const service = createServiceClient();
    const [settingsResult, clinicResult, domainsResult, lineContext, payment] = await Promise.all([
      service.from("clinic_settings").select("line_channel_enabled, email_enabled, deposit_enabled").eq("clinic_id", member.clinicId).single(),
      service.from("clinics").select("slug, line_destination").eq("id", member.clinicId).single(),
      service.from("clinic_domains").select("hostname, active, verified_at").eq("clinic_id", member.clinicId),
      getClinicLineChannelContext(service, member.clinicId),
      getPaymentSettings(service, member.clinicId),
    ]);
    const firstError = settingsResult.error ?? clinicResult.error ?? domainsResult.error;
    if (firstError) throw new Error(`讀取渠道設定失敗：${firstError.message}`);
    if (!settingsResult.data || !clinicResult.data) throw new Error("品牌渠道設定不完整");
    const settings = settingsResult.data;
    const clinic = clinicResult.data;
    const runs: Run[] = [];

    const lineChecks: Check[] = [];
    if (!settings.line_channel_enabled) lineChecks.push({ label: "LINE 模組", status: "warning", detail: "品牌尚未啟用 LINE 渠道" });
    else if (!clinic.line_destination) {
      lineChecks.push({ label: "官方帳號歸屬", status: "failed", detail: "品牌尚未設定 LINE destination" });
    } else {
      try {
        const token = await lineAccessTokenForDestination(clinic.line_destination);
        const [bot, webhook] = await Promise.all([getBotInfo(token), getWebhookEndpointInfo(token)]);
        lineChecks.push(...lineDeliveryChecks(bot, webhook, clinic.line_destination, `${publicRequestOrigin()}/api/line/webhook`));
      } catch (error) {
        console.error("Channel LINE check failed", { clinicId: member.clinicId, category: errorCategory(error instanceof Error ? error.message : "") });
        lineChecks.push({ label: "Messaging API", status: "failed", detail: "無法確認 LINE 連線，請檢查官方帳號授權設定後重試。" });
      }
    }
    runs.push({ channel: "line", status: summarize(lineChecks), checks: lineChecks });

    const liffChecks: Check[] = [
      { label: "LINE 模組", status: lineContext.enabled ? "passed" : "warning", detail: lineContext.enabled ? "品牌已啟用 LINE／LIFF" : "品牌已停用 LINE／LIFF；既有設定暫不生效" },
      { label: "LIFF ID", status: lineContext.liffId ? "passed" : "failed", detail: lineContext.liffId ? "已設定（不顯示完整識別碼）" : "尚未設定" },
      { label: "Login Channel", status: lineContext.loginChannelId ? "passed" : "failed", detail: lineContext.loginChannelId ? "已設定" : "尚未設定" },
      { label: "Endpoint", status: lineContext.liffEndpointPath.startsWith("/") ? "passed" : "failed", detail: lineContext.liffEndpointPath },
      { label: "渠道驗證", status: lineContext.verificationStatus === "ready" ? "passed" : "warning", detail: lineContext.verificationStatus === "ready" ? "後端驗證已通過" : "仍需執行 LINE 頁面的渠道驗證" },
    ];
    runs.push({ channel: "liff", status: summarize(liffChecks), checks: liffChecks });

    const emailConfig = await emailConfigForClinic(member.clinicId);
    const emailConfigRevision = settings.email_enabled && emailConfig?.apiKey
      ? await emailRevision(service, member.clinicId) : null;
    const emailProofRuns = emailConfigRevision
      ? await recentEmailRuns(service, member.clinicId, new Date(Date.now() - 30 * 24 * 60 * 60_000).toISOString()) : [];
    const emailReceiptConfirmed = emailConfigRevision
      ? emailProofRuns.some((run) => Boolean(matchingEmailProof(run, "email_test_receipt_confirmed", emailConfigRevision)))
      : false;
    const emailChecks: Check[] = !settings.email_enabled
      ? [{ label: "Email 提醒", status: "warning", detail: "品牌尚未啟用 Email" }]
      : [
          { label: "Email 寄送授權", status: emailConfig?.apiKey ? "passed" : "failed", detail: emailConfig?.apiKey ? "私密授權資料已設定" : "尚未設定 Email 寄送服務授權" },
          { label: "寄件人", status: emailConfig?.from ? "passed" : "failed", detail: emailConfig?.from ? emailConfig.from : "缺少寄件人" },
          { label: "實際收件", status: emailReceiptConfirmed ? "passed" : "warning", detail: emailReceiptConfirmed ? "目前憑證的測試信已由品牌管理者確認實收" : "尚未寄送測試信並確認收件；設定齊全不代表郵件已送達" },
        ];
    runs.push({ channel: "email", status: summarize(emailChecks), checks: emailChecks });

    const paymentConfirmed = payment?.hash_key && payment.hash_iv
      ? await hasAcceptedPaymentWebhook(service, member.clinicId, payment)
      : false;
    const paymentChecks: Check[] = !settings.deposit_enabled && !payment
      ? [{ label: "標準金流", status: "warning", detail: "未啟用訂金或金流" }]
      : payment
        ? [
            { label: "商店設定", status: "passed", detail: `${payment.provider === "ecpay" ? "綠界" : "藍新"} · ${payment.environment === "production" ? "正式" : "測試"}` },
            { label: "付款驗證資料", status: payment.hash_key && payment.hash_iv ? "passed" : "failed", detail: payment.hash_key && payment.hash_iv ? "私密授權資料已設定" : "尚未設定付款驗證資料" },
            { label: "實際交易與回呼", status: paymentConfirmed ? "passed" : "warning", detail: paymentConfirmed ? "目前商店設定後已有付款成功訂單、接受的交易與已處理簽章回呼；付款返回仍需另行核對" : "尚未找到目前商店設定後的已簽章成功交易；設定齊全不代表可收款" },
          ]
        : [{ label: "標準金流", status: "failed", detail: "訂金已啟用，但沒有啟用中的金流商店" }];
    runs.push({ channel: "payment", status: summarize(paymentChecks), checks: paymentChecks });

    const activeDomain = (domainsResult.data ?? []).find((domain) => domain.active && domain.verified_at);
    let publicHost = "";
    try {
      const publicOrigin = process.env.PUBLIC_APP_URL
        ?? process.env.NEXT_PUBLIC_APP_URL
        ?? (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : "");
      publicHost = new URL(publicOrigin).host;
    } catch {
      publicHost = "";
    }
    const resolvedPublicClinicId = clinic.slug && publicHost
      ? await resolvePublicClinicIdFromScope(service, { clinicSlug: clinic.slug, host: publicHost })
      : null;
    const domainChecks: Check[] = activeDomain
      ? [{ label: "自訂網域", status: "passed", detail: `${activeDomain.hostname} 已驗證並啟用` }]
      : clinic.slug && resolvedPublicClinicId === member.clinicId
        ? [{ label: "品牌短網址", status: "passed", detail: `/book/browser?clinic_slug=${clinic.slug} 已通過品牌解析` }]
        : clinic.slug
          ? [{ label: "品牌短網址", status: "failed", detail: `入口無法解析；請將 ${publicHost || "目前服務網域"} 加入 PUBLIC_SHARED_HOSTS` }]
          : [{ label: "公開入口", status: "failed", detail: "品牌短網址與自訂網域皆未完成" }];
    runs.push({ channel: "domain", status: summarize(domainChecks), checks: domainChecks });

    const { error } = await service.from("channel_test_runs").insert(runs.map((run) => ({ clinic_id: member.clinicId, channel: run.channel, status: run.status, checks: run.checks, ran_by: member.user.id })));
    if (error) throw new Error(`保存測試結果失敗：${error.message}`);
  } catch (error) {
    console.error("Channel checks failed", { clinicId: member.clinicId, category: errorCategory(error instanceof Error ? error.message : "") });
    throw new Error("渠道檢查未能確認完成，請重新整理查看結果後再試");
  }
  revalidatePath("/admin/channels");
  redirect("/admin/channels?tested=1");
}
