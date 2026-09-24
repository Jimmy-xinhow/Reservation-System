import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import ts from 'typescript';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
async function compile(source){
 const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
 return import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
}
const {deliveryError}=await compile(read('lib/error-category.ts')+read('lib/delivery-error.ts').replace(/^import .*;\r?\n/,''));
const privateError='fetch failed name=測試姓名 phone=0912345678 email=test@example.invalid Authorization=Bearer secret-token';
async function functionFrom(path,name){
 const source=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true);
 const node=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
 assert(node, path+' '+name);
 return (await compile(`export function factory(deliveryError) { ${node.getText(source).replace(/^export /,'')} return ${name}; }`)).factory(deliveryError);
}
test('delivery failures allow only exact operational reasons or categories',()=>{
 assert.equal(deliveryError(new Error(privateError)),'delivery_error:connection');
 assert.equal(deliveryError({message:privateError}),'delivery_error:internal');
 assert.equal(deliveryError('顧客未同意行銷'),'顧客未同意行銷');
 assert.equal(deliveryError('顧客未同意行銷 '+privateError),'delivery_error:connection');
 assert.equal(deliveryError('delivery_error:configuration'),'delivery_error:configuration');
 assert.equal(deliveryError('delivery_error:connection '+privateError),'delivery_error:connection');
});

// Execute the real route/action bodies with controlled boundary dependencies.
async function extractedFactory(path, names, dependencies) {
 const source=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true);
 const bodies=names.map(name=>{
  const node=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text===name);
  assert(node,name);return node.getText(source).replace(/^export /,'');
 }).join('\n');
 return (await compile(`export function factory(deps) { const {${dependencies.join(',')}}=deps; ${bodies} return ${names.at(-1)}; }`)).factory;
}
const followupFactory=await extractedFactory('app/api/cron/followups/route.ts',['escapeHtml','runFollowups','GET'],['deliveryError','createServiceClient','process','Response','console','fail','cronScopeDenied','lineAccessTokenForDestination','pushMessages','emailConfigForClinic','sendEmail','recordCrmInteraction']);
async function runFollowups(options={}) {
 const events=[],logs=[];
 const jobs=options.jobs??[{id:'one',clinic_id:'brand',patient_id:'patient',purpose:'marketing',channel:options.channel??'line',body:'<test>',subject:null}];
 const service={
  rpc:async(name,args)=>{
   if(name==='claim_due_scheduled_followups')return {data:jobs,error:null};
   events.push(['finish',args]);
   if(options.finishThrows)throw new Error(privateError);
   return {error:options.finishError?{message:privateError}:null};
  },
  from:table=>{const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:table==='patients'?{active:options.active??true,marketing_opt_in:options.optIn??true,line_user_id:'synthetic',email:'test@example.invalid'}:table==='clinics'?{name:'brand'}:{email_enabled:true},error:null})};return q;}
 };
 const send=async()=>{events.push(['send']);if(options.sendThrows)throw new Error(privateError);};
 const run=followupFactory({deliveryError,createServiceClient:()=>service,process:{env:{CRON_SECRET:'test'}},Response,console:{error:(...args)=>logs.push(args)},fail:()=>{throw new Error('unexpected outer failure');},cronScopeDenied:()=>null,lineAccessTokenForDestination:async()=>'synthetic',pushMessages:send,emailConfigForClinic:async()=>({}),sendEmail:send,recordCrmInteraction:async()=>{events.push(['crm']);if(options.crmThrows)throw new Error(privateError);}});
 const body=await (await run({headers:new Headers({authorization:'Bearer test'})})).json();
 assert(!JSON.stringify(logs).includes('secret-token'));assert(!JSON.stringify(logs).includes('test@example.invalid'));
 return {body,events,logs};
}
for(const channel of ['line','email'])test(`followup ${channel} commits sent before CRM`,async()=>{
 const {body,events}=await runFollowups({channel});assert.equal(body.ok,true);assert.equal(body.sent,1);
 assert.deepEqual(events.map(e=>e[0]),['send','finish','crm']);assert.equal(events[1][1].p_status,'sent');
});
for(const failure of ['finishError','finishThrows'])test(`followup ${failure} after acceptance never enables retry`,async()=>{
 const {body,events}=await runFollowups({[failure]:true});assert.equal(body.unconfirmed,1);assert.equal(body.sent,0);assert.equal(body.failed,0);assert.equal(body.ok,false);
 assert.deepEqual(events.map(e=>e[0]),['send','finish']);assert.equal(events[1][1].p_status,'sent');
});
test('followup CRM failure preserves delivered count and never writes failed',async()=>{
 const {body,events}=await runFollowups({crmThrows:true});assert.equal(body.sent,1);assert.equal(body.crm_failed,1);assert.equal(body.failed,0);assert.equal(body.ok,false);
 assert.equal(events.filter(e=>e[0]==='finish').length,1);assert.equal(events[1][1].p_status,'sent');
});
test('followup ambiguous send exception stays unconfirmed without finalizer',async()=>{
 const {body,events}=await runFollowups({sendThrows:true});assert.equal(body.unconfirmed,1);assert.equal(body.failed,0);assert.deepEqual(events,[['send']]);
});
for(const options of [{active:false},{optIn:false}])test(`followup pre-send rejection ${JSON.stringify(options)}`,async()=>{
 const {body,events}=await runFollowups(options);assert.equal(body.failed,1);assert.equal(body.unconfirmed,0);assert.equal(events.length,1);assert.equal(events[0][1].p_status,'failed');
});
for(const failure of ['finishError','finishThrows'])test(`followup failure-state ${failure} is counted and batch continues`,async()=>{
 const jobs=['one','two'].map(id=>({id,clinic_id:'brand',patient_id:'patient',purpose:'marketing',channel:'line'}));
 const {body,events}=await runFollowups({active:false,[failure]:true,jobs});assert.equal(body.claimed,2);assert.equal(body.failed,2);assert.equal(body.status_write_failed,2);assert.equal(events.length,2);
});
test('followup CRM error does not stop later deliveries',async()=>{
 const jobs=['one','two'].map(id=>({id,clinic_id:'brand',patient_id:'patient',purpose:'marketing',channel:'line'}));
 const {body}=await runFollowups({crmThrows:true,jobs});assert.equal(body.sent,2);assert.equal(body.crm_failed,2);
});

