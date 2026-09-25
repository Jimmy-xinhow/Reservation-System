import type { NextRequest } from "next/server";

export interface CronRecordScope { clinicId: string; recordIds: string[]; }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** An invalid manual request must never degrade into a global cron run. */
export async function readCronRecordScope(req: NextRequest, idsKey: string): Promise<CronRecordScope | Response> {
  const scope = await readCronSelections(req, [idsKey]);
  if (scope instanceof Response) return scope;
  return { clinicId: scope.clinicId, recordIds: scope.selections[idsKey] };
}

export async function readCronSelections(req: NextRequest, idsKeys: readonly string[], allowEmptySelections = false): Promise<{ clinicId: string; selections: Record<string, string[]> } | Response> {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("unauthorized", { status: 401 });
  const body: unknown = await req.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return invalidScope();
  const input = body as Record<string, unknown>;
  if (Object.keys(input).some(key => !["clinic_id", ...idsKeys].includes(key)) ||
      typeof input.clinic_id !== "string" || !uuid.test(input.clinic_id)) return invalidScope();
  const selections: Record<string, string[]> = {};
  for (const key of idsKeys) {
    const ids = input[key];
    if (!Array.isArray(ids) || ids.length < (allowEmptySelections ? 0 : 1) || ids.length > 100 ||
      ids.some(id => typeof id !== "string" || !uuid.test(id)) ||
      new Set(ids.map(id => String(id).toLowerCase())).size !== ids.length) return invalidScope();
    selections[key] = ids.map(id => String(id).toLowerCase());
  }
  if (Object.values(selections).every(ids => ids.length === 0)) return invalidScope();
  return { clinicId: input.clinic_id.toLowerCase(), selections };
}

function invalidScope(): Response {
  return Response.json({ ok: false, error: "請指定品牌與 1 至 100 筆不重複的紀錄" }, { status: 400 });
}
