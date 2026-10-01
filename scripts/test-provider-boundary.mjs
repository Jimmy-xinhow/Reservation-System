import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
import crypto from 'node:crypto';
const secret='CANARY_NAME 0912345678 canary@example.invalid Bearer CANARY_TOKEN';
function load(file,fetch,deps={},env={}) {
 const exports={};
 vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,fetch,Error,Buffer,URLSearchParams,process:{env},require:n=>{
  if(n==='server-only')return{};
  if(n==='node:crypto')return{default:crypto};
  if(n==='@/lib/supabase')return{createServiceClient:()=>{throw Error('Unexpected DB call');}};
  if(n in deps)return deps[n];
  throw Error('Unexpected dependency '+n);
 }});
 return exports;
}
const token='test-token', messages=[{type:'text',text:'private text'}];
const cases=[
 ['verifyLiffIdToken',['id-token','channel'],{sub:'u'},'POST'],
 ['getBotInfo',[token],{userId:'u'},'GET'],
 ['getWebhookEndpointInfo',[token],{endpoint:'https://example.invalid',active:true},'GET'],
 ['getQuota',[token],{type:'limited',value:100},'GET'],
 ['getQuotaConsumption',[token],{totalUsage:20},'GET'],
 ['createRichMenu',[{size:{width:2500,height:1686},selected:false,name:'test',chatBarText:'menu',areas:[]},token],{richMenuId:'r'},'POST'],
 ['uploadRichMenuImage',['r',new ArrayBuffer(4),'image/png',token],undefined,'POST'],
 ['getRichMenuImage',['r',token],undefined,'GET','image'],
 ['setDefaultRichMenu',['r',token],undefined,'POST'],
 ['deleteRichMenu',['r',token],undefined,'DELETE','404'],
 ['clearDefaultRichMenu',[token],undefined,'DELETE','404'],
 ['getRichMenuAlias',['a',token],{richMenuAliasId:'a',richMenuId:'r'},'GET','404null'],
 ['createRichMenuAlias',['a','r',token],undefined,'POST'],
 ['updateRichMenuAlias',['a','r',token],undefined,'POST'],
 ['deleteRichMenuAlias',['a',token],undefined,'DELETE','404'],
 ['getLineUserProfile',['u',token],{userId:'u',displayName:'name'},'GET'],
 ['linkRichMenuToUser',['u','r',token],undefined,'POST'],
 ['unlinkRichMenuFromUser',['u',token],undefined,'DELETE','404'],
 ['issueLineAccountLinkToken',['u',token],{linkToken:'link'},'POST'],
 ['getRichMenuInsightSummary',['r','20260901','20260921',token],{richMenuId:'r'},'GET'],
 ['pushMessages',['u',messages,token],undefined,'POST'],
 ['replyMessages',['reply',messages,token],undefined,'POST'],
 ['sendEmail',[{apiKey:token,from:'from@example.invalid'},'to@example.invalid','subject','<p>private</p>'],{id:'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'},'POST'],
];
function safe(e){assert.ok(!e.stack.includes('CANARY'));assert.ok(!e.stack.includes('0912345678'));assert.equal(e.cause,undefined);return true;}
for(const [name,args,data,method,special] of cases){
 for(const mode of ['success','http','network',...(data!==undefined||special==='image'?['body']:[])])test(`${name}: ${mode} boundary`,async()=>{
  let calls=0, textReads=0, request;
  const fetch=async(url,init)=>{calls++;request={url,init};if(mode==='network')throw Error(secret,{cause:Error(secret)});return{ok:mode!=='http',status:mode==='http'?503:200,headers:new Headers({'content-type':'image/png'}),text:async()=>{textReads++;return secret;},json:async()=>{if(mode==='body')throw Error(secret);return data;},arrayBuffer:async()=>{if(mode==='body')throw Error(secret);return new ArrayBuffer(4);}};};
  const boundary=load('lib/provider-boundary.ts',fetch);
  const api=load(name==='sendEmail'?'lib/email.ts':'lib/line.ts',fetch,{'@/lib/provider-boundary':boundary});
  if(mode==='success'){
   const result=await api[name](...args);
   if(name==='createRichMenu')assert.equal(result,'r');
   else if(name==='issueLineAccountLinkToken')assert.equal(result,'link');
   else if(name==='sendEmail')assert.equal(result,data.id);
   else if(special==='image')assert.equal(result.bytes.byteLength,4);
   else if(name==='getQuotaConsumption')assert.equal(result,data.totalUsage);
   else if(data!==undefined)assert.equal(JSON.stringify(result),JSON.stringify(data));
   else assert.equal(result,undefined);
  }else if(mode==='http'&&special==='image')assert.equal(await api[name](...args),null);
  else if(mode==='body'&&name==='sendEmail')assert.equal(await api[name](...args),null);
  else await assert.rejects(api[name](...args),e=>{safe(e);if(mode==='http')assert.match(e.message,/503/);return true;});
  assert.equal(calls,1,'never automatically repeat requests');assert.equal(textReads,0,'never read upstream failure body');
  assert.equal(request.init.method??'GET',method);
  if(name!=='verifyLiffIdToken')assert.equal(request.init.headers.Authorization,`Bearer ${token}`);
  if(name==='pushMessages')assert.deepEqual(JSON.parse(request.init.body),{to:'u',messages});
  if(name==='replyMessages')assert.deepEqual(JSON.parse(request.init.body),{replyToken:'reply',messages});
  if(name==='sendEmail')assert.deepEqual(JSON.parse(request.init.body),{from:args[0].from,to:args[1],subject:args[2],html:args[3]});
  if(name==='verifyLiffIdToken')assert.equal(request.init.body.get('id_token'),'id-token');
 });
 if(special?.startsWith('404'))test(`${name}: 404 remains idempotent`,async()=>{
  const fetch=async()=>({ok:false,status:404});const boundary=load('lib/provider-boundary.ts',fetch);const api=load('lib/line.ts',fetch,{'@/lib/provider-boundary':boundary});assert.equal(await api[name](...args),special==='404null'?null:undefined);
 });
}
for(const [file,name,args] of [
 ['line','lineCredentialsForDestination',['dest']],['line','getLineCredentialStatus',[]],
 ['email','emailConfigForClinic',['clinic']],['email','getEmailCredentialStatus',[]],
])for(const mode of ['returned','thrown','empty','configured'])test(`${name}: Vault ${mode}`,async()=>{
 const row=file==='line'?{access_token:'secret',channel_secret:'secret',access_token_secret_id:'id',channel_secret_secret_id:'id'}:{api_key:'secret',from_address:'from@example.invalid',api_key_secret_id:'id'};
 const query={select:()=>query,eq:()=>query,maybeSingle:()=>query,then:(resolve,reject)=>mode==='thrown'?Promise.reject(Error(secret)).then(resolve,reject):Promise.resolve({data:mode==='empty'?null:name.includes('Status')?row:[row],error:mode==='returned'?{message:secret}:null}).then(resolve,reject)};
 const service={rpc:()=>query,from:table=>table==='clinics'?{select:()=>service.from('clinics'),eq:()=>service.from('clinics'),maybeSingle:async()=>({data:{id:'clinic'},error:null})}:table==='clinic_line_channels'?{select:()=>service.from('clinic_line_channels'),eq:()=>service.from('clinic_line_channels'),maybeSingle:async()=>({data:{connection_mode:'shared'},error:null})}:query};const fetch=()=>{throw Error('Unexpected HTTP');};
 const boundary=load('lib/provider-boundary.ts',fetch);const api=load(`lib/${file}.ts`,fetch,{'@/lib/provider-boundary':boundary});
 const invoke=()=>api[name](...(name.includes('Status')?[service,'clinic','dest']:[...args,service]));
 if(mode==='returned'||mode==='thrown')await assert.rejects(invoke(),safe);
 else{const value=await invoke();if(name.includes('Status'))assert.equal(value.configured,mode==='configured');else if(mode==='configured')assert.equal(value.apiKey??value.accessToken,'secret');else if(file==='email')assert.equal(value,null);else assert.equal(value.source,'environment');}
});
test('independent LINE channel never falls back to platform credentials', async () => {
 const fetch=()=>{throw Error('Unexpected HTTP');};
 const boundary=load('lib/provider-boundary.ts',fetch);
 const api=load('lib/line.ts',fetch,{'@/lib/provider-boundary':boundary},
  {LINE_CHANNEL_ACCESS_TOKEN:'platform-token',LINE_CHANNEL_SECRET:'platform-secret'});
 const service={rpc:async()=>({data:[],error:null}),from:table=>{
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='clinics'?{id:'clinic'}:
   table==='clinic_line_channels'?{connection_mode:'brand'}:null,error:null})};return q;
 }};
 await assert.rejects(api.lineCredentialsForDestination('Ubrand',service),/專屬憑證/);
 assert.equal((await api.getLineCredentialStatus(service,'clinic','Ubrand')).configured,false);
});
test('shared LINE channel retains its existing platform credential fallback', async () => {
 const fetch=()=>{throw Error('Unexpected HTTP');};
 const boundary=load('lib/provider-boundary.ts',fetch);
 const api=load('lib/line.ts',fetch,{'@/lib/provider-boundary':boundary},
  {LINE_CHANNEL_ACCESS_TOKEN:'platform-token',LINE_CHANNEL_SECRET:'platform-secret'});
 const service={rpc:async()=>({data:[],error:null}),from:table=>{
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='clinics'?{id:'clinic'}:
   table==='clinic_line_channels'?{connection_mode:'shared'}:null,error:null})};return q;
 }};
 const credentials=await api.lineCredentialsForDestination('Ushared',service);
 assert.equal(credentials.accessToken,'platform-token');assert.equal(credentials.channelSecret,'platform-secret');
 assert.equal((await api.getLineCredentialStatus(service,'clinic','Ushared')).configured,true);
});
test('destination-keyed legacy credentials remain available to independent LINE brands', async () => {
 const fetch=()=>{throw Error('Unexpected HTTP');};
 const boundary=load('lib/provider-boundary.ts',fetch);
 const api=load('lib/line.ts',fetch,{'@/lib/provider-boundary':boundary},{
  LINE_CHANNEL_ACCESS_TOKEN:'platform-token',LINE_CHANNEL_SECRET:'platform-secret',
  LINE_CHANNEL_ACCESS_TOKENS_JSON:JSON.stringify({Ubrand:'brand-token'}),
  LINE_CHANNEL_SECRETS_JSON:JSON.stringify({Ubrand:'brand-secret'}),
 });
 const service={rpc:async()=>({data:[],error:null}),from:table=>{
  const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='clinic_line_secret_refs'?null:
   {connection_mode:'brand'},error:null})};return q;
 }};
 const credentials=await api.lineCredentialsForDestination('Ubrand',service);
 assert.equal(credentials.accessToken,'brand-token');assert.equal(credentials.channelSecret,'brand-secret');
 assert.equal((await api.getLineCredentialStatus(service,'clinic','Ubrand')).configured,true);
});
for(const name of ['verifyLiffIdToken','getWebhookEndpointInfo','createRichMenu','getLineUserProfile','issueLineAccountLinkToken'])test(`${name}: null success payload fails safely`,async()=>{
 const entry=cases.find(c=>c[0]===name);const fetch=async()=>({ok:true,status:200,json:async()=>null});const boundary=load('lib/provider-boundary.ts',fetch);const api=load('lib/line.ts',fetch,{'@/lib/provider-boundary':boundary});await assert.rejects(api[name](...entry[1]),e=>{safe(e);assert.doesNotMatch(e.message,/Cannot read/);return true;});
});
for (const totalUsage of [null, -1, '20', 1.5]) test(`getQuotaConsumption rejects invalid usage ${String(totalUsage)}`, async () => {
 const fetch = async () => ({ok: true, status: 200, json: async () => ({totalUsage})});
 const boundary = load('lib/provider-boundary.ts', fetch);
 const api = load('lib/line.ts', fetch, {'@/lib/provider-boundary': boundary});
 await assert.rejects(api.getQuotaConsumption(token), /回應格式不正確/);
});
