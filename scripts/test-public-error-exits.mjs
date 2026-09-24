import fs from 'node:fs';import vm from 'node:vm';import ts from 'typescript';import crypto from 'node:crypto';import assert from 'node:assert/strict';import test from 'node:test';
const canary='SYNTHETIC_PRIVATE_NAME 0900000000 private@example.invalid SYNTHETIC_SECRET';
const paths=['app/api/admin/calendar/route.ts','app/api/admin/attendance/qr/route.ts','app/api/admin/upload/route.ts','app/sign/[token]/page.tsx','app/sign/[token]/actions.ts'];
function load(file,deps,logs){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,Error,URL,Buffer,File,FormData,Response,console:{error:(...args)=>logs.push(args)},require:n=>deps[n]??{}});return exports;}
function harness(index,{mode='returned',authError=null,success=false,noData=false}={}){
const file=paths[index],logs=[],filters=[];let hit=0;
const outcome=()=>{hit++;if(mode==='thrown')throw Error(canary,{cause:Error(canary)});return success?{data:noData?null:{id:'request'},error:null}:{data:null,error:{message:canary,details:canary}};};
const q=new Proxy({}, {get:(_,key)=>key==='then'?(resolve,reject)=>Promise.resolve().then(outcome).then(resolve,reject):(...args)=>{filters.push([key,...args]);return q;}});
const svc={from:()=>q,storage:{from:()=>({upload:async()=>outcome()})}};
const member={clinicId:'brand',role:'admin',user:{id:'user'},supabase:svc};const auth=async()=>{if(authError)throw authError;return member;};const factory=()=>{if(mode==='factory'){hit++;throw Error(canary);}return svc;};
const deps={'next/server':{NextResponse:{json:Response.json}},'node:crypto':crypto,'next/navigation':{redirect:url=>{const error=Error('NEXT_REDIRECT');error.destination=url;throw error;}},'@/lib/admin':{requireMember:auth,requireBrandAdmin:auth,requireOperator:auth,getAssignedDoctorIds:async()=>[],canViewSensitiveCustomerData:()=>true},'@/lib/supabase':{createServiceClient:factory},'@/lib/supabase-server':{createSupabaseServer:async()=>factory()}};
const category=load('lib/error-category.ts',deps,logs);deps['@/lib/error-category']=category;deps['./error-category']=category;deps['@/lib/admin-query']=load('lib/admin-query.ts',deps,logs);deps['@/lib/http']=load('lib/http.ts',deps,logs);
const api=load(process.env.ERROR_EXIT_BEFORE?'tmp/g3-exits-before/'+index+'.txt':file,deps,logs);
const fd=new FormData();fd.set('token','synthetic-token');fd.set('signer_name','Fixture');fd.set('accepted','yes');
return {logs,filters,hit:()=>hit,run:()=>{
if(index===0)return api.GET({nextUrl:new URL('https://example.invalid/api/admin/calendar?start=2026-09-22&end=2026-09-23')});
if(index===1)return api.POST();
if(index===2){const form=new FormData();form.set('file',new File([Buffer.from([137,80,78,71,13,10,26,10])],'test.png',{type:'image/png'}));return api.POST({formData:async()=>form});}
if(index===3)return api.default({params:Promise.resolve({token:'synthetic-token'}),searchParams:Promise.resolve({})});
return api.signCustomerDocumentAction(fd);
}};}
function privateFree(value){for(const part of canary.split(' '))assert.ok(!JSON.stringify(value).includes(part),part);}
for(const[index,file]of paths.entries())for(const mode of ['returned','thrown','factory'])test(file+' '+mode+' error stays private',async()=>{
const h=harness(index,{mode});if(index<3){const r=await h.run();assert.equal(r.status,500);const body=await r.json();assert.ok(body.error_id);assert.equal(body.error_id,h.logs[0][1].errorId);privateFree([body,h.logs]);}else await assert.rejects(h.run(),e=>{privateFree([e.message,e.stack,e.cause,h.logs]);assert.ok(e.message.includes('目前無法確認操作結果'));return true;});assert.equal(h.hit(),1);
});
for(const index of [0,1])test(paths[index]+' preserves authorization redirect',async()=>{const redirect=Error('NEXT_REDIRECT'),h=harness(index,{authError:redirect});await assert.rejects(h.run(),e=>e===redirect);assert.equal(h.hit(),0);});
test('signing retains atomic pending, expiry and hashed token predicates',async()=>{const h=harness(4,{success:true});await assert.rejects(h.run(),e=>e.destination==='/sign/synthetic-token?completed=1');assert.equal(h.hit(),1);assert.ok(h.filters.some(x=>x[0]==='eq'&&x[1]==='status'&&x[2]==='pending'));assert.ok(h.filters.some(x=>x[0]==='gt'&&x[1]==='expires_at'));assert.ok(h.filters.some(x=>x[0]==='eq'&&x[1]==='token_hash'&&x[2]===crypto.createHash('sha256').update('synthetic-token').digest('hex')));});
test('already used, cancelled or expired signing request does not report success',async()=>{const h=harness(4,{success:true,noData:true});await assert.rejects(h.run(),e=>e.message==='簽署連結已失效、已使用或已取消');assert.equal(h.hit(),1);});
