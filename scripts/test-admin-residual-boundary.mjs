import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';import ts from 'typescript';import vm from 'node:vm';import * as crypto from 'node:crypto';
const canary='PRIVATE_NAME 0912345678 private@example.invalid TOKEN_SECRET';
function compile(file,require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,Error,URL,URLSearchParams,Headers,FormData,Buffer,process:{env:{}},console:{error:()=>{throw Error('Unexpected logging');}}});return exports;}
const categories=compile('lib/error-category.ts',()=>({}));const boundary=compile('lib/admin-query.ts',n=>n==='@/lib/error-category'?categories:{});const reportRange=compile('lib/report-range.ts',()=>({}));
function safe(e){assert.match(e.message,/目前無法確認操作結果/);for(const token of canary.split(' '))assert.ok(!e.stack.includes(token));assert.ok(!e.stack.includes('TOKEN_SECRET'));assert.equal(e.cause,undefined);return true;}
function harness(file,{mode='returned',message=canary,code='XX000',data=null,successResults=[]}={}){
 const calls=[],refreshes=[];let awaits=0;
 function chain(){let q; q=new Proxy({}, {get:(_,k)=>k==='then'?(resolve,reject)=>{awaits++;if(awaits<=successResults.length)return Promise.resolve(successResults[awaits-1]).then(resolve,reject);return(mode==='thrown'?Promise.reject(Error(message,{cause:Error(message)})):Promise.resolve({data,error:mode==='success'?null:{message,code},count:0})).then(resolve,reject);}:(...args)=>{calls.push([k,...args]);return q;}});return q;}
 const service={from:(...args)=>{calls.push(['from',...args]);return chain();},rpc:(...args)=>{calls.push(['rpc',...args]);return chain();},auth:{admin:{listUsers:()=>chain(),createUser:()=>chain(),inviteUserByEmail:()=>chain(),getUserById:()=>chain(),updateUserById:()=>chain()},signOut:()=>chain()}};
 const member={supabase:service,clinicId:'own-clinic',user:{id:'actor'},clinics:[],permissions:[],role:'admin',accessType:'brand_admin'};
 const deps={
  'server-only':{},'@/lib/admin-query':boundary,'node:crypto':crypto,
  'next/cache':{revalidatePath:p=>refreshes.push(p)},'next/navigation':{redirect:p=>{throw Error('REDIRECT:'+p);}},
  'next/headers':{cookies:async()=>({set:()=>{throw Error('Unexpected cookie write');}}),headers:async()=>new Headers()},
  '@/lib/admin':new Proxy({hasBrandPermission:()=>true,canOperate:()=>true,canViewSensitiveCustomerData:()=>true},{get:(t,k)=>k in t?t[k]:async()=>member}),
  '@/lib/platform':{requireSystemPermission:async()=>member,requireSystemAdmin:async()=>member,getOptionalPlatformAdmin:async()=>null,PLATFORM_ADD_ONS:[],hasSystemPermission:()=>true},'@/lib/supabase':{createServiceClient:()=>service},'@/lib/supabase-server':{createSupabaseServer:async()=>service},
  '@/lib/report-range':reportRange,'@/lib/supabase-pagination':{fetchAllSupabasePages:async fetchPage=>{const result=await boundary.adminQuery(fetchPage(0,999));if(result.error)throw new Error(boundary.adminErrorMessage(result.error));return result.data??[];}},'@/lib/auth-invite':{authInviteRedirectUrl:()=> 'https://example.invalid'},
  '@/lib/platform-roles':{normalizeSystemPermissions:()=>[]},'@/lib/email':{getEmailCredentialStatus:async()=>({})},'@/lib/payment':{getPaymentSecretStatus:async()=>({})},'@/lib/line-channel':{getClinicLineChannelContext:async()=>({})},
  '@/lib/admin-modules':{isAdminModuleEnabled:async()=>true},
 };
 const api=compile(file,n=>n in deps?deps[n]:{});
 return{api,calls,refreshes,awaits:()=>awaits};
}

