import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
const clinic='11111111-1111-4111-8111-111111111111',foreign='22222222-2222-4222-8222-222222222222';
const own='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',other='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',unselected='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
function fixture(name,{inactive=false,fail=false,dbError=false}={}){
 const writes=[],claims=[],sent=[];let calls=0;
 const source={clinics:[{id:clinic,active:!inactive,name:'Synthetic',line_destination:null},{id:foreign,active:true}],appointments:[],patient_memberships:[]};
 for(const [id,clinic_id] of [[own,clinic],[other,foreign],[unselected,clinic]]){
  source.appointments.push({id,clinic_id,status:'booked',start_at:new Date(Date.now()+3600000).toISOString(),patients:{name:'Synthetic',line_user_id:fail?'synthetic-line':null,email:null}});
  source.patient_memberships.push({id,clinic_id,status:'active',patient_id:id,credits_remaining:1,expires_at:null,patients:{name:'Synthetic',line_user_id:null,email:null}});
 }
 function query(table){let filters=[],action=null;
  const q={select:()=>q,eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},gt:(k,v)=>{filters.push(r=>r[k]>v);return q;},lte:(k,v)=>{filters.push(r=>r[k]<=v);return q;},order:()=>q,limit:()=>q,insert:v=>{action=['insert',v];return q;},update:v=>{action=['update',v];return q;},maybeSingle:async()=>{const r=await q;return {...r,data:r.data?.[0]??null};},then:(resolve,reject)=>Promise.resolve().then(()=>{
   if(dbError) return {data:null,error:{message:'synthetic DB failure'}};
   if(action){writes.push({table,action:action[0],value:action[1]});return {data:[{id:'log-'+writes.length}],error:null};}
   return {data:(source[table]??[]).filter(r=>filters.every(f=>f(r))),error:null};
  }).then(resolve,reject)};return q;
 }
 const svc={from:t=>{calls++;return query(t);},rpc:async(method,args)=>{claims.push(args.p_appointment_id);return {data:'claim',error:null};}};
 const cache=new Map();
 function load(path){if(cache.has(path))return cache.get(path);const exports={};cache.set(path,exports);const js=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  vm.runInNewContext(js,{exports,Response,Headers,process:{env:{CRON_SECRET:'secret'}},console:{error:()=>{}},require:key=>{
   if(key==='@/lib/cron-scope')return load('lib/cron-scope.ts');
   if(key==='@/lib/cron-allowlist')return load('lib/cron-allowlist.ts');
   if(key==='@/lib/supabase')return {createServiceClient:()=>{calls++;return svc;}};
   if(key==='@/lib/http')return {getClinicSettings:async()=>({booking_mode:'time',email_enabled:false}),fail:()=>Response.json({ok:false},{status:500})};
   if(key==='@/lib/email')return {emailConfigForClinic:async()=>null,sendEmail:async()=>sent.push('email')};
   if(key==='@/lib/line')return {lineAccessTokenForDestination:async()=>null,pushMessages:async()=>sent.push('line')};
   if(key==='@/lib/line-channel')return {getClinicLineChannelContext:async()=>({clinicSlug:'synthetic'})};
   if(key==='@/lib/customer-entry')return {customerEntryUrl:()=>'/synthetic'};
   if(key==='@/lib/delivery-error')return {deliveryError:()=> 'delivery_error:unknown'};
   return {};
  }});return exports;
 }
 return {...load(`app/api/cron/${name}/route.ts`),writes,claims,sent,calls:()=>calls};
}
const request=(body,token='secret')=>({headers:new Headers({authorization:'Bearer '+token}),json:async()=>body});
for(const [name,key] of [['reminders','appointment_ids'],['membership','membership_ids']]){
 test(name+' rejects auth before JSON or DB',async()=>{const f=fixture(name);assert.equal((await f.POST({...request({},'bad'),json:()=>{throw Error('read body');}})).status,401);assert.equal(f.calls(),0);});
 for(const body of [null,{}, {clinic_id:clinic,[key]:[]},{clinic_id:clinic,[key]:[own,own.toUpperCase()]},{clinic_id:clinic,[key]:[null]},{clinic_id:'bad',[key]:[own]},{clinic_id:clinic,[key]:[own],all:true},{clinic_id:clinic,[key]:Array(101).fill(own)}])test(name+' rejects malformed scope '+JSON.stringify(body).slice(0,95),async()=>{const f=fixture(name);assert.equal((await f.POST(request(body))).status,400);assert.equal(f.calls(),0);});
 test(name+' foreign-only IDs do not process records',async()=>{const f=fixture(name);const r=await f.POST(request({clinic_id:clinic,[key]:[other]}));const b=await r.json();assert.equal(b.scanned??b.candidates,0);assert.equal(f.writes.length,0);assert.equal(f.claims.length,0);assert.equal(f.sent.length,0);});
 test(name+' mixed IDs process own only, not unselected or foreign records',async()=>{const f=fixture(name,{fail:true});const b=await(await f.POST(request({clinic_id:clinic,[key]:[own,other]}))).json();assert.equal(b.scanned??b.candidates,1);if(name==='reminders'){assert.deepEqual(f.claims,[own]);assert.equal(b.lineFailed,1);assert.equal(b.ok,false);}else{assert.equal(f.writes.filter(w=>w.action==='insert').length,2);assert(f.writes.filter(w=>w.action==='insert').every(w=>w.value.patient_membership_id===own));}assert.equal(f.sent.length,0);});
 test(name+' inactive brand does no work',async()=>{const f=fixture(name,{inactive:true});const b=await(await f.POST(request({clinic_id:clinic,[key]:[own]}))).json();assert.equal(b.scanned??b.candidates,0);assert.equal(f.writes.length,0);assert.equal(f.claims.length,0);});
 test(name+' database failure never retries globally',async()=>{const f=fixture(name,{dbError:true});assert.equal((await f.POST(request({clinic_id:clinic,[key]:[own]}))).status,500);assert.equal(f.calls(),2);assert.equal(f.writes.length,0);});
}
