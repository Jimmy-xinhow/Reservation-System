import assert from "node:assert/strict";
import { createCipheriv, createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";


const source = readFileSync(new URL("../lib/payment.ts", import.meta.url), "utf8").replace('import "server-only";', "");
const categorySource = readFileSync(new URL("../lib/error-category.ts", import.meta.url), "utf8");
const categoryUrl = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(categorySource, {compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText).toString("base64");
const querySource = readFileSync(new URL("../lib/admin-query.ts", import.meta.url), "utf8").replace('import "server-only";', "").replace('"@/lib/error-category"', JSON.stringify(categoryUrl));
const queryUrl = "data:text/javascript;base64," + Buffer.from(ts.transpileModule(querySource, {compilerOptions:{module:ts.ModuleKind.ES2022}}).outputText).toString("base64");
const { outputText } = ts.transpileModule(source.replace('"@/lib/admin-query"', JSON.stringify(queryUrl)), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } });
const payment = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
const paymentModule = `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`;
// Synthetic keys: never usable at a gateway. Exercises actual AES/SHA implementation.
const settings = { clinic_id: "synthetic", merchant_id: "TESTMERCHANT", provider: "newebpay", environment: "test", active: true,
  hash_key: "a".repeat(32), hash_iv: "b".repeat(16) };
const payload = { Status: "SUCCESS", Message: "test", Result: { MerchantID: "TESTMERCHANT", MerchantOrderNo: "REG_TEST1234", TradeNo: "1234567890", Amt: 100 } };
function signed(value) {
  const cipher = createCipheriv("aes-256-cbc", Buffer.from(settings.hash_key), Buffer.from(settings.hash_iv));
  const TradeInfo = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]).toString("hex");
  const TradeSha = createHash("sha256").update(`HashKey=${settings.hash_key}&TradeInfo=${TradeInfo}&HashIV=${settings.hash_iv}`).digest("hex").toUpperCase();
  return { MerchantID: settings.merchant_id, TradeInfo, TradeSha };
}
const parse = value => payment.parseNewebpayPaymentResult(value, settings.merchant_id);

test("expired appointment receipt is recorded without allowing failed/refunded orders or late failures to change paid state", async () => {
  const mocks = `export const findPaymentOrderByMerchant=async db=>({...db.order});
    export const mergePaymentProviderEvent=(old,no,event)=>({...old,last_event:event});`;
  const mockUrl = `data:text/javascript;base64,${Buffer.from(mocks).toString("base64")}`;
  const code = ts.transpileModule(readFileSync(new URL("../lib/payment-webhook.ts", import.meta.url), "utf8").replace('import "server-only";', ""), {compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace('"./payment-order-lookup"', JSON.stringify(mockUrl));
  const {processPaymentWebhook}=await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
  for(const [status,success,expected,changed,expiryRace] of [["pending",true,"paid",true,true],["expired",true,"paid",true],["expired",false,"expired",false],["paid",false,"paid",false],["failed",true,"failed",false],["refunded",true,"refunded",false]]){
    const writes=[];
    const db={expiryRace:Boolean(expiryRace),order:{id:"order",clinic_id:"brand",appointment_id:"appointment",amount:100,status,provider:"ecpay",provider_payload:{}},
      rpc:async(name,args)=>{writes.push({rpc:name});if(name==='transition_verified_payment'){
        if(db.expiryRace){db.expiryRace=false;db.order.status='expired';return {data:false,error:null};}
        if(db.order.status!==args.p_expected_status)return {data:false,error:null};
        writes.push({table:'payment_status_events',patch:{from_status:db.order.status,to_status:args.p_success?'paid':'failed'}});
        db.order.status=args.p_success?'paid':'failed';return {data:true,error:null};
      }return {error:null}},
      from(table){let op,patch;const filters=[];const result=()=>{if(op==="update"&&table==="payment_orders"){
        if(db.expiryRace){db.expiryRace=false;db.order.status="expired";return {data:null,error:null};}
        if(filters.some(([k,v])=>db.order[k]!==v))return {data:null,error:null};Object.assign(db.order,patch);
      }if(op==="insert"&&table==="payment_transactions"&&writes.some(w=>w.table===table))return {data:null,error:{code:"23505"}};
      writes.push({table,op,patch});return {data:["payment_orders","payment_webhook_events"].includes(table)?{id:"order"}:null,error:null}};
      const q={insert(p){op="insert";patch=p;return q},update(p){op="update";patch=p;return q},eq(k,v){filters.push([k,v]);return q},select(){return q},maybeSingle:async()=>result(),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject)}};return q;}};
    const result=await processPaymentWebhook(db,{provider:"ecpay",clinicId:"brand",merchantOrderNo:"ORDER1234",providerTransactionNo:"TX",eventKey:"EVENT",success,amount:100,payload:{}});
    assert.equal(db.order.status,expected);assert.equal(result.changed,changed);
    assert.equal(writes.filter(w=>w.table==="payment_transactions").length,changed?1:0);
    if(changed){assert.ok(writes.some(w=>w.rpc==="confirm_appointment_payment"));assert.ok(writes.some(w=>w.table==="payment_status_events"&&w.patch.from_status==="expired"&&w.patch.to_status==="paid"));}
  }
});

