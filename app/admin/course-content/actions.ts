"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin";
import { createServiceClient } from "@/lib/supabase";

function text(fd: FormData, key: string): string { return String(fd.get(key) ?? "").trim(); }
function safeHttpsUrl(value: string): string | null { if (!value) return null; try { const url = new URL(value); return url.protocol === "https:" ? url.toString() : null; } catch { return null; } }

export async function createCourseUnitAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const service = createServiceClient();
  const eventId = text(fd, "event_id");
  const title = text(fd, "title");
  const summary = text(fd, "summary");
  const unitType = text(fd, "unit_type");
  const accessRule = text(fd, "access_rule");
  const releaseMode = text(fd, "release_mode");
  const releaseDays = Math.max(0, Math.min(3650, Number.parseInt(text(fd, "release_days"), 10) || 0));
  const contentUrlInput = text(fd, "content_url");
  const unitBody = text(fd, "body");
  const sortOrder = Math.max(0, Math.min(999, Number.parseInt(text(fd, "sort_order"), 10) || 0));
  if (!eventId || !title) throw new Error("請選擇課程並填寫單元名稱");
  if (!["video", "link", "download", "text", "quiz", "assignment"].includes(unitType)) throw new Error("教材類型不正確");
  if (!["registered", "paid", "attended"].includes(accessRule)) throw new Error("開放條件不正確");
  if (!["immediate", "days_after_registration", "after_previous"].includes(releaseMode)) throw new Error("分段開放方式不正確");
  const contentUrl = safeHttpsUrl(contentUrlInput);
  if (contentUrlInput && !contentUrl) throw new Error("教材網址必須是有效的 HTTPS 網址");
  if (!["quiz", "assignment"].includes(unitType) && !contentUrl && !unitBody) throw new Error("請填寫教材網址或文字內容");
  const { data: event } = await service.from("events").select("id").eq("id", eventId).eq("clinic_id", member.clinicId).maybeSingle();
  if (!event) throw new Error("課程不屬於目前品牌");
  const { data: unit, error: unitError } = await service.from("course_units").insert({
    clinic_id: member.clinicId, event_id: eventId, title: title.slice(0, 160), summary: summary.slice(0, 500) || null,
    unit_type: unitType, content_url: contentUrl, body: unitBody.slice(0, 10000) || null, access_rule: accessRule,
    release_mode: releaseMode, release_days: releaseDays, sort_order: sortOrder, active: true,
  }).select("id").single();
  if (unitError) throw new Error(unitError.message);
  try {
    if (unitType === "quiz") {
      const prompt = text(fd, "quiz_prompt");
      const options = text(fd, "quiz_options").split(/\r?\n/).map((item) => item.trim()).filter(Boolean).slice(0, 20);
      const correctOption = Number.parseInt(text(fd, "quiz_correct_option"), 10) - 1;
      if (!prompt || options.length < 2 || !Number.isInteger(correctOption) || correctOption < 0 || correctOption >= options.length) throw new Error("測驗需要題目、至少兩個選項，以及正確答案編號");
      const { error } = await service.from("course_assessments").insert({ clinic_id: member.clinicId, event_id: eventId, unit_id: unit.id, kind: "quiz", prompt: prompt.slice(0, 3000), options, correct_option: correctOption, passing_score: 100, active: true });
      if (error) throw new Error(error.message);
    }
    if (unitType === "assignment") {
      const prompt = text(fd, "assignment_prompt");
      if (!prompt) throw new Error("請填寫作業要求");
      const { error } = await service.from("course_assessments").insert({ clinic_id: member.clinicId, event_id: eventId, unit_id: unit.id, kind: "assignment", prompt: prompt.slice(0, 5000), options: [], correct_option: null, passing_score: 100, active: true });
      if (error) throw new Error(error.message);
    }
  } catch (error) {
    await service.from("course_units").delete().eq("id", unit.id).eq("clinic_id", member.clinicId);
    throw error;
  }
  revalidatePath("/admin/course-content");
}

export async function toggleCourseUnitAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const id = text(fd, "id");
  const active = text(fd, "active") === "true";
  if (!id) throw new Error("找不到教材單元");
  const { error } = await createServiceClient().from("course_units").update({ active: !active }).eq("id", id).eq("clinic_id", member.clinicId);
  if (error) throw new Error(error.message);
  revalidatePath("/admin/course-content");
}

export async function reviewCourseAssignmentAction(fd: FormData): Promise<void> {
  const member = await requireAdmin();
  const service = createServiceClient();
  const submissionId = text(fd, "submission_id");
  const result = text(fd, "result");
  if (!submissionId || !["passed", "revision"].includes(result)) throw new Error("作業審核資料不正確");
  const { data: submission, error: findError } = await service.from("course_assessment_submissions").select("id,unit_id,registration_id,patient_id").eq("id", submissionId).eq("clinic_id", member.clinicId).maybeSingle();
  if (findError || !submission) throw new Error(findError?.message ?? "找不到作業提交紀錄");
  const { data: unit, error: unitError } = await service.from("course_units").select("event_id").eq("id", submission.unit_id).eq("clinic_id", member.clinicId).maybeSingle();
  if (unitError || !unit) throw new Error(unitError?.message ?? "找不到作業所屬課程單元");
  const { error } = await service.from("course_assessment_submissions").update({ status: result, score: result === "passed" ? 100 : 0, feedback: text(fd, "feedback").slice(0, 2000) || null, reviewed_by: member.user.id, reviewed_at: new Date().toISOString() }).eq("id", submission.id).eq("clinic_id", member.clinicId);
  if (error) throw new Error(error.message);
  if (result === "passed") {
    const { error: progressError } = await service.from("course_unit_progress").upsert({ clinic_id: member.clinicId, event_id: unit.event_id, unit_id: submission.unit_id, registration_id: submission.registration_id, patient_id: submission.patient_id, completed_at: new Date().toISOString() }, { onConflict: "registration_id,unit_id" });
    if (progressError) throw new Error(progressError.message);
    const { error: certificateError } = await service.rpc("issue_course_certificate_if_complete", { p_clinic_id: member.clinicId, p_registration_id: submission.registration_id });
    if (certificateError) throw new Error(certificateError.message);
  } else {
    await service.from("course_unit_progress").delete().eq("clinic_id", member.clinicId).eq("registration_id", submission.registration_id).eq("unit_id", submission.unit_id);
  }
  revalidatePath("/admin/course-content");
}
