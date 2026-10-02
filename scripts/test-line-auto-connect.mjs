import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = fs.readFileSync(new URL("../app/admin/line-actions.ts", import.meta.url), "utf8");
const start = source.indexOf("export async function saveLineCredentialsAction(fd: FormData) {");
const end = source.indexOf("function normalizedWebhookUrl(value: string): string {", start);
assert.ok(start >= 0 && end > start);
const compiled = ts.transpileModule(source.slice(start, end), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const destination = "U0123456789abcdef0123456789abcdef";
const accessToken = "test-channel-access-token-0123456789";
const channelSecret = "0123456789abcdef0123456789abcdef";

function fixture({ channelDestination = null, mode = "shared", otherClinic = null, botUserId = destination, botError = null, vaultError = null } = {}) {
  const calls = [];
  const rows = {
    clinic_line_channels: { connection_mode: mode, login_channel_id: "2011791955", liff_id: "2011791955-NSoHZLP8", liff_endpoint_path: "/book" },
    clinics: { line_destination: channelDestination },
    clinic_line_secret_refs: null,
    clinic_settings: { line_channel_enabled: true },
  };
  const service = {
    from(table) {
      const query = {
        select() { return this; },
        eq() { return this; },
        neq() { return this; },
        async maybeSingle() { return { data: table === "clinics" && calls.includes("checking-other-clinic") ? otherClinic : rows[table], error: null }; },
      };
      if (table === "clinics") {
        query.neq = () => { calls.push("checking-other-clinic"); return query; };
      }
      return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      return { error: vaultError };
    },
  };
  const supabase = {
    async rpc(name, args) { calls.push({ name, args }); return { error: null }; },
  };
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    str: (fd, key) => String(fd.get(key) ?? "").trim(),
    requireBrandAdmin: async () => ({ supabase, clinicId: "qa-brand", user: { id: "qa-owner" } }),
    createServiceClient: () => service,
    getBotInfo: async () => { if (botError) throw botError; return { userId: botUserId }; },
    deliveryError: () => "SAFE_ERROR",
    revalidatePath: () => {},
    redirect: (url) => { throw Object.assign(new Error("redirect"), { url }); },
  });
  const fd = new FormData();
  fd.set("line_access_token", accessToken);
  fd.set("line_channel_secret", channelSecret);
  return { action: exports.saveLineCredentialsAction, fd, calls };
}

test("first-time LINE setup derives Bot destination, stores credentials while disabled, then enables brand", async () => {
  const f = fixture();
  await assert.rejects(() => f.action(f.fd), (error) => error.url === "/admin/line?credentials=saved");
  const writes = f.calls.filter((call) => typeof call === "object");
  assert.deepEqual(writes.map((call) => call.name), ["update_clinic_line_channel", "save_clinic_line_credentials", "update_clinic_line_channel"]);
  assert.equal(writes[0].args.p_enabled, false);
  assert.equal(writes[0].args.p_destination, destination);
  assert.equal(writes[1].args.p_access_token, accessToken);
  assert.equal(writes[1].args.p_channel_secret, channelSecret);
  assert.equal(writes[2].args.p_enabled, true);
});

test("existing brand cannot silently switch to another LINE Bot", async () => {
  const f = fixture({ channelDestination: "Uffffffffffffffffffffffffffffffff", mode: "brand" });
  await assert.rejects(() => f.action(f.fd), /另一個 LINE 官方帳號/);
  assert.equal(f.calls.filter((call) => typeof call === "object").length, 0);
});

test("LINE Bot already owned by another brand is rejected before any write", async () => {
  const f = fixture({ otherClinic: { id: "other-brand" } });
  await assert.rejects(() => f.action(f.fd), /已連接其他品牌/);
  assert.equal(f.calls.filter((call) => typeof call === "object").length, 0);
});

test("invalid LINE token does not expose provider error or write credentials", async () => {
  const f = fixture({ botError: new Error("PRIVATE_PROVIDER_TOKEN_ERROR") });
  await assert.rejects(() => f.action(f.fd), (error) => !error.message.includes("PRIVATE_PROVIDER_TOKEN_ERROR") && /無法以這組訊息授權碼/.test(error.message));
  assert.equal(f.calls.filter((call) => typeof call === "object").length, 0);
});

test("Vault failure leaves the newly connected brand disabled", async () => {
  const f = fixture({ vaultError: { message: "PRIVATE_VAULT_ERROR" } });
  await assert.rejects(() => f.action(f.fd), (error) => !error.message.includes("PRIVATE_VAULT_ERROR"));
  const writes = f.calls.filter((call) => typeof call === "object");
  assert.deepEqual(writes.map((call) => call.name), ["update_clinic_line_channel", "save_clinic_line_credentials"]);
  assert.equal(writes[0].args.p_enabled, false);
});

test("switching from shared mode requires both fresh credentials", async () => {
  const f = fixture();
  f.fd.delete("line_channel_secret");
  await assert.rejects(() => f.action(f.fd), /訊息授權碼與渠道驗證密鑰都必須填寫/);
  assert.equal(f.calls.filter((call) => typeof call === "object").length, 0);
});
