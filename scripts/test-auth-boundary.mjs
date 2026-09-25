import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';import ts from 'typescript';import vm from 'node:vm';
const secret='fetch failed TEST_NAME 0912345678 secret@example.invalid Bearer AUTH_SECRET';
function load(file,deps={}){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Error,Set,Headers,process:{env:{}},require:n=>{if(n==='server-only')return{};if(n==='react')return{cache:f=>f};if(n in deps)return deps[n];throw Error('Unexpected dependency '+n);}});return exports;}
const boundary=load('lib/auth-boundary.ts');
for(const mode of ['returned','thrown'])test('access query '+mode+' error is safe, never anonymous',async()=>{
 const query=mode==='returned'?Promise.resolve({data:{id:'unexpected'},error:{message:secret}}):Promise.reject(Error(secret));
 await assert.rejects(boundary.readAccessData(query),e=>e.message===boundary.ACCESS_UNAVAILABLE&&!e.cause&&!e.stack.includes('AUTH_SECRET'));
});
for(const mode of ['network','server','ambiguous-user'])test('auth '+mode+' fails closed',async()=>{
 const getUser=async()=>{if(mode==='network')throw Error(secret);return{data:{user:mode==='ambiguous-user'?{id:'u'}:null},error:{status:503,message:secret}};};
 await assert.rejects(boundary.readVerifiedUser({auth:{getUser}}),e=>e.message===boundary.ACCESS_UNAVAILABLE&&!e.cause);
});
for(const error of [null,{name:'AuthSessionMissingError'},{status:401},{status:403},...['bad_jwt','session_not_found','session_expired','refresh_token_not_found','refresh_token_already_used','user_not_found','user_banned'].map(code=>({status:400,code}))])test('absent or rejected session remains anonymous '+JSON.stringify(error),async()=>{
 assert.equal(await boundary.readVerifiedUser({auth:{getUser:async()=>({data:{user:null},error})}}),null);
});
test('valid Auth identity preserved',async()=>{const user={id:'existing'};assert.equal(await boundary.readVerifiedUser({auth:{getUser:async()=>({data:{user},error:null})}}),user);});
function query(result,throws=false){const q={select:()=>q,eq:()=>q,maybeSingle:()=>q,then:(resolve,reject)=>throws?Promise.reject(Error(secret)).then(resolve,reject):Promise.resolve(result).then(resolve,reject)};return q;}
function brand(q){return load('lib/admin.ts',{'./auth-boundary':boundary,'next/headers':{cookies:async()=>({get:()=>({value:'foreign'})})},'next/navigation':{redirect:url=>{throw Error('REDIRECT:'+url);}},'./supabase-server':{getSupabaseServerAuth:async()=>({user:{id:'existing'},supabase:{from:()=>q}})},'./supabase':{CLINIC_ID:'',createServiceClient:()=>{throw Error('no telemetry expected');}},'./access-control':{normalizeBrandPermissions:v=>v??[],permissionsForLegacyBrandRole:()=>['operations.manage']}});}
for(const thrown of [false,true])test('brand membership failure is unavailable, no login redirect '+thrown,async()=>{
 const api=brand(query({data:null,error:{message:secret}},thrown));await assert.rejects(api.requireMember(),e=>e.message===boundary.ACCESS_UNAVAILABLE);await assert.rejects(api.getOptionalMember(),e=>e.message===boundary.ACCESS_UNAVAILABLE);
});
test('brand selection rejects foreign cookie and keeps authorized context',async()=>{
 const api=brand(query({data:[{clinic_id:'own',role:'staff',access_type:'employee',permissions:['operations.manage'],clinics:{name:'test',active:true}}],error:null}));const ctx=await api.requireMember();assert.equal(ctx.clinicId,'own');assert.equal(ctx.user.id,'existing');
});
test('provider assignment query failure cannot return broad or empty permission set',async()=>{
 const api=brand(query({data:[],error:null}));await assert.rejects(api.getAssignedDoctorIds({accessType:'employee',permissions:['provider.assigned'],clinicId:'own',user:{id:'existing'},supabase:{from:()=>query({data:null,error:{message:secret}})}}),e=>e.message===boundary.ACCESS_UNAVAILABLE);
});
function platform(error){return load('lib/platform.ts',{'./auth-boundary':boundary,'next/navigation':{redirect:url=>{throw Error('REDIRECT:'+url);}},'./supabase-server':{getSupabaseServerAuth:async()=>({user:{id:'u'},supabase:{}})},'./supabase':{createServiceClient:()=>({from:()=>query({data:null,error})})},'./platform-roles':{normalizeSystemPermissions:()=>[]}});}
test('platform table name in error is not treated as missing table',async()=>{await assert.rejects(platform({code:'42501',message:'platform_admins '+secret}).requirePlatformAdmin(),e=>e.message===boundary.ACCESS_UNAVAILABLE);});
test('known absent platform table still denies access',async()=>{await assert.rejects(platform({code:'42P01',message:secret}).requirePlatformAdmin(),e=>e.message.startsWith('REDIRECT:'));});
test('middleware auth outage returns safe noncacheable 503 without redirect or cookies',async()=>{
 class R{constructor(body,options){this.body=body;Object.assign(this,options);}static next(){return new R('',{cookies:{set:()=>{throw Error('unexpected cookie write');}}});}static redirect(){throw Error('unexpected redirect');}}
 const api=load('middleware.ts',{'@/lib/auth-boundary':boundary,'next/server':{NextResponse:R},'@supabase/ssr':{createServerClient:()=>({auth:{getUser:async()=>{throw Error(secret);}}})}});
 // Inject public config only; the test harness has no real credentials.
 const source=fs.readFileSync('middleware.ts','utf8');const exports={};vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports,Error,Headers,process:{env:{NEXT_PUBLIC_SUPABASE_URL:'https://example.invalid',NEXT_PUBLIC_SUPABASE_ANON_KEY:'public'}},require:n=>n==='@/lib/auth-boundary'?boundary:n==='next/server'?{NextResponse:R}:{createServerClient:()=>({auth:{getUser:async()=>{throw Error(secret);}}})}});
 const result=await exports.middleware({headers:new Headers(),nextUrl:{pathname:'/admin'},cookies:{getAll:()=>[]}});assert.equal(result.status,503);assert.equal(result.body,boundary.ACCESS_UNAVAILABLE);assert.equal(result.headers['Cache-Control'],'no-store');assert.equal(result.headers['Retry-After'],'5');
});
