import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync,readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
const require=createRequire(import.meta.url);

test('direct limiter callers stop before request processing and distinguish outage from excess',async()=>{
 const base=new URL('../app/api/',import.meta.url);let checked=0;
 for(const relative of readdirSync(base,{recursive:true}).filter(p=>p.endsWith('route.ts'))){
  const text=readFileSync(new URL(relative.replaceAll('\\','/'),base),'utf8');
  if(!text.includes('rate.unavailable ? 503 : 429'))continue;
  const source=ts.createSourceFile(relative,text,ts.ScriptTarget.Latest,true);
  const post=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='POST');assert(post);
  const code=ts.transpileModule(post.getText(source),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  for(const unavailable of [true,false]){
   const exports={};vm.runInNewContext(code,{exports,checkRateLimit:async()=>({allowed:false,unavailable,retryAfterSeconds:5}),fail:(_message,status)=>Response.json({ok:false},{status})});
   const req={json:()=>{throw Error('must not read payload');},formData:()=>{throw Error('must not read payload');}};
   const result=await exports.POST(req);assert.equal(result.status,unavailable?503:429,relative);
  }
  checked++;
 }
 assert.equal(checked,16);
});
function load(file,deps={},logs=[]){
 const exports={};
 const code=ts.transpileModule(readFileSync(new URL('../lib/'+file+'.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 vm.runInNewContext(code,{exports,Error,console:{error:(...args)=>logs.push(args)},require:name=>{
  if(name==='server-only')return {};
  if(name in deps)return deps[name];
  if(name==='./error-category'||name==='@/lib/error-category')return load('error-category');
  if(name==='@/lib/admin-query')return load('admin-query');
  if(name.startsWith('node:'))return require(name);
  if(name==='next/server')return {NextResponse:{json:(data,options)=>Response.json(data,options)}};
  throw Error('Unexpected '+name);
 }});return exports;
}
test('server failures keep correlation id but exclude raw PII and credentials from response and logs',async()=>{
 const logs=[];const {fail}=load('http',{'./rate-limit':{}},logs);
 const message='duplicate key: 顧客測試姓名 test@example.invalid 0912345678 Bearer super-secret-value\nDETAIL private';
 const r=fail(message,500);const body=await r.json();
 assert.equal(r.status,500);assert.equal(body.error_id,logs[0][1].errorId);assert.equal(logs[0][1].category,'database');
 for(const text of ['顧客測試姓名','test@example.invalid','0912345678','super-secret-value','DETAIL'])assert(!JSON.stringify([body,logs]).includes(text));
 assert.deepEqual(Object.keys(logs[0][1]).sort(),['category','errorId','status']);
});
test('shared limiter failures reject without logging upstream error content',async()=>{
 const logs=[];const {checkRateLimit}=load('rate-limit',{'./supabase':{createServiceClient:()=>({rpc:async()=>({error:{message:'fetch failed secret-value test@example.invalid'}})})}},logs);
 const req={headers:new Headers()};const failed=await checkRateLimit(req,'test-private',1);assert.equal(failed.allowed,false);assert.equal(failed.unavailable,true);
 assert.equal((await checkRateLimit(req,'test-private',1)).allowed,false);
 assert.equal(logs[0][1].category,'connection');assert(!JSON.stringify(logs).includes('secret-value'));assert(!JSON.stringify(logs).includes('test@example.invalid'));
});
test('rate limiter ignores forged forwarded chains and shares the same trusted address bucket',async()=>{
 const keys=[];
 const {checkRateLimit}=load('rate-limit',{'./supabase':{createServiceClient:()=>({rpc:async(_name,args)=>{
  keys.push(args.p_bucket_key);return {data:[{allowed:true,retry_after_seconds:0}],error:null};
 }})}});
 const request=forwarded=>({headers:new Headers({'x-real-ip':'203.0.113.8','x-forwarded-for':forwarded})});
 assert.equal((await checkRateLimit(request('198.51.100.1'),'forged-forwarded',2)).allowed,true);
 assert.equal((await checkRateLimit(request('198.51.100.2'),'forged-forwarded',2)).allowed,true);
 assert.equal((await checkRateLimit(request('198.51.100.3'),'forged-forwarded',2)).allowed,false);
 assert.equal(keys.length,2);assert.equal(keys[0],keys[1]);
 const withoutEdge=forwarded=>({headers:new Headers({'x-forwarded-for':forwarded})});
 assert.equal((await checkRateLimit(withoutEdge('198.51.100.4'),'missing-edge',1)).allowed,true);
 assert.equal((await checkRateLimit(withoutEdge('198.51.100.5'),'missing-edge',1)).allowed,false);
});
test('rate limit response keeps retry duration and allows permitted requests',async()=>{
 let allowed=false;
 const {rateLimitResponse}=load('http',{'./rate-limit':{checkRateLimit:async()=>({allowed,retryAfterSeconds:37})}});
 const r=await rateLimitResponse({},'test',10);assert.equal(r.status,429);assert.equal(r.headers.get('Retry-After'),'37');
 allowed=true;assert.equal(await rateLimitResponse({},'test',10),null);
});

 test('independent limiter instances cannot each grant requests during shared-store outage',async()=>{
  for(let i=0;i<4;i++){
   const {checkRateLimit}=load('rate-limit',{'./supabase':{createServiceClient:()=>({rpc:async()=>({error:{message:'fetch failed'}})})}});
   assert.equal((await checkRateLimit({headers:new Headers()},'multi',8)).allowed,false);
  }
 });
 test('malformed shared rate results fail closed',async()=>{
  for(const retry of [NaN,Infinity,-1,0.5,90000]){
   const {checkRateLimit}=load('rate-limit',{'./supabase':{createServiceClient:()=>({rpc:async()=>({data:[{allowed:true,retry_after_seconds:retry}],error:null})})}});
   const result=await checkRateLimit({headers:new Headers()},'malformed',8);assert.equal(result.allowed,false);assert.equal(result.unavailable,true);
  }
 });
 test('shared limiter outage returns safe 503 with retry advice, then recovers',async()=>{
  let down=true;const logs=[];
  const {rateLimitResponse}=load('http',{'./rate-limit':{checkRateLimit:async()=>down?{allowed:false,unavailable:true,retryAfterSeconds:5}:{allowed:true,retryAfterSeconds:0}}},logs);
  const r=await rateLimitResponse({},'outage',8);assert.equal(r.status,503);assert.equal(r.headers.get('Retry-After'),'5');assert((await r.json()).error_id);
  down=false;assert.equal(await rateLimitResponse({},'outage',8),null);
 });
