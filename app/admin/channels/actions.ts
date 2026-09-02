"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { emailConfigForClinic } from "@/lib/email";
import { getBotInfo, lineAccessTokenForDestination } from "@/lib/line";
import { getClinicLineChannelContext } from "@/lib/line-channel";
import { getPaymentSettings } from "@/lib/payment";
import { resolvePublicClinicIdFromScope } from "@/lib/public-brand";
import { createServiceClient } from "@/lib/supabase";

type CheckStatus = "passed" | "warning" | "failed";
interface Check { label: string; status: CheckStatus; detail: string; }
interface Run { channel: "line" | "liff" | "email" | "payment" | "domain"; status: CheckStatus; checks: Check[]; }

function summarize(checks: Check[]): CheckStatus {
  if (checks.some((check) => check.status === "failed")) return "failed";
  if (checks.some((check) => check.status === "warning")) return "warning";
  return "passed";
}

export async function runChannelTestsAction(): Promise<void> {
  const member = await requireAdmin();
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
  else {
    try {
      const token = lineAccessTokenForDestination(clinic.line_destination ?? undefined);
      const bot = await getBotInfo(token);
      lineChecks.push({ label: "Messaging API", status: "passed", detail: `${bot.displayName}（${bot.basicId ?? "無 Basic ID"}）` });
      lineChecks.push({ label: "回應模式", status: bot.chatMode === "bot" ? "passed" : "warning", detail: bot.chatMode === "bot" ? "Bot 模式已啟用" : `目前為 ${bot.chatMode}` });
    } catch (error) {
      lineChecks.push({ label: "Messaging API", status: "failed", detail: error instanceof Error ? error.message.slice(0, 240) : "無法連線 LINE" });
    }
  }
  runs.push({ channel: "line", status: summarize(lineChecks), checks: lineChecks });

  const liffChecks: Check[] = [
    { label: "LIFF ID", status: lineContext.liffId ? "passed" : "failed", detail: lineContext.liffId ? "已設定（不顯示完整識別碼）" : "尚未設定" },
    { label: "Login Channel", status: lineContext.loginChannelId ? "passed" : "failed", detail: lineContext.loginChannelId ? "已設定" : "尚未設定" },
    { label: "Endpoint", status: lineContext.liffEndpointPath.startsWith("/") ? "passed" : "failed", detail: lineContext.liffEndpointPath },
    { label: "渠道驗證", status: lineContext.verificationStatus === "ready" ? "passed" : "warning", detail: lineContext.verificationStatus === "ready" ? "後端驗證已通過" : "仍需執行 LINE 頁面的渠道驗證" },
  ];
  runs.push({ channel: "liff", status: summarize(liffChecks), checks: liffChecks });

  const emailConfig = emailConfigForClinic(member.clinicId);
  const emailChecks: Check[] = !settings.email_enabled
    ? [{ label: "Email 提醒", status: "warning", detail: "品牌尚未啟用 Email" }]
    : [
        { label: "Email 寄送授權", status: emailConfig?.apiKey ? "passed" : "failed", detail: emailConfig?.apiKey ? "私密授權資料已設定" : "尚未設定 Email 寄送服務授權" },
        { label: "寄件人", status: emailConfig?.from ? "passed" : "failed", detail: emailConfig?.from ? emailConfig.from : "缺少寄件人" },
      ];
  runs.push({ channel: "email", status: summarize(emailChecks), checks: emailChecks });

  const paymentChecks: Check[] = !settings.deposit_enabled && !payment
    ? [{ label: "標準金流", status: "warning", detail: "未啟用訂金或金流" }]
    : payment
      ? [
          { label: "商店設定", status: "passed", detail: `${payment.provider === "ecpay" ? "綠界" : "藍新"} · ${payment.environment === "production" ? "正式" : "測試"}` },
          { label: "付款驗證資料", status: payment.hash_key && payment.hash_iv ? "passed" : "failed", detail: payment.hash_key && payment.hash_iv ? "私密授權資料已設定" : "尚未設定付款驗證資料" },
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
  revalidatePath("/admin/channels");
  redirect("/admin/channels?tested=1");
}
