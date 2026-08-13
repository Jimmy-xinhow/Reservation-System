import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase";
import { clearDefaultRichMenu, lineAccessTokenForDestination, setDefaultRichMenu } from "@/lib/line";
import { getClinicLineChannelContext } from "@/lib/line-channel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ScheduleJob {
  schedule_id: string;
  clinic_id: string;
  action: "activate" | "expire";
  line_rich_menu_id: string;
  restore_line_rich_menu_id: string | null;
  attempt_count: number;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const service = createServiceClient();
  const { data, error } = await service.rpc("claim_due_line_richmenu_schedules", { p_limit: 10 });
  if (error) return Response.json({ ok: false, error: error.message }, { status: 500 });

  const results: Array<{ schedule_id: string; action: string; ok: boolean; error?: string }> = [];
  for (const job of (data ?? []) as ScheduleJob[]) {
    try {
      const context = await getClinicLineChannelContext(service, job.clinic_id);
      if (!context.enabled || context.verificationStatus !== "ready") throw new Error("品牌 LINE 渠道尚未完成正式驗證");
      const accessToken = lineAccessTokenForDestination(context.destination ?? undefined);
      if (job.action === "activate") await setDefaultRichMenu(job.line_rich_menu_id, accessToken);
      else if (job.restore_line_rich_menu_id) await setDefaultRichMenu(job.restore_line_rich_menu_id, accessToken);
      else await clearDefaultRichMenu(accessToken);

      const { error: finishError } = await service.rpc("finish_line_richmenu_schedule", {
        p_schedule_id: job.schedule_id,
        p_action: job.action,
        p_success: true,
        p_error: null,
      });
      if (finishError) throw new Error(finishError.message);
      results.push({ schedule_id: job.schedule_id, action: job.action, ok: true });
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Rich Menu 排程執行失敗";
      const { error: finishError } = await service.rpc("finish_line_richmenu_schedule", {
        p_schedule_id: job.schedule_id,
        p_action: job.action,
        p_success: false,
        p_error: message,
      });
      results.push({
        schedule_id: job.schedule_id,
        action: job.action,
        ok: false,
        error: finishError ? `${message}；狀態寫回失敗：${finishError.message}` : message,
      });
    }
  }

  return Response.json({ ok: results.every((result) => result.ok), processed: results.length, results });
}