const actionFactory=await extractedFactory('app/admin/followups/actions.ts',['storageError','storage','text','setScheduledFollowupStatusAction'],['requireOperator','createServiceClient','recordCrmInteraction','refresh','redirect','console','deliveryError']);
async function actionHarness(currentStatus,actualStatus,nextStatus,options={}){
 const effects=[],filters=[],logs=[];let state=actualStatus;
 const service={from:()=>{let updating=false,patch;const q={select:()=>q,eq:(key,value)=>{if(updating)filters.push([key,value]);return q;},update:body=>{updating=true;patch=body;return q;},maybeSingle:async()=>{
  if(options.readThrows&&!updating)throw new Error(privateError);
  if(options.writeThrows&&updating)throw new Error(privateError);
  if(options.readError&&!updating)return {data:null,error:{message:privateError}};
  if(options.writeError&&updating)return {data:null,error:{message:privateError}};
  if(!updating)return {data:{id:'one',patient_id:'patient',status:currentStatus,body:'test'},error:null};
  if(filters.some(([key,value])=>key==='status'&&value!==state))return {data:null,error:null};
  state=patch.status;effects.push('write');return {data:{id:'one'},error:null};
 }};return q;}};
 const run=actionFactory({requireOperator:async()=>({clinicId:'brand',user:{id:'operator'}}),createServiceClient:()=>service,recordCrmInteraction:async()=>{effects.push('crm');if(options.crmThrows)throw new Error(privateError);},refresh:()=>effects.push('refresh'),redirect:url=>{effects.push(url);throw new Error('NEXT_REDIRECT');},console:{error:(...args)=>logs.push(args)},deliveryError});
 const fd=new FormData();fd.set('id','one');fd.set('status',nextStatus);
 let error;try{await run(fd);}catch(e){error=e;}
 return {state,effects,filters,error,logs};
}
for(const [before,after] of [['pending','cancelled'],['failed','pending'],['pending','completed']])test(`followup stale ${before} to ${after} cannot overwrite processing`,async()=>{
 const result=await actionHarness(before,'processing',after);assert.match(result.error.message,/狀態已變更/);assert.equal(result.state,'processing');assert.deepEqual(result.effects,[]);assert.deepEqual(result.filters,[['id','one'],['clinic_id','brand'],['status',before]]);
});
for(const [before,after] of [['pending','completed'],['failed','pending']])test(`followup valid ${before} to ${after}`,async()=>{
 const result=await actionHarness(before,before,after);assert.equal(result.error,undefined);assert.equal(result.state,after);assert.deepEqual(result.effects,after==='completed'?['write','crm','refresh']:['write','refresh']);
});
for(const status of ['sent','processing'])test(`followup ${status} cannot be retried`,async()=>{
 const result=await actionHarness(status,status,'pending');assert.match(result.error.message,/目前狀態/);assert.deepEqual(result.effects,[]);
});
for(const [path,name,table] of [
 ['lib/appointment-notifications.ts','finishNotification','appointment_notification_logs'],
 ['lib/registration-notifications.ts','finishNotification','registration_notification_logs'],
 ['app/api/cron/reminders/route.ts','finishReminder','reminder_logs'],
 ['app/api/cron/marketing/route.ts','markDelivery','crm_delivery_logs'],
 ['app/api/cron/membership/route.ts','finishNotification','membership_notification_logs'],
])test(table+' stores safe failure, keeps status, clears error on success',async()=>{
 const run=await functionFrom(path,name);const writes=[];
 const svc={from:t=>{assert.equal(t,table);return {update:body=>({eq:async(k,id)=>{writes.push(body);assert.equal(id,'claim');return {error:null};}})}}};
 await run(svc,'claim','failed',privateError);
 assert.equal(writes[0].error,'delivery_error:connection');assert.equal(writes[0].status??writes[0].result,'failed');
 await run(svc,'claim','sent',null);assert.equal(writes[1].error,null);
 const bad={from:()=>({update:()=>({eq:async()=>({error:{message:'write failed'}})})})};
 await assert.rejects(run(bad,'claim','failed',privateError),/write failed/);
});
test('waitlist finalizer scrubs provider failure and preserves static skip reason',async()=>{
 const run=await functionFrom('lib/appointment-waitlist-notifications.ts','finish');const writes=[];
 const svc={rpc:async(name,args)=>{assert.equal(name,'finish_appointment_waitlist_notification');writes.push(args);return {error:null};}};
 await run(svc,'claim','failed',privateError);assert.equal(writes[0].p_error,'delivery_error:connection');
 await run(svc,'claim','skipped','customer has no email');assert.equal(writes[1].p_error,'customer has no email');
});
test('scheduled followup stores safe failure when customer lookup fails, without sending',async()=>{
 const source=ts.createSourceFile('route.ts',read('app/api/cron/followups/route.ts'),ts.ScriptTarget.Latest,true);
 const get=source.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='runFollowups');
 const {factory}=await compile(`export function factory(deps) { const {deliveryError,createServiceClient,process,Response,cronScopeDenied}=deps; ${get.getText(source).replace(/^export /,'')} return runFollowups; }`);
 const writes=[];
 const service={rpc:async(name,args)=>{if(name==='claim_due_scheduled_followups')return {data:[{id:'followup',clinic_id:'brand',patient_id:'patient'}]};writes.push(args);return {error:null};},from:()=>({select:()=>{const q={eq:()=>q,maybeSingle:async()=>({error:{message:privateError}})};return q;}})};
 const run=factory({deliveryError,createServiceClient:()=>service,process:{env:{CRON_SECRET:'test'}},Response,cronScopeDenied:()=>null});
 const result=await run({headers:new Headers({authorization:'Bearer test'})});
 assert.equal((await result.json()).failed,1);assert.equal(writes[0].p_error,'delivery_error:connection');
 assert(!JSON.stringify(writes).includes('secret-token'));
});

