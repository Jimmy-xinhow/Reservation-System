// Local integration only: actual route + isolated PostgreSQL, synthetic LINE identity.
// Start the documented local g305 acceptance cluster before running this script.
import fs from 'node:fs';import {spawn} from 'node:child_process';import vm from 'node:vm';import ts from 'typescript';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const args=['-X','-h','127.0.0.1','-p','55439','-U','g305_test','-d','g305_manual_checkin_v2','-v','ON_ERROR_STOP=1','-At'];
const env={...process.env,PGPASSWORD:fs.readFileSync('tmp/g305-local/password.txt','utf8'),PGCLIENTENCODING:'UTF8'};
const sql=q=>new Promise((resolve,reject)=>{const p=spawn('tmp/tools/postgresql-17.11/pgsql/bin/psql.exe',[...args,'-c',q],{env});let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>code?reject(Error(err)):resolve(out.trim()));});
const quote=v=>v===null?'null':typeof v==='boolean'?String(v):"'"+String(v).replaceAll("'","''")+"'";
const c=crypto.randomUUID(),line='synthetic-'+crypto.randomUUID(),logs=[],results=[];let mode='',insertAttempts=0,crmCalls=0,gateCount=0,releaseGate;
const gate=new Promise(resolve=>releaseGate=resolve);
const service={from:table=>{assert.ok(['chat_messages','patients','chat_blocks'].includes(table));let op='read',value,cols='*',limit='',order='',filters=[];let query;query=new Proxy({}, {get:(_,key)=>key==='then'?(yes,no)=>Promise.resolve().then(async()=>{
 if(op==='insert'){
  if(value.sender==='patient')insertAttempts++;
  const names=Object.keys(value);assert.ok(names.every(n=>/^[a-z_]+$/.test(n)));
  await sql(`insert into public.${table}(${names.join(',')}) values(${names.map(n=>quote(value[n])).join(',')})`);
  if(value.sender==='patient'&&mode==='lost')throw Error('synthetic response lost after commit');
  return{data:null,error:null};
 }
 if(table==='patients'&&mode==='patient')throw Error('synthetic patient lookup failure');
 const rows=JSON.parse(await sql(`select coalesce(json_agg(t),'[]'::json) from (select ${cols} from public.${table}${filters.length?' where '+filters.join(' and '):''}${order}${limit}) t`));
 // Both callers must finish the missing-key read before either attempts INSERT.
 if(mode==='race'&&filters.some(f=>f.startsWith('id ='))&&gateCount<2){gateCount++;if(gateCount===2)releaseGate();await gate;}
 return{data:rows[0]??null,error:null};
 }).then(yes,no):(...a)=>{if(key==='insert'){op='insert';value=a[0];}else if(key==='select'){assert.match(a[0],/^[a-z_, ]+$/);cols=a[0];}else if(key==='eq'){assert.match(a[0],/^[a-z_]+$/);filters.push(`${a[0]} = ${quote(a[1])}`);}else if(key==='order'){assert.equal(a[0],'created_at');order=' order by created_at';}else if(key==='limit'){limit=' limit '+Number(a[0]);}return query;}});return query;}};
const deps={'node:crypto':crypto,'next/server':{NextResponse:{json:Response.json}},'@/lib/supabase':{createServiceClient:()=>service},'@/lib/public-brand':{resolvePublicClinicId:async()=>c},'@/lib/line-channel':{verifyClinicLiffIdToken:async()=>({sub:line})},'@/lib/rate-limit':{checkRateLimit:async()=>({allowed:true})},'@/lib/queue':{isClinicOpenNow:async()=>true},'@/lib/crm-interactions':{recordCrmInteraction:async()=>{crmCalls++;}}};
function load(path){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Response,Error,console:{error:(...v)=>logs.push(v)},require:n=>deps[n]??{}});return exports;}
deps['./error-category']=load('lib/error-category.ts');deps['@/lib/delivery-error']=load('lib/delivery-error.ts');deps['@/lib/http']=load('lib/http.ts');const api=load('app/api/chat/send/route.ts');
const send=messageId=>api.POST({json:async()=>({idToken:'synthetic',messageId,body:'Synthetic integration message'})});
await sql(`insert into clinics(id,name,slug) values('${c}','Customer chat synthetic','chat-${c}');insert into patients(clinic_id,line_user_id,name,phone) values('${c}','${line}','Synthetic','0900000000');`);
try {
 for(const scenario of ['lost','patient','race']){
  mode=scenario;const id=crypto.randomUUID(),before=insertAttempts,beforeCrm=crmCalls;
  const responses=scenario==='race'?await Promise.all([send(id),send(id)]):[await send(id)];
  for(const r of responses)assert.deepEqual((await r.json()).data,{sent:true});
  mode='';assert.deepEqual((await(await send(id)).json()).data,{sent:true});
  const rows=Number(await sql(`select count(*) from chat_messages where id='${id}' and clinic_id='${c}' and line_user_id='${line}' and sender='patient'`));assert.equal(rows,1);
  assert.equal(insertAttempts-before,scenario==='race'?2:1);assert.equal(crmCalls-beforeCrm,scenario==='race'?1:0);
  results.push({scenario,actualRoute:true,actualPostgres:true,insertAttempts:insertAttempts-before,storedRows:rows,crmCalls:crmCalls-beforeCrm,retryStoredNoExtraRows:true});
 }
} finally {
 await sql(`delete from chat_messages where clinic_id='${c}';delete from patients where clinic_id='${c}';delete from clinic_settings where clinic_id='${c}';delete from brand_entitlements where clinic_id='${c}';delete from attendance_settings where clinic_id='${c}';delete from clinic_activation_metrics where clinic_id='${c}';delete from clinics where id='${c}';`);
}
const cleanup=Number(await sql(`select count(*) from clinics where id='${c}'`));assert.equal(cleanup,0);
fs.writeFileSync('docs/g3-03-customer-chat-postgres-2026-09-22.json',JSON.stringify({capturedAt:new Date().toISOString(),scope:'local PostgreSQL 17.11 + actual route; LINE verification and CRM helper stubbed; synthetic rows only',results,fixtureClinicsRemaining:cleanup,realMessages:0},null,2)+'\n');console.log({results,fixtureClinicsRemaining:cleanup});
