import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import ts from 'typescript';
import vm from 'node:vm';
const read=p=>fs.readFileSync(p,'utf8');
const compile=s=>ts.transpileModule(s,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
const exp={};vm.runInNewContext(compile(read('lib/error-category.ts')+read('lib/delivery-error.ts').replace(/^import .*;\r?\n/,'')),{exports:exp,Error,Set});
const {deliveryError}=exp;
const secret='fetch failed TEST_PRIVATE_NAME 0912345678 private@example.invalid Bearer SYNTHETIC_SECRET';
const files=['app/admin/appointment-actions.ts','app/admin/line-actions.ts','app/admin/line/page.tsx','app/admin/richmenu/page.tsx'];
for(const path of files)test(path+' all logged exceptions discard provider payload',()=>{
 const source=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true);let count=0;
 function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='console.error'){
 const logs=[];vm.runInNewContext(compile(node.getText(source)),{deliveryError,Error,console:{error:(...v)=>logs.push(v)},errorId:'ABC123',cause:new Error(secret),e:new Error(secret),error:new Error(secret),caught:new Error(secret),notificationError:new Error(secret),cleanupError:{message:secret},compensationError:new Error(secret),failureRecordError:{message:secret},auditError:new Error(secret),botResult:{reason:new Error(secret)},quotaResult:{reason:new Error(secret)},consumptionResult:{reason:new Error(secret)}});
 assert(!JSON.stringify(logs).includes('SYNTHETIC_SECRET'));assert(!JSON.stringify(logs).includes('0912345678'));assert.equal(typeof logs[0][1].category,'string');count++;}
 ts.forEachChild(node,visit);}
 visit(source);assert.equal(count,path.includes('appointment-actions')?4:path.includes('line-actions')?10:path.includes('line/page')?3:1);
});
function action(name, deps){const s=ts.createSourceFile('actions',read('app/admin/line-actions.ts'),ts.ScriptTarget.Latest,true);const names=['str','intOr',name];const code=names.map(n=>s.statements.find(x=>ts.isFunctionDeclaration(x)&&x.name?.text===n).getText(s)).join('\n');const exports={};vm.runInNewContext(compile('class RichMenuUserError extends Error {}\n'+code),{exports,Error,deliveryError,randomUUID:()=> '12345678',revalidatePath:()=>{},...deps});return exports[name];}
test('publication query failure stores safe reason; audit failure does not escape or leak',async()=>{
 const records=[],logs=[];const q={select:()=>q,eq:()=>q,maybeSingle:async()=>({data:null,error:{message:secret}})};const db={from:()=>q,rpc:async(n,p)=>{records.push([n,p]);throw Error(secret);}};
 const fn=action('publishRichMenuAction',{requireAdmin:async()=>({clinicId:'own',user:{id:'actor'}}),createServiceClient:()=>db,console:{error:(...v)=>logs.push(v)}});
 const result=await fn(new Map([['version_id','version']]));assert.equal(result.ok,false);assert.equal(records.length,1);assert.equal(records[0][1].p_clinic_id,'own');assert.match(records[0][1].p_error,/^delivery_error:/);assert(!JSON.stringify({records,logs,result}).includes('SYNTHETIC_SECRET'));
});
test('LINE validation provider failure persists safe reason and preserves redirect control flow',async()=>{
 const writes=[],logs=[];const q={update:v=>{writes.push(v);return q;},eq:async()=>({error:{message:secret}})};const redirectSignal=new Error('NEXT_REDIRECT');
 const fn=action('verifyLineChannelSettingsAction',{requireAdmin:async()=>({supabase:{},clinicId:'own'}),createServiceClient:()=>({from:()=>q}),getClinicLineChannelContext:async()=>({enabled:true,destination:'bot',loginChannelId:'login',liffId:'liff'}),lineAccessTokenForDestination:async()=>{throw Error(secret);},redirect:()=>{throw redirectSignal;},console:{error:(...v)=>logs.push(v)}});
 await assert.rejects(fn(),e=>e===redirectSignal);assert.equal(writes.length,1);assert.match(writes[0].verification_error,/^delivery_error:/);assert(!JSON.stringify({writes,logs}).includes('SYNTHETIC_SECRET'));
});
test('database error reaches action framework as safe message; input validation stays actionable',async()=>{
 const q={insert:async()=>({error:{message:secret}})};
 const fn=action('createReplyAction',{REPLY_ACTIONS:['text','booking','query','progress','message'],requireAdmin:async()=>({supabase:{from:()=>q},clinicId:'own'}),console:{error:()=>{}}});
 await assert.rejects(fn(new Map([['keywords','hello'],['action','text']])),e=>e.message.includes('操作暫時無法完成')&&!e.message.includes('SYNTHETIC_SECRET')&&!e.message.includes('0912345678'));
 await assert.rejects(fn(new Map()),e=>e.message==='請填關鍵字');
});