// A lost CRM acknowledgement must not report the durable completion as failed.
test('manual completion CRM failure refreshes and redirects with a safe partial-success notice',async()=>{
 const r=await actionHarness('pending','pending','completed',{crmThrows:true});
 assert.equal(r.state,'completed');assert.equal(r.error.message,'NEXT_REDIRECT');
 assert.deepEqual(r.effects,['write','crm','refresh','/admin/followups?notice=completed-timeline-failed']);
 assert.equal(r.logs.length,1);assert(!JSON.stringify(r.logs).includes('secret-token'));assert(!JSON.stringify(r.logs).includes('test@example.invalid'));
 const repeat=await actionHarness('completed','completed','completed');assert.deepEqual(repeat.effects,[]);assert.match(repeat.error.message,/目前狀態/);
});
for(const kind of ['readError','writeError','readThrows','writeThrows'])test(`followup ${kind} does not throw database detail into framework logs`,async()=>{
 const r=await actionHarness('pending','pending','completed',{[kind]:true});
 assert.equal(r.state,'pending');assert.deepEqual(r.effects,[]);assert.match(r.error.message,/重新整理/);
 assert(!JSON.stringify(r.logs).includes('secret-token'));assert(!r.error.message.includes('secret-token'));
});
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
async function componentFactory(path,dependencies,name){
 const source=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const body=source.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>n.getText(source).replace(/^export default /,'').replace(/^export /,'')).join('\n');
 const {outputText}=ts.transpileModule(`export function factory(deps){const {${dependencies.join(',')}}=deps;${body};return ${name};}`,{fileName:'test.tsx',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022,jsx:ts.JsxEmit.React}});
 return (await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'))).factory;
}
const pageFactory=await componentFactory('app/admin/followups/page.tsx',['React','Link','requireNonProvider','canViewSensitiveCustomerData','fetchAllSupabasePages','createSupabaseServer','SubmitButton','FollowupComposer','createScheduledFollowupAction','setScheduledFollowupStatusAction','deliveryError'],'FollowupsPage');
async function renderFollowups(notice,mode,storedError){
 const from=table=>{const q={select:()=>q,eq:()=>q,order:()=>q,range:()=>q,then:(resolve,reject)=>mode==='throw'?Promise.reject(new Error(privateError)).then(resolve,reject):Promise.resolve({data:table==='scheduled_followups'&&storedError?[{id:'followup',patient_id:'patient',channel:'line',purpose:'service',subject:'Test',body:'Approved body',scheduled_for:'2026-09-23T00:00:00Z',status:'failed',attempt_count:1,last_error:storedError,patients:{name:'Fixture',phone:'0900000000'}}]:[],error:mode==='error'?{message:privateError}:null}).then(resolve,reject)};return q;};
 const fetchAllSupabasePages=async callback=>{const result=await callback(0,999);if(result.error)throw Error('讀取失敗');return result.data??[];};
 const Page=pageFactory({React,Link:({children,href})=>React.createElement('a',{href},children),requireNonProvider:async()=>({clinicId:'brand',role:'owner'}),canViewSensitiveCustomerData:()=>true,fetchAllSupabasePages,createSupabaseServer:async()=>({from}),SubmitButton:()=>null,FollowupComposer:()=>null,createScheduledFollowupAction:()=>{},setScheduledFollowupStatusAction:()=>{},deliveryError});
 return renderToStaticMarkup(await Page({searchParams:Promise.resolve({notice})}));
}
test('followup page classifies a historical raw provider error before rendering',async()=>{
 const html=await renderFollowups(undefined,undefined,privateError);assert(!html.includes('secret-token'));assert(!html.includes('test@example.invalid'));assert.match(html,/delivery_error:connection/);
});
const deliveriesPageFactory=await componentFactory('app/admin/crm/deliveries/page.tsx',['React','Link','requireMember','isAdminModuleEnabled','ModuleDisabled','canViewSensitiveCustomerData','adminQuery','adminErrorMessage','deliveryError'],'DeliveryLogsPage');
test('CRM delivery page classifies a historical raw provider error before rendering',async()=>{
 const row={id:'delivery',status:'failed',channel:'line',trigger_key:'fixture',error:privateError,attempt_count:1,attempted_at:null,sent_at:null,created_at:'2026-09-23T00:00:00Z',patients:{name:'Fixture',phone:'0900000000',email:null},crm_automations:{name:'Fixture automation',trigger_type:'birthday'}};
 const q=new Proxy({}, {get:(_,key)=>key==='then'?(resolve,reject)=>Promise.resolve({data:[row],error:null}).then(resolve,reject):()=>q});
 const Page=deliveriesPageFactory({React,Link:({children,href})=>React.createElement('a',{href},children),requireMember:async()=>({clinicId:'brand',role:'admin',supabase:{from:()=>q}}),isAdminModuleEnabled:async()=>true,ModuleDisabled:()=>null,canViewSensitiveCustomerData:()=>true,adminQuery:async value=>await value,adminErrorMessage:()=> '目前無法確認',deliveryError});
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));assert(!html.includes('secret-token'));assert(!html.includes('test@example.invalid'));assert.match(html,/delivery_error:connection/);
});
test('followup page renders only the fixed partial-success notice',async()=>{
 assert.match(await renderFollowups('completed-timeline-failed'),/回訪已標記完成/);
 const html=await renderFollowups(privateError);assert(!html.includes('secret-token'));assert(!html.includes('回訪已標記完成'));
});
for(const mode of ['error','throw'])test(`followup page ${mode} hides database details`,async()=>{
 await assert.rejects(renderFollowups(undefined,mode),e=>e.message==='讀取回訪資料失敗，請重新整理後再試');
});
test('admin error boundary does not claim durable writes failed or display raw error',async()=>{
 const factory=await componentFactory('app/admin/error.tsx',['React'],'AdminError');const ErrorPage=factory({React});
 const html=renderToStaticMarkup(React.createElement(ErrorPage,{error:new Error(privateError),reset:()=>{}}));
 assert.match(html,/無法確認/);assert.match(html,/避免重複送出/);assert(!html.includes('secret-token'));assert(!html.includes('動作沒有完成'));
});
const {errorCategory}=await compile(read('lib/error-category.ts'));
const channelFactory=await extractedFactory('app/admin/channels/actions.ts',['summarize','runChannelTestsAction'],['requireAdmin','createServiceClient','getClinicLineChannelContext','getPaymentSettings','lineAccessTokenForDestination','getBotInfo','emailConfigForClinic','resolvePublicClinicIdFromScope','process','console','errorCategory','revalidatePath','redirect']);
async function runChannels(mode){
 const writes=[],logs=[],effects=[];const failure=()=>{throw new Error(privateError);};
 const service={from:table=>{const q={select:()=>q,eq:()=>q,single:()=>q,then:(resolve,reject)=>{
  if(mode==='readThrows')return Promise.reject(new Error(privateError)).then(resolve,reject);
  const data=table==='clinic_settings'?{line_channel_enabled:mode!=='disabled',email_enabled:true,deposit_enabled:true}:table==='clinics'?{slug:'synthetic',line_destination:'destination'}:[];
  return Promise.resolve({data,error:mode==='readError'?{message:privateError}:null}).then(resolve,reject);
 },insert:async rows=>{writes.push(rows);if(mode==='writeThrows')failure();return {error:mode==='writeError'?{message:privateError}:null};}};return q;}};
 const run=channelFactory({requireAdmin:async()=>{if(mode==='auth')throw new Error('AUTH_REDIRECT');return {clinicId:'brand',user:{id:'admin'}};},createServiceClient:()=>{effects.push('client');if(mode==='client')failure();return service;},getClinicLineChannelContext:async()=>{if(mode==='context')failure();return {enabled:mode!=='disabled',liffId:'synthetic',loginChannelId:'synthetic',liffEndpointPath:'/book',verificationStatus:'ready'};},getPaymentSettings:async()=>{if(mode==='payment')failure();return {provider:'ecpay',environment:'test',hash_key:'key-private',hash_iv:'iv-private'};},lineAccessTokenForDestination:async()=>{effects.push('token');if(mode==='token')failure();return 'token-private';},getBotInfo:async()=>{effects.push('bot');if(mode==='line')failure();return {displayName:'Synthetic brand',basicId:'@synthetic',chatMode:'bot'};},emailConfigForClinic:async()=>{if(mode==='email')failure();return {apiKey:'email-private',from:'sender@example.invalid'};},resolvePublicClinicIdFromScope:async()=>{if(mode==='domain')failure();return 'brand';},process:{env:{PUBLIC_APP_URL:'https://example.invalid'}},console:{error:(...args)=>logs.push(args)},errorCategory,revalidatePath:path=>effects.push(path),redirect:url=>{effects.push(url);throw new Error('NEXT_REDIRECT');}});
 let error;try{await run();}catch(e){error=e;}
 const serialized=JSON.stringify({writes,logs});for(const secret of ['secret-token','token-private','key-private','iv-private','email-private'])assert(!serialized.includes(secret));
 return {writes,logs,effects,error};
}
test('channel success saves five brand-scoped results and redirects outside catch',async()=>{
 const r=await runChannels();assert.equal(r.error.message,'NEXT_REDIRECT');assert.equal(r.logs.length,0);assert.equal(r.writes[0].length,5);assert(r.writes[0].every(row=>row.clinic_id==='brand'&&row.ran_by==='admin'&&row.status==='passed'));assert(r.effects.includes('/admin/channels?tested=1'));
});
for(const mode of ['token','line'])test(`channel ${mode} failure saves safe LINE detail and other channel results`,async()=>{
 const r=await runChannels(mode);assert.equal(r.error.message,'NEXT_REDIRECT');assert.equal(r.writes[0].length,5);const line=r.writes[0].find(row=>row.channel==='line');assert.equal(line.status,'failed');assert.equal(line.checks[0].detail,'無法確認 LINE 連線，請檢查官方帳號授權設定後重試。');assert.equal(r.logs[0][1].category,'connection');assert.equal(r.writes[0].find(row=>row.channel==='email').status,'passed');
});
for(const mode of ['client','readError','readThrows','context','payment','email','domain','writeError','writeThrows'])test(`channel ${mode} exception never reaches framework as raw detail`,async()=>{
 const r=await runChannels(mode);assert.equal(r.error.message,'渠道檢查未能確認完成，請重新整理查看結果後再試');assert(!r.effects.includes('/admin/channels?tested=1'));assert.equal(r.logs.length,1);assert.equal(r.writes.length,mode.startsWith('write')?1:0);
});
test('channel auth rejection stays outside storage catch without DB access',async()=>{
 const r=await runChannels('auth');assert.equal(r.error.message,'AUTH_REDIRECT');assert.deepEqual(r.effects,[]);assert.deepEqual(r.logs,[]);
});
test('disabled LINE skips external bot request',async()=>{
 const r=await runChannels('disabled');assert.equal(r.error.message,'NEXT_REDIRECT');assert(!r.effects.includes('bot'));assert(!r.effects.includes('token'));assert.equal(r.writes[0][0].status,'warning');
});
const channelsPageFactory=await componentFactory('app/admin/channels/page.tsx',['React','Link','requireAdmin','createServiceClient','SubmitButton','runChannelTestsAction'],'ChannelsPage');
async function renderChannels(mode){
 const data=[{id:'synthetic',channel:'line',status:mode==='success'?'passed':'failed',created_at:'2026-09-20T00:00:00Z',checks:[{label:'Messaging API',status:mode==='success'?'passed':'failed',detail:mode==='success'?'Synthetic brand':privateError}]}];
 const q={select:()=>q,eq:()=>q,order:()=>q,limit:()=>q,then:(resolve,reject)=>mode==='throw'?Promise.reject(new Error(privateError)).then(resolve,reject):Promise.resolve({data,error:mode==='error'?{message:privateError}:null}).then(resolve,reject)};
 const Page=channelsPageFactory({React,Link:({href,children})=>React.createElement('a',{href},children),requireAdmin:async()=>({clinicId:'brand'}),createServiceClient:()=>({from:()=>q}),SubmitButton:()=>null,runChannelTestsAction:()=>{}});
 return renderToStaticMarkup(await Page({searchParams:Promise.resolve({})}));
}
test('channel page masks historical raw LINE failures but preserves successful identity',async()=>{
 const html=await renderChannels();assert.match(html,/無法確認 LINE 連線/);assert(!html.includes('secret-token'));assert(!html.includes('test@example.invalid'));assert.match(await renderChannels('success'),/Synthetic brand/);
});
for(const mode of ['error','throw'])test(`channel page ${mode} query is safe`,async()=>{
 await assert.rejects(renderChannels(mode),e=>e.message==='讀取渠道測試失敗，請重新整理後再試');
});
const crmDomain=await compile(read('lib/crm.ts'));
const segmentDeps=['requireAdmin','createServiceClient','SEGMENT_RULE_TYPES','validateSegmentValue','refreshCrm','redirect','console','errorCategory'];
const createSegmentFactory=await extractedFactory('app/admin/crm/actions.ts',['text','createSegmentAction'],segmentDeps);
const refreshSegmentFactory=await extractedFactory('app/admin/crm/actions.ts',['text','refreshSegmentAction'],segmentDeps);
async function segmentHarness(kind,mode){
 const writes=[],calls=[],effects=[],logs=[];
 const supabase={from:table=>{
  assert.equal(table,'crm_segments');
  return {insert:row=>{
   writes.push(row);
   return {select:()=>({single:async()=>{
    if(mode==='insertThrows')throw new Error(privateError);
    return {data:mode==='missing'?null:{id:'segment'},error:mode==='insertError'?{message:privateError}:null};
   }})};
  }};
 }};
 const deps={...crmDomain,requireAdmin:async()=>{if(mode==='auth')throw new Error('AUTH_REDIRECT');return {clinicId:'brand',supabase};},createServiceClient:()=>{if(mode==='client')throw new Error(privateError);return {rpc:async(name,args)=>{calls.push({name,args});if(mode==='refreshThrows')throw new Error(privateError);return {error:mode==='refreshError'?{message:privateError}:null};}};},refreshCrm:()=>effects.push('refresh'),redirect:url=>{effects.push(url);throw new Error('NEXT_REDIRECT');},console:{error:(...args)=>logs.push(args)},errorCategory};
 const fd=new FormData();fd.set('id','segment');fd.set('name','Synthetic segment');fd.set('rule_type','tag_contains');fd.set('rule_value',mode==='invalid'?'':'test');
 let error;try{await (kind==='create'?createSegmentFactory:refreshSegmentFactory)(deps)(fd);}catch(e){error=e;}
 assert(!JSON.stringify(logs).includes('secret-token'));assert(!JSON.stringify(logs).includes('test@example.invalid'));
 return {writes,calls,effects,logs,error};
}
test('segment create success inserts once then refreshes same brand and ID',async()=>{
 const r=await segmentHarness('create');assert.equal(r.error,undefined);assert.equal(r.writes.length,1);assert.equal(r.writes[0].clinic_id,'brand');assert.deepEqual(r.calls,[{name:'refresh_crm_segment',args:{p_clinic_id:'brand',p_segment_id:'segment'}}]);assert.deepEqual(r.effects,['refresh']);
});
for(const mode of ['client','refreshError','refreshThrows'])test(`created segment ${mode} returns partial-success notice without another insert`,async()=>{
 const r=await segmentHarness('create',mode);assert.equal(r.error.message,'NEXT_REDIRECT');assert.equal(r.writes.length,1);assert.deepEqual(r.effects,['refresh','/admin/crm?notice=segment-created-refresh-failed#segments']);assert.equal(r.logs.length,1);
});
for(const mode of ['insertError','insertThrows','missing'])test(`segment ${mode} is safe and does not attempt refresh`,async()=>{
 const r=await segmentHarness('create',mode);assert.match(r.error.message,/無法確認分眾建立結果/);assert.deepEqual(r.calls,[]);assert.deepEqual(r.effects,[]);
});
for(const mode of ['client','refreshError','refreshThrows'])test(`segment retry ${mode} keeps user on existing segment workflow`,async()=>{
 const r=await segmentHarness('refresh',mode);assert.equal(r.writes.length,0);assert.deepEqual(r.effects,['refresh','/admin/crm?notice=segment-refresh-failed#segments']);assert.equal(r.error.message,'NEXT_REDIRECT');
});
test('segment retry success replaces warning URL and never creates another segment',async()=>{
 const r=await segmentHarness('refresh');assert.equal(r.writes.length,0);assert.deepEqual(r.calls,[{name:'refresh_crm_segment',args:{p_clinic_id:'brand',p_segment_id:'segment'}}]);assert.deepEqual(r.effects,['refresh','/admin/crm?notice=segment-refreshed#segments']);assert.equal(r.logs.length,0);
});
for(const kind of ['create','refresh'])test(`segment ${kind} auth rejection has no writes`,async()=>{
 const r=await segmentHarness(kind,'auth');assert.equal(r.error.message,'AUTH_REDIRECT');assert.deepEqual(r.writes,[]);assert.deepEqual(r.calls,[]);assert.deepEqual(r.logs,[]);
});
test('segment rule validation stops before insert',async()=>{
 const r=await segmentHarness('create','invalid');assert.match(r.error.message,/分眾條件/);assert.deepEqual(r.writes,[]);
});
const crmPageFactory=await componentFactory('app/admin/crm/page.tsx',['React','Link','canViewSensitiveCustomerData','requireMember','SubmitButton','AUTOMATION_TRIGGER_LABELS','AUTOMATION_TRIGGER_TYPES','SEGMENT_RULE_LABELS','SEGMENT_RULE_TYPES','describeSegmentRule','createAutomationAction','createSegmentAction','deleteAutomationAction','deleteSegmentAction','refreshSegmentAction','toggleAutomationAction','toggleSegmentAction','updateAutomationAction','isAdminModuleEnabled','ModuleDisabled','AutomationMessageFields','fetchAllSupabasePages'],'CrmPage');
async function renderCrm(notice,role='admin',options={}){
 const queries=[];
 const from=table=>{
  const filters=[];queries.push({table,filters});
  const q={select:()=>q,eq:(key,value)=>{filters.push([key,value]);return q;},is:(key,value)=>{filters.push([key,value]);return q;},order:()=>q,range:()=>q,then:(resolve,reject)=>{
   const key=table==='crm_delivery_logs'?filters.find(([k])=>k==='status')[1]:table;
   const targeted=key===options.target;
   if(targeted&&options.mode==='throw')return Promise.reject(new Error(privateError)).then(resolve,reject);
   const segment={id:'segment',name:'Synthetic segment',rule_type:'tag_contains',rule_value:'test',active:true,description:null,updated_at:'2026-09-20T00:00:00Z'};
   const count=targeted?({null:null,negative:-1,fraction:0.5,unsafe:Number.MAX_SAFE_INTEGER+1}[options.mode]??(options.mode==='null'?null:options.count??0)):options.count??0;
   return Promise.resolve({data:targeted&&options.mode==='missing'?null:table==='crm_segments'?[segment]:[],count,error:targeted&&options.mode==='error'?{message:privateError}:null}).then(resolve,reject);
  }};return q;
 };
 const Page=crmPageFactory({...crmDomain,React,Link:({children,href})=>React.createElement('a',{href},children),requireMember:async()=>({role,clinicId:'brand',supabase:{from}}),canViewSensitiveCustomerData:()=>true,isAdminModuleEnabled:async()=>true,ModuleDisabled:()=>null,SubmitButton:()=>null,AutomationMessageFields:()=>null,fetchAllSupabasePages:async callback=>{const result=await callback(0,999);if(result.error||!Array.isArray(result.data))throw new Error('讀取清單不完整，請重新載入後再試');return result.data;},...Object.fromEntries(['createAutomationAction','createSegmentAction','deleteAutomationAction','deleteSegmentAction','refreshSegmentAction','toggleAutomationAction','toggleSegmentAction','updateAutomationAction'].map(key=>[key,()=>{}]))});
 const html=renderToStaticMarkup(await Page({searchParams:Promise.resolve({notice})}));
 for(const query of queries)assert(query.filters.some(([key,value])=>key==='clinic_id'&&value==='brand'));
 assert(queries.find(query=>query.table==='crm_automations')?.filters.some(([key,value])=>key==='archived_at'&&value===null));
 return html;
}
test('CRM partial-success notice points to existing recalculate action and warns of stale count',async()=>{
 const html=await renderCrm('segment-created-refresh-failed');assert.match(html,/分眾已建立/);assert.match(html,/重新計算/);assert.match(html,/人數可能尚未更新/);assert.match(await renderCrm('segment-refreshed'),/分眾名單已刷新/);
});
test('CRM notice only accepts fixed messages and is hidden from non-editors',async()=>{
 assert(!(await renderCrm(privateError)).includes('secret-token'));assert(!(await renderCrm('segment-created-refresh-failed','staff')).includes('分眾已建立'));
});

