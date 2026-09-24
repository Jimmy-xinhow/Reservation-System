import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';

const privateMessage='fetch failed 測試姓名 0912345678 private@example.invalid Bearer credential-sentinel';
const names=['reminders','marketing','membership','registration','richmenu','followups','subscription-freezes'];
function fixture(name,mode){
 const logs=[],writes=[],rpcs=[];let calls=0;
 const result=()=>mode==='returned'?{error:{message:privateMessage}}:{data:mode==='partial'?[{id:'brand',schedule_id:'job',clinic_id:'brand',action:'activate'}]:[],error:null};
 const service={from:()=>{calls++;return {select:()=>({eq:async()=>result()})};},rpc:async(method,args)=>{calls++;rpcs.push({method,args});if(method==='process_registration_cron_scope'&&mode==='empty')return {data:{expired:0,expired_appointments:0,expired_membership_payments:0,expired_waitlist_offers:0,released_benefits:0,registration_ids:[],appointment_ids:[],waitlist_ids:[]},error:null};if(method==='finish_line_richmenu_schedule'){writes.push(args);return {error:{message:privateMessage}};}return result();}};
 const context={process:{env:{CRON_SECRET:'test-secret'}},Response,Error,console:{error:(...args)=>logs.push(args)}};
 const cache=new Map();
 function load(path){
  if(cache.has(path))return cache.get(path);
  const exports={};cache.set(path,exports);
  const code=ts.transpileModule(readFileSync(new URL('../'+path,import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(code,{...context,exports,require:key=>{
   if(key==='server-only')return {};
   if(key==='node:crypto')return {randomUUID};
   if(key==='next/server')return {NextResponse:{json:(...args)=>Response.json(...args)}};
   if(key==='./error-category')return load('lib/error-category.ts');
   if(key==='./rate-limit')return {};
   if(key==='@/lib/http')return {...load('lib/http.ts'),getClinicSettings:async()=>{throw Error(privateMessage);}};
   if(key==='@/lib/delivery-error')return load('lib/delivery-error.ts');
   if(key==='@/lib/cron-scope')return load('lib/cron-scope.ts');
   if(key==='@/lib/cron-allowlist')return load('lib/cron-allowlist.ts');
   if(key==='@/lib/supabase')return {createServiceClient:()=>{calls++;if(mode==='thrown')throw Error(privateMessage);return service;}};
   if(key==='@/lib/line-channel')return {getClinicLineChannelContext:async()=>{throw Error(privateMessage);}};
   if(key.endsWith('notifications'))return new Proxy({},{get:()=>async()=>({sent:0,failed:0,skipped:0})});
   return {};
  }});return exports;
 }
 return {...load(`app/api/cron/${name}/route.ts`),logs,writes,rpcs,context,calls:()=>calls};
}
const request=token=>({headers:new Headers(token?{authorization:'Bearer '+token}:{})});
const brandId='11111111-1111-4111-8111-111111111111',jobId='22222222-2222-4222-8222-222222222222';
const scopedRequest=(body,token='test-secret')=>({...request(token),json:async()=>body});
test('allowlisted cron rejects every global route before service access',async()=>{
 for(const name of names){
  const f=fixture(name,'empty');f.context.process.env.CRON_ALLOWED_CLINIC_IDS=brandId;
  assert.equal((await f.GET(request('test-secret'))).status,403);
  assert.equal(f.calls(),0);
 }
});
test('allowlisted cron rejects a foreign scoped brand before service access',async()=>{
 const f=fixture('followups','empty');f.context.process.env.CRON_ALLOWED_CLINIC_IDS=brandId;
 const r=await f.POST(scopedRequest({clinic_id:jobId,followup_ids:[jobId]}));
 assert.equal(r.status,403);assert.equal(f.calls(),0);
});
test('scoped followup rejects unauthorized callers before reading JSON or DB',async()=>{const f=fixture('followups','empty');const r=await f.POST({...request('wrong'),json:async()=>{throw Error('must not read');}});assert.equal(r.status,401);assert.equal(f.calls(),0);});
for(const body of [null,{}, {clinic_id:brandId,followup_ids:[]},{clinic_id:brandId,followup_ids:[jobId,jobId]},{clinic_id:brandId,followup_ids:[null]},{clinic_id:'bad',followup_ids:[jobId]},{clinic_id:brandId,followup_ids:[jobId],all:true},{clinic_id:brandId,followup_ids:Array(101).fill(jobId)}])test('scoped followup rejects invalid input '+JSON.stringify(body).slice(0,100),async()=>{const f=fixture('followups','empty');assert.equal((await f.POST(scopedRequest(body))).status,400);assert.equal(f.calls(),0);});
test('scoped followup uses only exact brand and selected ids RPC',async()=>{const f=fixture('followups','empty');const r=await f.POST(scopedRequest({clinic_id:brandId,followup_ids:[jobId]}));assert.equal(r.status,200);assert.equal((await r.json()).claimed,0);assert.deepEqual(JSON.parse(JSON.stringify(f.rpcs)),[{method:'claim_scheduled_followups_for_clinic',args:{p_clinic_id:brandId,p_followup_ids:[jobId]}}]);});
test('scoped followup DB failure never falls back to global claim',async()=>{const f=fixture('followups','returned');const r=await f.POST(scopedRequest({clinic_id:brandId,followup_ids:[jobId]}));assert.equal(r.status,500);assert.equal(f.rpcs.length,1);assert.equal(f.rpcs[0].method,'claim_scheduled_followups_for_clinic');noPrivate([await r.json(),f.logs]);});

for(const [name,key,rpc,param] of [
 ['richmenu','schedule_ids','claim_line_richmenu_schedules_for_clinic','p_schedule_ids'],
 ['subscription-freezes','subscription_ids','sync_subscription_freezes_for_clinic','p_subscription_ids'],
]) {
 test(name+' scoped authorization precedes JSON and DB',async()=>{const f=fixture(name,'empty');assert.equal((await f.POST({...request('wrong'),json:()=>{throw Error('body read');}})).status,401);assert.equal(f.calls(),0);});
 for(const body of [null,{}, {clinic_id:brandId,[key]:[]},{clinic_id:brandId,[key]:[jobId,jobId]},{clinic_id:brandId,[key]:[jobId],all:true}])test(name+' invalid scope fails closed '+JSON.stringify(body),async()=>{const f=fixture(name,'empty');assert.equal((await f.POST(scopedRequest(body))).status,400);assert.equal(f.calls(),0);});
 test(name+' valid request uses only scoped RPC',async()=>{const f=fixture(name,'empty');assert.equal((await f.POST(scopedRequest({clinic_id:brandId,[key]:[jobId]}))).status,200);assert.deepEqual(JSON.parse(JSON.stringify(f.rpcs)),[{method:rpc,args:{p_clinic_id:brandId,[param]:[jobId]}}]);});
 test(name+' RPC error does not call global fallback',async()=>{const f=fixture(name,'returned');const r=await f.POST(scopedRequest({clinic_id:brandId,[key]:[jobId]}));assert.equal(r.status,500);assert.equal(f.rpcs.length,1);assert.equal(f.rpcs[0].method,rpc);noPrivate([await r.json(),f.logs]);});
}
for(const body of [null,{}, {clinic_id:brandId,automation_ids:[jobId]}, {clinic_id:brandId,patient_ids:[jobId]}, {clinic_id:brandId,automation_ids:[jobId],patient_ids:[]}, {clinic_id:brandId,automation_ids:[jobId,jobId],patient_ids:[jobId]}, {clinic_id:brandId,automation_ids:[jobId],patient_ids:[jobId],all:true}])test('marketing requires both automation and patient selections '+JSON.stringify(body),async()=>{const f=fixture('marketing','empty');assert.equal((await f.POST(scopedRequest(body))).status,400);assert.equal(f.calls(),0);});
test('marketing scoped authorization precedes JSON and DB',async()=>{const f=fixture('marketing','empty');assert.equal((await f.POST({...request('wrong'),json:()=>{throw Error('body read');}})).status,401);assert.equal(f.calls(),0);});
function noPrivate(value){for(const secret of ['測試姓名','0912345678','private@example.invalid','credential-sentinel'])assert(!JSON.stringify(value).includes(secret));}
for(const name of names){
 test(name+' rejects missing/wrong credentials before accessing service',async()=>{
  const f=fixture(name,'thrown');
  for(const token of [undefined,'wrong'])assert.equal((await f.GET(request(token))).status,401);
  f.context.process.env.CRON_SECRET='';assert.equal((await f.GET(request('test-secret'))).status,401);
  assert.equal(f.calls(),0);assert.equal(f.logs.length,0);
 });
 test(name+' returned and thrown failures emit safe 500 with correlation id',async()=>{
  for(const mode of ['returned','thrown']){
   const f=fixture(name,mode),r=await f.GET(request('test-secret')),body=await r.json();
   assert.equal(r.status,500);assert.equal(body.ok,false);assert(body.error_id);
   assert.equal(body.error_id,f.logs[0][1].errorId);assert.equal(f.logs[0][1].category,'connection');noPrivate([body,f.logs]);
  }
 });
 test(name+' empty successful job keeps success response',async()=>{
  const f=fixture(name,'empty'),r=await f.GET(request('test-secret'));
  assert.equal(r.status,200);assert.equal((await r.json()).ok,true);assert.equal(f.logs.length,0);
 });
}
for(const name of ['reminders','marketing','membership'])test(name+' partial brand failure hides details while preserving brand identifier',async()=>{
 const f=fixture(name,'partial'),r=await f.GET(request('test-secret')),body=await r.json();
 assert.equal(r.status,200);assert.equal(body.ok,false);assert.equal(body.errors[0],'brand: delivery_error:connection');noPrivate(body);
});
test('Rich Menu failed job and failed status write expose only safe categories',async()=>{
 const f=fixture('richmenu','partial'),r=await f.GET(request('test-secret')),body=await r.json();
 assert.equal(r.status,200);assert.equal(body.ok,false);assert.equal(body.results[0].schedule_id,'job');
 assert.equal(f.writes[0].p_error,'delivery_error:connection');noPrivate([body,f.writes,f.logs]);
});

const composite={clinic_id:brandId,registration_ids:[jobId],appointment_ids:[],membership_payment_ids:[],waitlist_ids:[]};
test('registration scoped auth precedes body and DB',async()=>{const f=fixture('registration','empty');assert.equal((await f.POST({...request('wrong'),json:()=>{throw Error('body read');}})).status,401);assert.equal(f.calls(),0);});
for(const body of [null,{}, {...composite,registration_ids:[]},{...composite,waitlist_ids:undefined},{...composite,registration_ids:[jobId,jobId.toUpperCase()]},{...composite,waitlist_ids:['bad']},{...composite,all:true}])test('registration scope validation '+JSON.stringify(body),async()=>{const f=fixture('registration','empty');assert.equal((await f.POST(scopedRequest(body))).status,400);assert.equal(f.calls(),0);});
test('registration scope calls one atomic RPC and no global expiry',async()=>{const f=fixture('registration','empty');const r=await f.POST(scopedRequest(composite));assert.equal(r.status,200);assert.equal((await r.json()).ok,true);assert.deepEqual(JSON.parse(JSON.stringify(f.rpcs)),[{method:'process_registration_cron_scope',args:{p_clinic_id:brandId,p_registration_ids:[jobId],p_appointment_ids:[],p_membership_payment_ids:[],p_waitlist_ids:[]}}]);});
test('registration scoped RPC error fails without fallback',async()=>{const f=fixture('registration','returned');const r=await f.POST(scopedRequest(composite));assert.equal(r.status,500);assert.equal(f.rpcs.length,1);noPrivate([await r.json(),f.logs]);});