test("audit transaction and processed marker failures cannot return success", async () => {
  const mock = 'data:text/javascript;base64,' + Buffer.from('export const findPaymentOrderByMerchant=async db=>db.order;').toString('base64');
  const code=ts.transpileModule(readFileSync(new URL('../lib/payment-webhook.ts',import.meta.url),'utf8').replace('import "server-only";',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace('"./payment-order-lookup"',JSON.stringify(mock));
  const {processPaymentWebhook}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  for(const failure of ['audit','processed','missing']){
    let marked=0;
    const db={order:{id:'order',clinic_id:'brand',status:'pending',amount:100,provider_payload:{}},
      rpc:async()=>failure==='audit'?{error:{message:'audit unavailable'}}:{data:true,error:null},
      from(table){let op;const result=()=>{
        if(op==='update'){marked++;return failure==='missing'?{data:null,error:null}:{error:{message:'processed unavailable'}};}
        return {error:null};
      };const q={insert(){op='insert';return q;},update(){op='update';return q;},eq(){return q;},select(){return q;},maybeSingle:async()=>result(),then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};return q;}};
    await assert.rejects(processPaymentWebhook(db,{provider:'ecpay',clinicId:'brand',merchantOrderNo:'ORDER',providerTransactionNo:'TX',eventKey:'EVENT',success:true,amount:100,payload:{}}),failure==='audit'?/audit unavailable/:failure==='processed'?/processed unavailable/:/不存在/);
    assert.equal(marked,failure==='audit'?0:1);
  }
});

test("both providers persist only normalized receipts in all three payment sinks", async () => {
  const mock='data:text/javascript;base64,'+Buffer.from('export const findPaymentOrderByMerchant=async db=>db.order;').toString('base64');
  const code=ts.transpileModule(readFileSync(new URL('../lib/payment-webhook.ts',import.meta.url),'utf8').replace('import "server-only";',''),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}}).outputText.replace('"./payment-order-lookup"',JSON.stringify(mock));
  const {processPaymentWebhook}=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  for(const provider of ['ecpay','newebpay']){
    const receipts=[];
    const db={order:{id:'order',clinic_id:'brand',status:'pending',amount:100},rpc:async(name,args)=>{assert.equal(name,'transition_verified_payment');receipts.push(args.p_payload);return {data:true,error:null};},
      from(table){const q={insert(body){receipts.push(body.payload);return Promise.resolve({error:null});},update(){return q;},eq(){return q;},select(){return q;},maybeSingle:async()=>({data:{id:'event'},error:null})};return q;}};
    const payload={Name:'PII_SENTINEL',Email:'private@example.invalid',CheckMacValue:'SIGNATURE_SENTINEL',Result:{Card6No:'123456',Card4No:'7890'},extra:{token:'TOKEN_SENTINEL'}};
    await processPaymentWebhook(db,{provider,clinicId:'brand',merchantOrderNo:'ORDER',providerTransactionNo:'TX',eventKey:'EVENT',success:true,amount:100,payload});
    assert.equal(receipts.length,3);
    for(const receipt of receipts){
      assert.deepEqual(Object.keys(receipt).sort(),['amount','event_key','merchant_order_no','payload_sha256','provider','provider_transaction_no','receipt_version','success']);
      assert.equal(receipt.payload_sha256,createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
      assert.equal(receipt.provider,provider);assert.equal(receipt.amount,100);assert.equal(receipt.success,true);
      for(const privateValue of ['PII_SENTINEL','private@example.invalid','SIGNATURE_SENTINEL','TOKEN_SENTINEL','Card6No'])assert(!JSON.stringify(receipt).includes(privateValue));
    }
  }
});

test("payment credential status never decrypts or returns a secret", async () => {
  const db={rpc:()=>{throw Error('status must not decrypt');},from:()=>({select:fields=>{assert.equal(fields,'updated_at');return {eq:()=>({maybeSingle:async()=>({data:{updated_at:'2026-09-20'},error:null})})};}})};
  assert.deepEqual(await payment.getPaymentSecretStatus(db,'brand'),{configured:true,source:'vault',updatedAt:'2026-09-20'});
});

test("Vault failure cannot silently fall back to environment payment credentials", async () => {
  const previous=process.env.PAYMENT_SECRETS_JSON;
  process.env.PAYMENT_SECRETS_JSON=JSON.stringify({brand:{hashKey:'fallback-key',hashIv:'fallback-iv'}});
  try{
    const db={rpc:async()=>({error:{message:'vault unavailable'}}),from:()=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:{clinic_id:'brand',provider:'ecpay',merchant_id:'test',environment:'test',active:true},error:null})};return q;}};
    await assert.rejects(payment.getPaymentSettings(db,'brand'),e=>e.message.includes('目前無法確認操作結果')&&!e.message.includes('vault unavailable')&&!e.cause);
  }finally{if(previous===undefined)delete process.env.PAYMENT_SECRETS_JSON;else process.env.PAYMENT_SECRETS_JSON=previous;}
});