for(const target of ['crm_segments','crm_automations','patients','sent','failed','crm_segment_members']){
 for(const mode of ['error','throw'])test(`CRM ${target} ${mode} never renders false zero or raw detail`,async()=>{
  await assert.rejects(renderCrm(undefined,'admin',{target,mode}),e=>e.message==='CRM 統計資料讀取不完整，請重新載入後再試');
 });
}
for(const target of ['patients','sent','failed','crm_segment_members']){
 for(const mode of ['null','negative','fraction','unsafe'])test(`CRM ${target} ${mode} count is rejected`,async()=>{
  await assert.rejects(renderCrm(undefined,'admin',{target,mode}),e=>e.message==='CRM 統計資料讀取不完整，請重新載入後再試');
 });
}
for(const target of ['crm_segments','crm_automations'])test(`CRM ${target} missing data is not an empty list`,async()=>{
 await assert.rejects(renderCrm(undefined,'admin',{target,mode:'missing'}),/統計資料讀取不完整/);
});
test('CRM confirmed zero and positive counts render with brand-scoped queries',async()=>{
 assert.match(await renderCrm(undefined,'admin',{count:0}),/>0 人</);
 assert.match(await renderCrm(undefined,'admin',{count:7}),/>7 人</);
});
test('CRM error boundary explains unavailable statistics without exposing upstream error',async()=>{
 const factory=await componentFactory('app/admin/crm/error.tsx',['React'],'CrmError');const Page=factory({React});
 const html=renderToStaticMarkup(React.createElement(Page,{error:Object.assign(new Error(privateError),{digest:'test-digest'}),reset:()=>{}}));
 assert.match(html,/不代表顧客或投遞數為零/);assert.match(html,/避免重複/);assert.match(html,/test-digest/);assert(!html.includes('secret-token'));
});
const settingsActions=['toggleSegmentAction','deleteSegmentAction','createAutomationAction','updateAutomationAction','toggleAutomationAction','deleteAutomationAction'];
const settingsFactories=Object.fromEntries(await Promise.all(settingsActions.map(async name=>[name,await extractedFactory('app/admin/crm/actions.ts',['text','integer','crmQuery',name],['requireAdmin','refreshCrm','errorCategory','console','AUTOMATION_TRIGGER_TYPES','validateAutomationBody'])])));
async function settingsHarness(name,mode){
 const queries=[],effects=[],logs=[];
 const supabase={from:table=>{
  const record={table,operation:'read',filters:[],returning:false};queries.push(record);
  const q={select:()=>{record.returning=true;return q;},update:body=>{record.operation='update';record.body=body;return q;},insert:body=>{record.operation='insert';record.body=body;return q;},delete:()=>{record.operation='delete';return q;},eq:(key,value)=>{record.filters.push([key,value]);return q;},is:(key,value)=>{record.filters.push([key,value]);return q;},single:()=>q,maybeSingle:()=>q,then:(resolve,reject)=>{
   const isRead=record.operation==='read';const targeted=mode?.startsWith('lookup')?isRead:!isRead;
   if(targeted&&(mode==='throws'||mode==='lookupThrows'))return Promise.reject(new Error(privateError)).then(resolve,reject);
   const missing=targeted&&['missing','lookupMissing','stale'].includes(mode);
   const error=targeted&&['error','lookupError'].includes(mode)?{message:privateError}:null;
   return Promise.resolve({data:missing?null:{id:'target'},error}).then(resolve,reject);
  }};return q;
 }};
 const run=settingsFactories[name]({...crmDomain,requireAdmin:async()=>{if(mode==='auth')throw new Error('AUTH_REDIRECT');return {supabase,clinicId:'brand'};},refreshCrm:()=>effects.push('refresh'),errorCategory,console:{error:(...args)=>logs.push(args)}});
 const fd=new FormData();for(const [key,value] of Object.entries({id:'target',active:mode==='invalid'?'bad':'true',name:'Synthetic automation',trigger_type:'birthday',channel:'line',body:'Synthetic only',segment_id:mode?.startsWith('lookup')?'segment':''}))fd.set(key,value);
 let error;try{await run(fd);}catch(e){error=e;}
 assert(!JSON.stringify(logs).includes('secret-token'));assert(!error?.message.includes('secret-token'));
 return {queries,effects,logs,error};
}
for(const name of settingsActions){
 test(`${name} success is brand-scoped and requires a returned row`,async()=>{
  const r=await settingsHarness(name);assert.equal(r.error,undefined);assert.deepEqual(r.effects,['refresh']);assert.equal(r.queries.length,1);
  const q=r.queries[0];assert.equal(q.returning,true);
  if(q.operation==='insert')assert.equal(q.body.clinic_id,'brand');else{assert(q.filters.some(([k,v])=>k==='clinic_id'&&v==='brand'));assert(q.filters.some(([k,v])=>k==='id'&&v==='target'));}
  if(name==='deleteAutomationAction'){assert.equal(q.operation,'update');assert.equal(q.body.active,false);assert(!Number.isNaN(Date.parse(q.body.archived_at)));assert(q.filters.some(([k,v])=>k==='archived_at'&&v===null));}
  if(name==='updateAutomationAction'||name==='toggleAutomationAction')assert(q.filters.some(([k,v])=>k==='archived_at'&&v===null));
  if(name.startsWith('toggle'))assert(q.filters.some(([k,v])=>k==='active'&&v===true));
 });
 for(const mode of ['error','throws','missing'])test(`${name} ${mode} cannot report success or leak provider text`,async()=>{
  const r=await settingsHarness(name,mode);assert(r.error);assert.deepEqual(r.effects,[]);if(mode!=='missing')assert.equal(r.logs[0][1].category,'connection');
 });
 test(`${name} auth rejection never queries DB`,async()=>{
  const r=await settingsHarness(name,'auth');assert.equal(r.error.message,'AUTH_REDIRECT');assert.deepEqual(r.queries,[]);assert.deepEqual(r.logs,[]);
 });
}
for(const name of ['createAutomationAction','updateAutomationAction']){
 for(const mode of ['lookupError','lookupThrows','lookupMissing'])test(`${name} ${mode} blocks writes`,async()=>{
  const r=await settingsHarness(name,mode);assert(r.error);assert.deepEqual(r.effects,[]);assert(r.queries.every(q=>q.operation==='read'));assert(r.queries[0].filters.some(([k,v])=>k==='clinic_id'&&v==='brand'));
 });
}
for(const name of ['toggleSegmentAction','toggleAutomationAction'])test(`${name} invalid state stops before DB and stale state is rejected`,async()=>{
 const invalid=await settingsHarness(name,'invalid');assert(invalid.error);assert.deepEqual(invalid.queries,[]);
 const stale=await settingsHarness(name,'stale');assert.match(stale.error.message,/狀態已變更/);assert.deepEqual(stale.effects,[]);assert(stale.queries[0].filters.some(([k,v])=>k==='active'&&v===true));
});
