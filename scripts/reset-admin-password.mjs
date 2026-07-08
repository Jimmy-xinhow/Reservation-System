// 後台管理員密碼救援工具(密碼無法還原,只能重設)。
//
// 需要環境變數:NEXT_PUBLIC_SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
//              (可另給 NEXT_PUBLIC_CLINIC_ID 只列本診所)
//
// 用法:
//   列出管理員 Email:
//     node scripts/reset-admin-password.mjs list
//   重設某帳號密碼:
//     node scripts/reset-admin-password.mjs reset <email> <新密碼(至少8碼)>
//
// service role key 從 Railway → 你的服務 → Variables 取得,勿寫進檔案或 commit。

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const clinicId = process.env.NEXT_PUBLIC_CLINIC_ID;

if (!url || !key) {
  console.error("請先設定 NEXT_PUBLIC_SUPABASE_URL 與 SUPABASE_SERVICE_ROLE_KEY 環境變數。");
  process.exit(1);
}

const svc = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const [cmd, arg1, arg2] = process.argv.slice(2);

async function allUsersEmailMap() {
  const { data, error } = await svc.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (error) throw new Error(error.message);
  return new Map((data?.users ?? []).map((u) => [u.id, u.email ?? "(無 email)"]));
}

async function listAdmins() {
  let q = svc.from("clinic_members").select("user_id, role, clinic_id").eq("role", "admin");
  if (clinicId) q = q.eq("clinic_id", clinicId);
  const { data: members, error } = await q;
  if (error) throw new Error(error.message);
  const emap = await allUsersEmailMap();
  if (!members?.length) {
    console.log("查無管理員帳號。");
    return;
  }
  console.log("管理員帳號:");
  for (const m of members) console.log(`  - ${emap.get(m.user_id) ?? "(未知)"}`);
}

async function reset(email, password) {
  if (!email || !password) {
    console.error("用法: node scripts/reset-admin-password.mjs reset <email> <新密碼>");
    process.exit(1);
  }
  if (password.length < 8) {
    console.error("新密碼至少 8 碼。");
    process.exit(1);
  }
  const emap = await allUsersEmailMap();
  const entry = [...emap.entries()].find(([, e]) => e.toLowerCase() === email.toLowerCase());
  if (!entry) {
    console.error(`查無此 Email:${email}`);
    process.exit(1);
  }
  const { error } = await svc.auth.admin.updateUserById(entry[0], { password });
  if (error) {
    console.error("重設失敗:" + error.message);
    process.exit(1);
  }
  console.log(`✅ 已重設 ${email} 的密碼。請立即用新密碼登入後台。`);
}

try {
  if (cmd === "list") await listAdmins();
  else if (cmd === "reset") await reset(arg1, arg2);
  else console.log("用法: node scripts/reset-admin-password.mjs list | reset <email> <新密碼>");
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