test("MPG signed JSON nested Result succeeds without undocumented ResultCode", () => {
  const decoded = payment.decryptAndVerifyNewebpay(signed(payload), settings);
  assert.deepEqual(parse(decoded), { merchantOrderNo: "REG_TEST1234", tradeNo: "1234567890", amount: 100, success: true, eventKey: "REG_TEST1234:1234567890:SUCCESS" });
});
test("MPG failure uses signed Status; unsigned outer Status cannot mark paid", () => {
  const fields = { ...signed({ ...payload, Status: "CREDITCARD_DECLINED" }), Status: "SUCCESS" };
  assert.equal(parse(payment.decryptAndVerifyNewebpay(fields, settings)).success, false);
});
test("tampered SHA or ciphertext fails before transaction processing", () => {
  const fields = signed(payload);
  assert.throws(() => payment.decryptAndVerifyNewebpay({ ...fields, TradeSha: "0".repeat(64) }, settings));
  assert.throws(() => payment.decryptAndVerifyNewebpay({ ...fields, TradeInfo: "00" + fields.TradeInfo.slice(2) }, settings));
});
test("MPG rejects flattened, missing, array or foreign-merchant transaction data", () => {
  for (const value of [{ Status: "SUCCESS", ...payload.Result }, { ...payload, Result: null }, { ...payload, Result: [] }, { ...payload, Result: { ...payload.Result, MerchantID: "OTHER" } }]) assert.throws(() => parse(value));
});
test("MPG rejects malformed money, missing order, missing status and missing success transaction ID", () => {
  for (const Amt of [null, false, "", "1e2", "100.5", -1, 0, 1.5, Number.MAX_SAFE_INTEGER + 1]) assert.throws(() => parse({ ...payload, Result: { ...payload.Result, Amt } }));
  assert.equal(parse({ ...payload, Result: { ...payload.Result, Amt: "100" } }).amount, 100);
  for (const patch of [{ MerchantOrderNo: "" }, { TradeNo: "" }]) assert.throws(() => parse({ ...payload, Result: { ...payload.Result, ...patch } }));
  assert.throws(() => parse({ ...payload, Status: "" }));
});
test("replayed signed payload produces the same deduplication key", () => {
  const fields = signed(payload);
  const first = parse(payment.decryptAndVerifyNewebpay(fields, settings));
  const second = parse(payment.decryptAndVerifyNewebpay(fields, settings));
  assert.equal(first.eventKey, second.eventKey);
  assert.notEqual(first.eventKey, parse({ ...payload, Status: "CREDITCARD_DECLINED" }).eventKey);
});
test("test checkout forms select only official sandbox hosts", () => {
  const args = { settings, merchantOrderNo: "REG_TEST1234", amount: 100, itemName: "測試", returnUrl: "https://example.test/return", notifyUrl: "https://example.test/notify", clientBackUrl: "https://example.test/back" };
  assert.equal(new URL(payment.createNewebpayForm(args).action).hostname, "ccore.newebpay.com");
  const form = payment.createEcpayForm(args);
  assert.equal(new URL(form.action).hostname, "payment-stage.ecpay.com.tw");
  assert.equal(payment.verifyEcpay(form.fields, settings), true);
  assert.equal(payment.verifyEcpay({ ...form.fields, TotalAmount: "1" }, settings), false);
});

