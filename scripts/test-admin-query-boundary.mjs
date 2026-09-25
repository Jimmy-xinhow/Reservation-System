import assert from 'node:assert/strict';import test from 'node:test';import fs from 'node:fs';import ts from 'typescript';import vm from 'node:vm';import * as crypto from 'node:crypto';
const canary='PRIVATE_NAME 0912345678 private@example.invalid TOKEN_SECRET';
function compile(file,require){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,{exports,require,Error,URL,FormData,Buffer,process:{env:{}},console:{error:()=>{throw Error('Unexpected logging');}}});return exports;}
const categories=compile('lib/error-category.ts',()=>({}));const boundary=compile('lib/admin-query.ts',n=>n==='@/lib/error-category'?categories:{});
const pagination=compile('lib/supabase-pagination.ts',n=>n==='@/lib/admin-query'?boundary:{});
function safe(e){assert.match(e.message,/目前無法確認操作結果/);assert.ok(!e.stack.includes('PRIVATE_NAME'));assert.ok(!e.stack.includes('TOKEN_SECRET'));assert.equal(e.cause,undefined);return true;}
function harness(file,{mode='returned',message=canary,code='XX000',data=null}={}){
 const calls=[],refreshes=[];let awaits=0;
 function chain(){let q; q=new Proxy({}, {get:(_,k)=>k==='then'?(resolve,reject)=>{awaits++;return(mode==='thrown'?Promise.reject(Error(message,{cause:Error(message)})):Promise.resolve({data,error:mode==='success'?null:{message,code},count:0})).then(resolve,reject);}:(...args)=>{calls.push([k,...args]);return q;}});return q;}
 const service={from:(...args)=>{calls.push(['from',...args]);return chain();},rpc:(...args)=>{calls.push(['rpc',...args]);return chain();},auth:{admin:{listUsers:()=>chain(),createUser:()=>chain(),updateUserById:()=>chain()},signOut:()=>chain()}};
 const member={supabase:service,clinicId:'own-clinic',user:{id:'actor'},clinics:[],permissions:[],accessType:'brand_admin'};
 const deps={
  'server-only':{},'@/lib/admin-query':boundary,'@/lib/supabase-pagination':pagination,'node:crypto':crypto,
  'next/cache':{revalidatePath:p=>refreshes.push(p)},'next/navigation':{redirect:p=>{throw Error('REDIRECT:'+p);}},
  'next/headers':{cookies:async()=>({set:()=>{throw Error('Unexpected cookie write');}}),headers:async()=>new Headers()},
  '@/lib/admin':new Proxy({hasBrandPermission:()=>true,canOperate:()=>true,canViewSensitiveCustomerData:()=>true},{get:(t,k)=>k in t?t[k]:async()=>member}),
  '@/lib/platform':{requireSystemPermission:async()=>member},'@/lib/supabase':{createServiceClient:()=>service},'@/lib/supabase-server':{createSupabaseServer:async()=>service},
  '@/lib/admin-modules':{isAdminModuleEnabled:async()=>true},
 };
 const api=compile(file,n=>n in deps?deps[n]:{});
 return{api,calls,refreshes,awaits:()=>awaits};
}
const actions=[
 ['actions.ts','createBrandAction',{name:'test',slug:'test-brand'}],
 ['beauty/actions.ts','createInventoryItemAction',{name:'test'}],
 ['beauty/supply/actions.ts','createSupplierAction',{name:'test'}],
 ['checkout/actions.ts','recordSalesPaymentAction',{method:'cash',amount:'10',order_id:'order'}],
 ['course-content/actions.ts','toggleCourseUnitAction',{id:'unit'}],
 ['customer-value/actions.ts','adjustWalletAction',{kind:'purchase',amount:'10',patient_id:'patient'}],
 ['documents/actions.ts','createDocumentTemplateAction',{name:'test',body:'test',kind:'consent'}],
 ['events/actions.ts','setEventStatusAction',{id:'event',status:'published'}],
 ['fitness/actions.ts','freezeSubscriptionAction',{subscription_id:'subscription',starts_on:'2026-10-01',ends_on:'2026-10-02'}],
 ['memberships/actions.ts','toggleMembershipPlanAction',{id:'plan'}],
 ['patient-actions.ts','updatePatientBasicAction',{id:'patient',name:'test',phone:'0900000000'}],
 ['platform/reports/actions.ts','startTrialObservationAction',{clinic_id:'brand'}],
 ['products/actions.ts','createProductAction',{name:'test',reorder_level:'0',retail_price:'10',stock_on_hand:'0'}],
 ['resources/actions.ts','createResourceAction',{name:'test',kind:'room'}],
 ['schedule-actions.ts','createDoctorAction',{name:'test'}],
 ['service-actions.ts','createServiceAction',{name:'test'}],
 ['settings/actions.ts','updateClinicProfileAction',{name:'test',slug:'test'}],
 ['users/actions.ts','listClinicDoctors',{}],
];
for(const [path,name,values]of actions)for(const mode of ['returned','thrown'])test(`${path} ${name}: ${mode} DB failure`,async()=>{
 const h=harness('app/admin/'+path,{mode});assert.equal(typeof h.api[name],'function',name);
 await assert.rejects(h.api[name](new FormDataFrom(values)),safe);assert.equal(h.awaits(),1);assert.equal(h.refreshes.length,0);
 assert.ok(h.calls.some(([m,...args])=>(m==='eq'&&args[0]==='clinic_id'&&args[1]==='own-clinic')||(m==='rpc'&&(args[1]?.p_clinic_id||args[1]?.p_source_clinic_id==='own-clinic'))||(path==='settings/actions.ts'&&m==='eq'&&args[0]==='id'&&args[1]==='own-clinic')||(m==='insert'&&args[0]?.clinic_id==='own-clinic')),'tenant restriction retained');
});
function FormDataFrom(values){const fd=new FormData();for(const[k,v]of Object.entries(values))fd.set(k,v);return fd;}
const scope=JSON.parse(fs.readFileSync('docs/g3-03-admin-boundary-scope-2026-09-21.json'));
for(const{path}of scope.changes.filter(r=>r.path.endsWith('.tsx')))for(const mode of ['returned','thrown'])test(`${path}: read failure does not render data`,async()=>{const h=harness(path,{mode});await assert.rejects(h.api.default({searchParams:Promise.resolve({})}),safe);assert.ok(h.awaits()>0);});
for(const [message,category]of [[canary,'internal'],['duplicate key '+canary,'database'],['fetch failed '+canary,'connection']])test(`query failure ${category} strips message and cause`,async()=>{await assert.rejects(boundary.adminQuery(Promise.reject(Error(message,{cause:Error(canary)}))),e=>{safe(e);assert.ok(e.message.endsWith(`（${category}）`));return true;});});
test('returned business code and successful data remain available to callers',async()=>{const result={data:{id:'x'},error:{code:'23505',message:'duplicate key'}};assert.equal(await boundary.adminQuery(Promise.resolve(result)),result);});
const rules=[
 ['customer-value/actions.ts','adjustWalletAction',{kind:'purchase',amount:'10'},'insufficient '+canary,'顧客儲值餘額不足'],
 ['customer-value/actions.ts','adjustPointsAction',{kind:'redeem',points:'10'},'insufficient '+canary,'顧客點數不足'],
 ['beauty/actions.ts','recordInventoryMovementAction',{kind:'sale',quantity:'1'},'insufficient '+canary,'目前庫存不足，無法扣除'],
 ['products/actions.ts','createProductAction',{name:'test',reorder_level:'0',retail_price:'10',stock_on_hand:'0'},'duplicate key '+canary,'這個商品編號已被使用，請改用其他編號'],
 ['fitness/actions.ts','freezeSubscriptionAction',{subscription_id:'s',starts_on:'2026-10-01',ends_on:'2026-10-02'},'overlaps '+canary,'這段期間與既有凍結紀錄重疊'],
 ['checkout/actions.ts','recordSalesPaymentAction',{method:'cash',amount:'10'},'exceeds outstanding '+canary,'收款金額不可超過未收金額'],
 ['checkout/actions.ts','recordSalesPaymentAction',{method:'cash',amount:'10'},'cannot receive '+canary,'這張銷售單目前不能再收款'],
];
for(const[path,name,values,message,expected]of rules)test(`${name}: existing business message preserved`,async()=>{const h=harness('app/admin/'+path,{message});await assert.rejects(h.api[name](FormDataFrom(values)),e=>e.message===expected);});
test('local product validation remains specific and performs no write',async()=>{const h=harness('app/admin/products/actions.ts');await assert.rejects(h.api.createProductAction(FormDataFrom({name:'test',retail_price:'-1',reorder_level:'0'})),/商品售價必須是 0 以上的數字/);assert.equal(h.awaits(),0);});
test('successful scoped update still revalidates',async()=>{const h=harness('app/admin/patient-actions.ts',{mode:'success',data:{id:'patient'}});await h.api.updatePatientBasicAction(FormDataFrom({id:'patient',name:'test',phone:'0900000000'}));assert.deepEqual(h.refreshes,['/admin/patients/patient','/admin/patients']);assert.equal(h.awaits(),1);assert.ok(h.calls.some(([method])=>method==='maybeSingle'));});
test('a zero-row scoped customer update reports missing customer instead of success',async()=>{const h=harness('app/admin/patient-actions.ts',{mode:'success',data:null});await assert.rejects(h.api.updatePatientBasicAction(FormDataFrom({id:'foreign-patient',name:'test',phone:'0900000000'})),/找不到目前品牌的顧客/);assert.equal(h.refreshes.length,0);assert.ok(h.calls.some(([method,key,value])=>method==='eq'&&key==='clinic_id'&&value==='own-clinic'));});
// Evaluate every changed real error expression, including aliases, null coalescing and template strings.
for(const{path}of scope.changes)test(`${path}: all sanitized throw expressions exclude upstream details`,()=>{
 const source=fs.readFileSync(path,'utf8'),sf=ts.createSourceFile(path,source,99,true);let count=0;
 function visit(n){if(ts.isThrowStatement(n)&&ts.isNewExpression(n.expression)){const arg=n.expression.arguments?.[0];if(arg&&arg.getText(sf).includes('adminErrorMessage')){const ctx={adminErrorMessage:boundary.adminErrorMessage};function bind(node){if(ts.isPropertyAccessExpression(node)&&node.name.text==='message'&&ts.isIdentifier(node.expression))ctx[node.expression.text]={message:canary};if(ts.isCallExpression(node)&&node.expression.getText(sf)==='adminErrorMessage'){function bindArgument(value){if(ts.isIdentifier(value)&&!(ts.isPropertyAccessExpression(value.parent)&&value.parent.name===value))ctx[value.text]??={message:canary};ts.forEachChild(value,bindArgument);}bindArgument(node.arguments[0]);}ts.forEachChild(node,bind);}bind(arg);const result=vm.runInNewContext(arg.getText(sf),ctx);assert.ok(!result.includes('PRIVATE_NAME'));assert.ok(result.includes('目前無法確認操作結果'));count++;}}ts.forEachChild(n,visit);}visit(sf);if(count===0&&path==='app/admin/memberships/page.tsx'){assert.equal((source.match(/fetchAllSupabasePages\(/g)||[]).length,4);assert.ok(!source.includes('.limit('));}else if(count===0&&path==='app/admin/registrations/page.tsx'){assert.equal((source.match(/fetchAllSupabasePages\(/g)||[]).length,3);assert.ok(!source.includes('.limit('));}else if(count===0&&path==='app/admin/customer-value/page.tsx'){assert.equal((source.match(/fetchAllSupabasePages\(/g)||[]).length,4);assert.ok(!source.includes('.limit('));assert.ok(!source.includes('supabase.from("patients")'));}else assert.ok(count>0);
});
