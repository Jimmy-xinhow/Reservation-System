import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {assessCronHealth} from './check-cron-health.mjs';
const jobs=['reminders','marketing','membership','followups','registration','richmenu','subscription-freezes'];
const secret='synthetic-cron-secret';
const privateText='private@example.invalid Bearer hidden-provider-token';
test('Railway groups cover every Vercel job once at the same cadence without crash retries',()=>{
 const expected=JSON.parse(readFileSync('vercel.json','utf8')).crons;
 const actual=[];
 for(const file of readdirSync('deploy/cron')){
  if(file==='health-monitor.json')continue;
  const config=JSON.parse(readFileSync('deploy/cron/'+file,'utf8'));
  assert.equal(config.deploy.restartPolicyType,'NEVER');
  const match=/^node scripts\/trigger-reminders\.mjs --jobs=([a-z,-]+)$/.exec(config.deploy.startCommand);assert(match);
  for(const job of match[1].split(','))actual.push({path:'/api/cron/'+job,schedule:config.deploy.cronSchedule});
 }
 assert.equal(new Set(actual.map(x=>x.path)).size,7);
 assert.deepEqual(actual.sort((a,b)=>a.path.localeCompare(b.path)),expected.sort((a,b)=>a.path.localeCompare(b.path)));
});
test('independent health monitor is scheduled without crash retries or business jobs',()=>{
 const config=JSON.parse(readFileSync('deploy/cron/health-monitor.json','utf8'));
 assert.equal(config.deploy.startCommand,'node scripts/monitor-cron-health.mjs');
 assert.equal(config.deploy.cronSchedule,'*/5 * * * *');
 assert.equal(config.deploy.restartPolicyType,'NEVER');
});
async function exercise(response, args=[], extraEnv={}, healthResponse=null) {
 const seen=[];
 const server=createServer(async(req,res)=>{let raw='';for await(const chunk of req)raw+=chunk;seen.push({path:req.url,method:req.method,body:raw?JSON.parse(raw):null,authorized:req.headers.authorization===`Bearer ${secret}`}); if(req.url==='/api/cron/reminders')return response(req,res);if(req.url==='/api/cron/health'&&healthResponse)return healthResponse(req,res);res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,sent:0}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try {
  const env={...process.env,CRON_SECRET:secret,APP_URL:`http://127.0.0.1:${server.address().port}`};
  for(const key of Object.keys(env))if(/^CRON_.*TARGET_URL$/.test(key)||['CRON_SCOPES_JSON','CRON_SCOPE_EXPIRES_AT','CRON_HEALTH_ENABLED'].includes(key))delete env[key];
  Object.assign(env,extraEnv);
  const child=spawn(process.execPath,['scripts/trigger-reminders.mjs',...args],{env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
  const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
  return {code,stdout,stderr,seen,records:(stdout+stderr).trim().split('\n').map(line=>JSON.parse(line))};
 } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
}
const json=body=>(req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
test('selected worker calls only its assigned jobs',async()=>{const r=await exercise(json({ok:true}),['--jobs=followups,registration,richmenu']);assert.equal(r.code,0);assert.deepEqual(r.seen.map(r=>r.path),['followups','registration','richmenu'].map(j=>'/api/cron/'+j));assert.equal(r.records.find(r=>r.event==='cron_run').jobs,3);});
for(const args of [['--jobs='],['--jobs=reminders,unknown'],['--jobs=reminders,reminders'],['--unexpected'],['--jobs=reminders','--jobs=marketing']])test(`invalid selection sends no requests: ${args.join(' ')}`,async()=>{const r=await exercise(json({ok:true}),args);assert.equal(r.code,1);assert.equal(r.seen.length,0);assert.equal(r.records[0].status,'invalid_jobs');assert(Number.isFinite(Date.parse(r.records[0].at)));assert.equal(assessCronHealth(r.records,jobs,120000).status,'configuration_failed');});
test('missing cron secret produces a timestamped health failure without sending',async()=>{const r=await exercise(json({ok:true}),[],{CRON_SECRET:''});assert.equal(r.code,1);assert.equal(r.seen.length,0);assert.equal(r.records[0].status,'missing_secret');assert.equal(assessCronHealth(r.records,jobs,120000).status,'configuration_failed');assert(!r.stderr.includes(secret));});
test('missing target produces a timestamped health failure without sending',async()=>{const r=await exercise(json({ok:true}),[],{APP_URL:''});assert.equal(r.code,1);assert.equal(r.seen.length,0);assert.equal(r.records[0].status,'missing_target');assert.equal(assessCronHealth(r.records,jobs,120000).status,'configuration_failed');});
test('runner calls all seven authenticated jobs and logs safe counters',async()=>{const r=await exercise(json({ok:true,sent:2,note:privateText}));assert.equal(r.code,0);assert.deepEqual(r.seen.map(r=>r.path),jobs.map(j=>'/api/cron/'+j));assert(r.seen.every(r=>r.authorized));assert.equal(r.records.find(r=>r.job==='reminders').counts.sent,2);assert(!r.stdout.includes(privateText));assert(!r.stdout.includes(secret));});
test('enabled health records the exact job result without identifiers or response content',async()=>{const r=await exercise(json({ok:true,sent:0,note:privateText}),['--jobs=reminders'],{CRON_HEALTH_ENABLED:'1'});assert.equal(r.code,0);assert.deepEqual(r.seen.map(item=>item.path),['/api/cron/reminders','/api/cron/health']);assert(r.seen.every(item=>item.authorized));assert.equal(r.seen[1].body.job,'reminders');assert.equal(r.seen[1].body.status,'success');assert.equal(r.seen[1].body.result_code,'success');assert.equal(r.seen[1].body.http_status,200);assert(!JSON.stringify(r.seen[1].body).includes(privateText));assert(!r.stdout.includes(privateText));});
test('health write failure marks the run failed without retrying a successful job',async()=>{const r=await exercise(json({ok:true}),['--jobs=reminders'],{CRON_HEALTH_ENABLED:'1'},(req,res)=>{res.statusCode=500;res.end(privateText);});assert.equal(r.code,1);assert.deepEqual(r.seen.map(item=>item.path),['/api/cron/reminders','/api/cron/health']);assert(r.records.some(item=>item.event==='cron_health_write'&&item.status==='failed'));assert(r.records.some(item=>item.event==='cron_run'&&item.status==='failed'));assert(!r.stderr.includes(privateText));});
test('failed work is persisted as failed, without leaking provider details',async()=>{const r=await exercise(json({ok:false,error:privateText}),['--jobs=reminders'],{CRON_HEALTH_ENABLED:'1'});assert.equal(r.code,1);assert.equal(r.seen[1].body.status,'failed');assert.equal(r.seen[1].body.result_code,'invalid_or_failed_result');assert(!JSON.stringify(r.seen[1].body).includes(privateText));});
test('invalid health setting sends no work',async()=>{const r=await exercise(json({ok:true}),['--jobs=reminders'],{CRON_HEALTH_ENABLED:'yes'});assert.equal(r.code,1);assert.equal(r.seen.length,0);assert.equal(r.records[0].status,'invalid_health_setting');});
for(const [label,body] of [['ok false',{ok:false,errors:[privateText]}],['failed count',{ok:true,failed:1}],['nested queue failure',{ok:true,notifications:{failed:1}}],['unknown delivery',{ok:true,unconfirmed:1}],['status write failure',{ok:true,status_write_failed:1}],['CRM write failure',{ok:true,crm_failed:1}],['nested result failure',{ok:true,results:[{ok:false,error:privateText}]}],['missing result contract',{sent:1}]]) {
 test(`runner fails on ${label} while continuing other jobs`,async()=>{const r=await exercise(json(body));assert.equal(r.code,1);assert.equal(r.seen.length,7);assert(!r.stderr.includes(privateText));assert(r.records.some(r=>r.event==='cron_run'&&r.status==='failed'));});
}
test('HTTP failure does not print response body',async()=>{const r=await exercise((req,res)=>{res.statusCode=500;res.end(privateText);});assert.equal(r.code,1);assert.equal(r.seen.length,7);assert(!r.stderr.includes(privateText));});
test('HTML success response fails validation',async()=>{const r=await exercise((req,res)=>res.end('<html>'+privateText+'</html>'));assert.equal(r.code,1);assert.equal(r.seen.length,7);assert(!r.stderr.includes(privateText));});
test('redirect is not followed with the cron credential',async()=>{const r=await exercise((req,res)=>{res.writeHead(302,{Location:'/redirect-destination'});res.end();});assert.equal(r.code,1);assert(!r.seen.some(r=>r.path==='/redirect-destination'));assert.equal(r.seen.length,7);});
test('connection failure still executes remaining jobs without private exception text',async()=>{const r=await exercise(req=>req.socket.destroy());assert.equal(r.code,1);assert.equal(r.seen.length,7);assert.equal(r.records.find(r=>r.job==='reminders').status,'request_failed');});

for (const channel of ['lineFailed','emailFailed']) test(`reminder ${channel} is a failure even with legacy ok true`,async()=>{
 const r=await exercise(json({ok:true,[channel]:1,line:0,email:0}));
 assert.equal(r.code,1);assert.equal(r.seen.length,7);
 const job=r.records.find(r=>r.job==='reminders');assert.equal(job.status,'partial_failure');assert.equal(job.counts[channel],1);
});

const clinic='11111111-1111-4111-8111-111111111111',record='22222222-2222-4222-8222-222222222222';
const scopeMap={reminders:{clinic_id:clinic,appointment_ids:[record]},marketing:{clinic_id:clinic,automation_ids:[record],patient_ids:[record]},membership:{clinic_id:clinic,membership_ids:[record]},followups:{clinic_id:clinic,followup_ids:[record]},registration:{clinic_id:clinic,registration_ids:[record],appointment_ids:[],membership_payment_ids:[],waitlist_ids:[]},richmenu:{clinic_id:clinic,schedule_ids:[record]},'subscription-freezes':{clinic_id:clinic,subscription_ids:[record]}};
const scopeEnv=map=>({CRON_SCOPES_JSON:JSON.stringify(map),CRON_SCOPE_EXPIRES_AT:new Date(Date.now()+3600000).toISOString()});
test('scoped worker sends all seven exact POST bodies without scope values in logs',async()=>{const r=await exercise(json({ok:true}),['--scoped'],scopeEnv(scopeMap));assert.equal(r.code,0);assert.equal(r.seen.length,7);for(const request of r.seen){assert.equal(request.method,'POST');assert.deepEqual(request.body,scopeMap[request.path.split('/').at(-1)]);}assert(!r.stdout.includes(clinic));assert(!r.stdout.includes(record));assert.equal(new Set(r.records.map(r=>r.run_id)).size,1);assert(r.records.every(r=>r.mode==='scoped'));});
test('scoped worker selected subset does not require other scopes',async()=>{const r=await exercise(json({ok:true}),['--scoped','--jobs=reminders'],scopeEnv({reminders:scopeMap.reminders}));assert.equal(r.code,0);assert.equal(r.seen.length,1);});
for(const [label,env,args]of[
 ['missing',{},['--scoped']],['invalid JSON',{...scopeEnv(scopeMap),CRON_SCOPES_JSON:'{'},['--scoped']],
 ['expired',{...scopeEnv(scopeMap),CRON_SCOPE_EXPIRES_AT:'2000-01-01T00:00:00Z'},['--scoped']],
 ['no expiry',{CRON_SCOPES_JSON:JSON.stringify(scopeMap)},['--scoped']],
 ['missing job',scopeEnv({reminders:scopeMap.reminders}),['--scoped']],
 ['extra job',scopeEnv({...scopeMap,unknown:scopeMap.reminders}),['--scoped']],
 ['missing flag',scopeEnv(scopeMap),[]],['duplicate flag',scopeEnv(scopeMap),['--scoped','--scoped']],
 ['duplicate IDs',scopeEnv({...scopeMap,reminders:{clinic_id:clinic,appointment_ids:[record,record]}}),['--scoped']],
 ['empty regular selection',scopeEnv({...scopeMap,reminders:{clinic_id:clinic,appointment_ids:[]}}),['--scoped']],
 ['empty composite selection',scopeEnv({...scopeMap,registration:{clinic_id:clinic,registration_ids:[],appointment_ids:[],membership_payment_ids:[],waitlist_ids:[]}}),['--scoped']],
 ['missing composite key',scopeEnv({...scopeMap,registration:{clinic_id:clinic,registration_ids:[record]}}),['--scoped']],
 ['extra scope key',scopeEnv({...scopeMap,reminders:{...scopeMap.reminders,all:true}}),['--scoped']],
 ['bad brand',scopeEnv({...scopeMap,reminders:{...scopeMap.reminders,clinic_id:'bad'}}),['--scoped']],
])test('scoped preflight rejects '+label+' before any request',async()=>{const r=await exercise(json({ok:true}),args,env);assert.equal(r.code,1);assert.equal(r.seen.length,0);assert(!r.stderr.includes(secret));assert(Number.isFinite(Date.parse(r.records[0].at)));assert.equal(assessCronHealth(r.records,jobs,120000).status,'configuration_failed');});
test('scoped 409 keeps all later requests scoped and never retries rejected work',async()=>{const r=await exercise((req,res)=>{res.statusCode=409;res.end(privateText);},['--scoped'],scopeEnv(scopeMap));assert.equal(r.code,1);assert.equal(r.seen.length,7);assert(r.seen.every(r=>r.method==='POST'));assert(!r.stderr.includes(privateText));});
test('scope expiry during first request stops all remaining jobs',async()=>{const env={...scopeEnv(scopeMap),CRON_SCOPE_EXPIRES_AT:new Date(Date.now()+1000).toISOString()};const r=await exercise((req,res)=>setTimeout(()=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));},1200),['--scoped'],env);assert.equal(r.code,1);assert.equal(r.seen.length,1);assert(r.records.some(r=>r.status==='scope_expired'&&Number.isFinite(Date.parse(r.at))));assert.equal(assessCronHealth(r.records,jobs,120000).ok,false);});