async function routeModule(path) {
  const mocks = `export * from ${JSON.stringify(paymentModule)};
    export const createServiceClient=()=>({});
    export const getPaymentSettingsByMerchant=async()=>(${JSON.stringify(settings)});
    export const processPaymentWebhook=async(_db,event)=>{globalThis.__g203Events.push(event);return {changed:false,accepted:event.success,duplicate:false}};
    export const findPaymentOrderByMerchant=async()=>null;
    export const notifyRegistrationStatus=async()=>{};
    export const notifyAppointmentStatus=async()=>{};
    export const notificationKindForStatus=()=>null;`;
  const mockUrl = `data:text/javascript;base64,${Buffer.from(mocks).toString("base64")}`;
  const code = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText
    .replace(/from "@\/lib\/[^\"]+"/g, () => `from ${JSON.stringify(mockUrl)}`)
    .replace('from "next/server"', `from ${JSON.stringify(new URL("../node_modules/next/server.js", import.meta.url).href)}`);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}
test("notify and browser return routes use the same verified MPG event; POST returns 303 GET redirect", async () => {
  globalThis.__g203Events = [];
  const notify = await routeModule("../app/api/payment/newebpay/notify/route.ts");
  const returned = await routeModule("../app/api/payment/return/route.ts");
  const query = "https://example.test/api/payment/return?provider=newebpay&order=REG_TEST1234&clinic_slug=test-brand";
  const request = () => ({ nextUrl: new URL(query), formData: async () => new URLSearchParams(signed(payload)) });
  const notification = await notify.POST(request());
  assert.equal(notification.status, 200);
  assert.equal(await notification.text(), "OK");
  const response = await returned.POST(request());
  assert.equal(response.status, 303);
  const location = new URL(response.headers.get("location"));
  assert.equal(location.pathname, "/payment/result");
  assert.equal(location.searchParams.get("clinic_slug"), "test-brand");
  assert.equal(location.searchParams.get("state"), "returned");
  assert.equal(globalThis.__g203Events.length, 2);
  assert.deepEqual(globalThis.__g203Events[0], globalThis.__g203Events[1]);
  assert.equal(globalThis.__g203Events[0].success, true);
  delete globalThis.__g203Events;
});

test("ECPay signed SimulatePaid delivery probes never change payment state via either route", async () => {
  globalThis.__g203Events = [];
  const fields = { MerchantID: settings.merchant_id, MerchantTradeNo: "REG_TEST1234", TradeNo: "12345", RtnCode: "1", TradeAmt: "100", SimulatePaid: "1" };
  const content = Object.entries(fields).sort(([a],[b]) => a.toLowerCase().localeCompare(b.toLowerCase())).map(([k,v]) => `${k}=${v}`).join("&");
  const encoded = encodeURIComponent(`HashKey=${settings.hash_key}&${content}&HashIV=${settings.hash_iv}`).toLowerCase().replace(/%20/g,"+");
  const CheckMacValue = createHash("sha256").update(encoded).digest("hex").toUpperCase();
  const request = () => ({ nextUrl: new URL("https://example.test/api/payment/return?provider=ecpay&order=REG_TEST1234&clinic_slug=test-brand"), formData: async () => new URLSearchParams({ ...fields, CheckMacValue }) });
  const notify = await routeModule("../app/api/payment/ecpay/notify/route.ts");
  const returned = await routeModule("../app/api/payment/return/route.ts");
  assert.equal(await (await notify.POST(request())).text(), "1|OK");
  assert.equal((await returned.POST(request())).status, 303);
  assert.equal(globalThis.__g203Events.length, 0);
  delete globalThis.__g203Events;
});