const scope=JSON.parse(fs.readFileSync('docs/g3-03-residual-scope-2026-09-22.json'));
for(const {path} of scope.changes.filter(r=>r.path.endsWith('.tsx')))for(const mode of ['returned','thrown'])test(path+': '+mode+' failure blocks rendering',async()=>{
const h=harness(path,{mode});const run=h.api.default??h.api.TrialObservationPanel;await assert.rejects(run({searchParams:Promise.resolve({}),brands:[],canManage:true}),safe);assert.ok(h.awaits()>0);
});
const actions=[
['handoff/actions.ts','createHandoffTaskAction',{title:'test',category:'other',priority:'normal'}],
['handoff/actions.ts','updateHandoffTaskAction',{id:'task',status:'done',priority:'normal'}],
['handoff/attendance-actions.ts','saveAttendanceSettingsAction',{qr_refresh_seconds:'60'}],
['platform/actions.ts','createPlatformBrandAction',{name:'test',slug:'test',owner_email:'test@example.invalid'}],
['platform/actions.ts','setPlatformBrandActiveAction',{clinic_id:'brand',active:'true'}],
['platform/actions.ts','updatePlatformEntitlementAction',{clinic_id:'brand',plan_code:'standard'}],
['platform/admins/actions.ts','upsertPlatformAdminAction',{email:'test@example.invalid'}],
['platform/admins/actions.ts','setPlatformAdminPasswordAction',{user_id:'user',password:'abcdefgh',password_confirmation:'abcdefgh'}],
['platform/admins/actions.ts','setPlatformAdminActiveAction',{user_id:'user',active:'false'}],
['registrations/actions.ts','cancelRegistrationAdminAction',{id:'registration'}],
['registrations/actions.ts','markRegistrationNoShowAction',{id:'registration'}],
['services/addon-actions.ts','updateServiceAddonAction',{id:'addon',name:'test'}],
['services/addon-actions.ts','toggleServiceAddonAction',{id:'addon',active:'true'}],
];
for(const [path,name,values]of actions)for(const mode of ['returned','thrown'])test(name+': '+mode+' failure is safe and stops refresh',async()=>{const h=harness('app/admin/'+path,{mode}),fd=new FormData();for(const[k,v]of Object.entries(values))fd.set(k,v);await assert.rejects(h.api[name](fd),safe);assert.ok(h.awaits()>0);assert.equal(h.refreshes.length,0);});

const empty={data:[],error:null,count:0};
for(const mode of ['returned','thrown'])for(const [label,params,successResults]of [
['list',{},[empty]],['search',{q:'test'},[empty]],['birthday',{q:'0101'},[empty,empty]],['segment',{segment_id:'segment'},[empty]],['counts',{},[empty,{data:[{id:'patient'}],error:null,count:1}]],
])test('patient '+label+': later '+mode+' failure is not zero results',async()=>{const h=harness('app/admin/patients/page.tsx',{mode,successResults});await assert.rejects(h.api.default({searchParams:Promise.resolve(params)}),safe);assert.ok(h.awaits()>successResults.length);});
for(const mode of ['returned','thrown'])test('dashboard: '+mode+' patient count failure is not zero',async()=>{const successResults=[{data:{events_enabled:false,crm_automation_enabled:false,line_channel_enabled:false},error:null},...Array(10).fill(empty)];const h=harness('app/admin/dashboard/page.tsx',{mode,successResults});await assert.rejects(h.api.default({searchParams:Promise.resolve({})}),safe);assert.ok(h.awaits()>11);});
for(const mode of ['returned','thrown'])for(const [path,name,values,successResults]of [
['platform/actions.ts','createPlatformBrandAction',{name:'test',slug:'test',owner_email:'test@example.invalid'},[{data:{users:[]},error:null}]],
['platform/admins/actions.ts','upsertPlatformAdminAction',{email:'test@example.invalid'},[{data:{users:[]},error:null}]],
['platform/admins/actions.ts','setPlatformAdminPasswordAction',{user_id:'user',password:'abcdefgh',password_confirmation:'abcdefgh'},[{data:{user_id:'user'},error:null}]],
['registrations/actions.ts','cancelRegistrationAdminAction',{id:'registration'},[{data:{id:'registration',status:'confirmed'},error:null}]],
])test(name+': later '+mode+' failure stops confirmation',async()=>{const h=harness('app/admin/'+path,{mode,successResults}),fd=new FormData();for(const[k,v]of Object.entries(values))fd.set(k,v);await assert.rejects(h.api[name](fd),safe);assert.equal(h.refreshes.length,0);assert.ok(h.awaits()>successResults.length);});
