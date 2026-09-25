export function parsePublicPatientInput(body: unknown):
  | { ok: true; name: string; phone: string; birthday: string }
  | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "請求格式錯誤" };
  const value = body as Record<string, unknown>;
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const phone = typeof value.phone === "string" ? value.phone.trim() : "";
  const birthday = typeof value.birthday === "string" ? value.birthday.trim() : "";
  if (!name) return { ok: false, error: "請填寫姓名" };
  if (!phone) return { ok: false, error: "請填寫電話" };
  if (name.length > 100 || phone.length > 40) return { ok: false, error: "資料長度不正確" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthday)) return { ok: false, error: "請填寫出生年月日" };
  const date = new Date(`${birthday}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== birthday || birthday.startsWith("0000")) {
    return { ok: false, error: "出生年月日無效，請確認日期" };
  }
  return { ok: true, name, phone, birthday };
}
