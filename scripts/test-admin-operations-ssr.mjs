import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';

const secret='PRIVATE_SSR_CANARY_0912345678';
const denied=Error('NEXT_REDIRECT');
const safe='目前無法確認操作結果';
function load(path,deps){
  const exports={};
  const js=ts.transpileModule(fs.readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  vm.runInNewContext(js,{exports,require:name=>{if(name in deps)return deps[name];throw Error(`Unexpected dependency ${name}`);},Error,Promise,URLSearchParams,console});
  return exports;
}
function fixture({role='staff',rows={},errors={},deny=false,moduleEnabled=true}={}){
  const queries=[],props=[];
  let factoryCalls=0;
  const client={from(table){
    const call={table,filters:[],projection:null};queries.push(call);
    const query=new Proxy({}, {get:(_,key)=>key==='then'
      ?(resolve,reject)=>Promise.resolve({data:rows[table]??null,error:errors[table]??null}).then(resolve,reject)
      :(...args)=>{if(key==='select')call.projection=args[0];else call.filters.push([key,...args]);return query;}});
    return query;
  }};
  const member={clinicId:'fixture-brand',role,user:{id:'fixture-user'},supabase:client};
  const capture=name=>function Capture(componentProps){props.push({name,props:componentProps});return null;};
  const deps={
    'react/jsx-runtime':jsx,
    'next/link':{default:({href,children})=>jsx.jsx('a',{href,children})},
    'next/navigation':{notFound:()=>{throw Error('NEXT_NOT_FOUND');}},
    '@/lib/admin-query':{adminQuery:async value=>await value,adminErrorMessage:()=>safe},
    '@/lib/admin':{
      requireOperator:async()=>{if(deny)throw denied;return member;},
      requireNonProvider:async()=>{if(deny||role==='provider')throw denied;return member;},
      requireMember:async()=>{if(deny)throw denied;return member;},
      requireAdmin:async()=>{if(deny)throw denied;return member;},
      getAssignedDoctorIds:async()=>['doctor-a'],
      canOperate:currentRole=>currentRole!=='provider',
      canViewSensitiveCustomerData:currentRole=>currentRole!=='provider',
      hasBrandPermission:()=>false,
    },
    '@/lib/supabase':{createServiceClient:()=>{factoryCalls++;return client;}},
    '@/lib/supabase-server':{createSupabaseServer:async()=>{factoryCalls++;return client;}},
    '@/lib/slots':{formatTime:()=> '10:00'},
    '@/components/AdminModal':{AdminModal:({children})=>jsx.jsx('div',{children})},
    '@/components/SubmitButton':{SubmitButton:({children})=>jsx.jsx('button',{children})},
    '@/lib/supabase-pagination':{fetchAllSupabasePages:async fetchPage=>{const result=await fetchPage(0,999);if(result.error)throw Error(safe);return result.data??[];}},
    '@/lib/report-range':{reportRange:()=>({start:'2026-09-23T00:00:00.000Z',end:'2026-09-23T23:59:59.999Z'})},
    '@/components/AutoRefresh':{AutoRefresh:()=>null},
    '../_components/BookingForm':{default:capture('BookingForm')},
    '../appointment-actions':{createAppointmentAction:()=>{},rescheduleAppointmentAction:()=>{}},
    './CreateSalesOrderForm':{default:capture('CreateSalesOrderForm')},
    './CalendarWorkspace':{CalendarWorkspace:capture('CalendarWorkspace')},
    '../appointments/AppointmentEditor':{default:capture('AppointmentEditor')},
    '../AppointmentEditor':{default:capture('AppointmentEditor')},
    '../../AppointmentEditor':{default:capture('AppointmentEditor')},
    './SalesOrderEditor':{default:capture('SalesOrderEditor')},
    '@/lib/chatQueries':{buildThreads:async()=>[{lineUserId:'line-fixture',name:'Fixture Customer',lastBody:'Fixture message',lastAt:'2026-09-23T00:00:00Z',lastSender:'patient',unread:1,blocked:false}]},
    '@/lib/admin-modules':{isAdminModuleEnabled:async()=>moduleEnabled},
    '@/components/ModuleDisabled':{ModuleDisabled:()=>jsx.jsx('p',{children:'模組未啟用'})},
    './ChatConsole':{default:capture('ChatConsole')},
    './actions':{recordSalesPaymentAction:()=>{},updateSalesOrderItemAction:()=>{}},
    './AddSalesItemPanel':{AddSalesItemPanel:capture('AddSalesItemPanel')},
    './new/SalesOrderEditor':{default:capture('SalesOrderEditor')},
    './DeletePatientButton':{DeletePatientButton:capture('DeletePatientButton')},
    '../schedule-actions':new Proxy({},{get:()=>()=>{}}),
    '../_components/ScheduleEditor':{default:capture('ScheduleEditor')},
    '../_components/EntityManager':{default:capture('EntityManager')},
    '@/components/admin/ManagementTabs':{ServiceSetupTabs:()=>null},
    '../line-actions':{saveMessageAction:()=>{},deleteMessageAction:()=>{}},
    './MessageComposer':{default:capture('MessageComposer')},
    './LineTemplateGallery':{default:capture('LineTemplateGallery')},
    './RepliesEditor':{default:capture('RepliesEditor')},
    './LineReplySettingsEditor':{default:capture('LineReplySettingsEditor')},
    '../memberships/actions':{assignPatientMembershipLevelAction:()=>{}},
    '../patient-actions':{updatePatientDetailsAction:()=>{}},
  };
  return {client,queries,props,member,deps,factoryCalls:()=>factoryCalls,render:async element=>renderToStaticMarkup(element)};
}

test('appointment editor: authorized projection, brand scope and safe return URL',async()=>{
  const f=fixture({rows:{clinic_settings:{booking_mode:'time'},doctors:[{id:'doctor-a',name:'Fixture Provider'}],services:[{id:'service-a',name:'Fixture Service',booking_target:'provider_required'}],clinics:{slug:'fixture-brand'},appointments:{id:'appointment-a',doctor_id:'doctor-a',service_id:'service-a',start_at:'2026-09-30T02:00:00Z',status:'booked',patients:{name:'Fixture Customer'}}}});
  const page=load('app/admin/appointments/AppointmentEditor.tsx',f.deps);
  const html=await f.render(await page.default({appointmentId:'appointment-a',returnTo:'//evil.invalid'}));
  assert.match(html,/改期/);assert.ok(!html.includes('evil.invalid'));
  const form=f.props.find(x=>x.name==='BookingForm')?.props;
  assert.equal(form.initialTargetId,'appointment-a');assert.equal(form.clinicSlug,'fixture-brand');assert.equal(form.returnTo,'/admin');
  for(const q of f.queries)assert.ok(q.filters.some(([name,column,value])=>name==='eq'&&column===(q.table==='clinics'?'id':'clinic_id')&&value==='fixture-brand'));
  assert.equal(f.queries.find(q=>q.table==='appointments').projection,'id, doctor_id, service_id, start_at, status, patients(name)');
});

for(const table of ['clinic_settings','doctors','services','clinics','appointments'])test(`appointment editor: ${table} failure is safe`,async()=>{
  const f=fixture({rows:{appointments:{id:'appointment-a'}},errors:{[table]:{message:secret}}});
  const page=load('app/admin/appointments/AppointmentEditor.tsx',f.deps);
  await assert.rejects(()=>page.default({appointmentId:'appointment-a'}),error=>{assert.match(error.message,/目前無法確認/);assert.ok(!error.message.includes(secret));return true;});
  assert.equal(f.props.length,0);
});

test('appointment editor denies role before service-role client creation',async()=>{
  const f=fixture({deny:true});const page=load('app/admin/appointments/AppointmentEditor.tsx',f.deps);
  await assert.rejects(()=>page.default({}),error=>error===denied);assert.equal(f.factoryCalls(),0);assert.equal(f.queries.length,0);
});

test('sales editor projects only scoped source options',async()=>{
  const f=fixture({rows:{appointments:[{id:'appointment-a',start_at:'2026-09-30T02:00:00Z',patients:{name:'Fixture Customer',private:secret},services:{name:'Fixture Service',price:500,private:secret},private:secret}],registrations:[{id:'registration-a',registration_no:'R1',name:'Attendee',amount:300,events:{title:'Class'},private:secret}],patients:[{id:'patient-a',name:'Fixture Customer',phone:'0912345678',private:secret}]}});
  const page=load('app/admin/checkout/new/SalesOrderEditor.tsx',f.deps);
  await f.render(await page.default({appointmentId:'appointment-a'}));
  const form=f.props.find(x=>x.name==='CreateSalesOrderForm')?.props;
  assert.equal(form.defaultSource,'appointment:appointment-a');assert.equal(form.options.length,3);assert.ok(!JSON.stringify(form.options).includes(secret));
  for(const q of f.queries)assert.ok(q.filters.some(([name,column,value])=>name==='eq'&&column==='clinic_id'&&value==='fixture-brand'));
  assert.equal(f.queries.find(q=>q.table==='patients').projection,'id, name, phone');
});

for(const table of ['appointments','registrations','patients'])test(`sales editor: ${table} failure is safe`,async()=>{
  const f=fixture({errors:{[table]:{message:secret}}});const page=load('app/admin/checkout/new/SalesOrderEditor.tsx',f.deps);
  await assert.rejects(()=>page.default({}),error=>{assert.match(error.message,/目前無法確認/);assert.ok(!error.message.includes(secret));return true;});
  assert.equal(f.props.length,0);
});

test('sales editor denies provider before queries',async()=>{
  const f=fixture({role:'provider'});const page=load('app/admin/checkout/new/SalesOrderEditor.tsx',f.deps);
  await assert.rejects(()=>page.default({}),error=>error===denied);assert.equal(f.queries.length,0);
});

test('calendar page restricts provider list to assigned doctor and ignores unrelated modal data',async()=>{
  const f=fixture({role:'provider',rows:{doctors:[{id:'doctor-a',name:'Fixture Provider'}]}});
  const page=load('app/admin/calendar/page.tsx',f.deps);
  await f.render(await page.default({searchParams:Promise.resolve({modal:'invalid',date:'2026-09-30'})}));
  const q=f.queries.find(x=>x.table==='doctors');assert.equal(q.projection,'id, name');
  assert.ok(q.filters.some(([name,column,ids])=>name==='in'&&column==='id'&&ids.includes('doctor-a')));
  assert.equal(f.props.find(x=>x.name==='CalendarWorkspace')?.props.canOperate,false);
  assert.ok(!f.props.some(x=>x.name==='AppointmentEditor'));
});

test('calendar page fails closed on doctor lookup error',async()=>{
  const f=fixture({errors:{doctors:{message:secret}}});const page=load('app/admin/calendar/page.tsx',f.deps);
  await assert.rejects(()=>page.default({searchParams:Promise.resolve({})}),error=>{assert.match(error.message,/目前無法確認/);assert.ok(!error.message.includes(secret));return true;});
});

test('chat page sends only scoped thread data to chat console',async()=>{
  const f=fixture();const page=load('app/admin/chat/page.tsx',f.deps);
  await f.render(await page.default());
  const consoleProps=f.props.find(x=>x.name==='ChatConsole')?.props;
  assert.equal(consoleProps.initialThreads.length,1);assert.equal(consoleProps.initialThreads[0].lineUserId,'line-fixture');
});

test('checkout page shows only same-brand projected sources',async()=>{
  const f=fixture({rows:{sales_orders:[],services:[],inventory_items:[],membership_plans:[]}});
  const page=load('app/admin/checkout/page.tsx',f.deps);
  const html=await f.render(await page.default({searchParams:Promise.resolve({})}));
  assert.match(html,/結帳中心/);
  for(const q of f.queries)assert.ok(q.filters.some(([name,column,value])=>name==='eq'&&column==='clinic_id'&&value==='fixture-brand'));
  assert.equal(f.queries.find(q=>q.table==='sales_orders'&&q.projection?.includes('patients(name)'))?.projection.includes('patients(name)'),true);
});

test('checkout selected order renders business fields without extra private columns',async()=>{
  const order={id:'order-a',order_no:'SO-1',appointment_id:'appointment-a',registration_id:null,patient_id:'patient-a',status:'open',subtotal:500,discount_amount:0,total_amount:500,paid_amount:0,created_at:'2026-09-23T00:00:00Z',patients:{name:'Fixture Customer',private:secret},sales_order_items:[{id:'item-a',kind:'service',name:'Fixture Service',quantity:1,unit_price:500,line_total:500,created_at:'2026-09-23T00:00:00Z',private:secret}],sales_payments:[],private:secret};
  const f=fixture({rows:{sales_orders:[order],services:[{id:'service-a',name:'Fixture Service',price:500,private:secret}],inventory_items:[],membership_plans:[]}});
  const page=load('app/admin/checkout/page.tsx',f.deps);
  const html=await f.render(await page.default({searchParams:Promise.resolve({order_id:'order-a'})}));
  assert.match(html,/SO-1/);assert.match(html,/Fixture Service/);assert.ok(!html.includes(secret));
  const panel=f.props.find(x=>x.name==='AddSalesItemPanel')?.props;
  assert.equal(panel.orderId,'order-a');assert.ok(!JSON.stringify(panel).includes(secret));
});

for(const table of ['sales_orders','services','inventory_items','membership_plans'])test(`checkout page: ${table} failure is safe`,async()=>{
  const f=fixture({errors:{[table]:{message:secret}}});const page=load('app/admin/checkout/page.tsx',f.deps);
  await assert.rejects(()=>page.default({searchParams:Promise.resolve({})}),error=>{assert.match(error.message,/目前無法確認/);assert.ok(!error.message.includes(secret));return true;});
});

test('patient list: provider receives no customer query',async()=>{
  const f=fixture({role:'provider'});const page=load('app/admin/patients/page.tsx',f.deps);
  const html=await f.render(await page.default({searchParams:Promise.resolve({})}));
  assert.match(html,/不開放完整顧客名單/);assert.equal(f.queries.length,0);assert.equal(f.factoryCalls(),0);
});

test('patient list: brand scoped empty state and query failure boundary',async()=>{
  const f=fixture({rows:{patients:[]}});const page=load('app/admin/patients/page.tsx',f.deps);
  const html=await f.render(await page.default({searchParams:Promise.resolve({})}));
  assert.match(html,/顧客名單/);
  assert.ok(f.queries.find(q=>q.table==='patients').filters.some(([name,column,value])=>name==='eq'&&column==='clinic_id'&&value==='fixture-brand'));
  const broken=fixture({errors:{patients:{message:secret}}});const brokenPage=load('app/admin/patients/page.tsx',broken.deps);
  await assert.rejects(()=>brokenPage.default({searchParams:Promise.resolve({})}),error=>{assert.match(error.message,/目前無法確認/);assert.ok(!error.message.includes(secret));return true;});
});

test('patient list renders only selected columns and same-brand appointment counts',async()=>{
  const f=fixture({rows:{patients:[{id:'patient-a',name:'Fixture Customer',phone:'0912345678',birthday:null,gender:null,tags:null,blocked_until:null,membership_level_id:null,created_at:'2026-09-23T00:00:00Z',private:secret}],appointments:[{patient_id:'patient-a',status:'no_show',private:secret}]}});
  const page=load('app/admin/patients/page.tsx',f.deps);
  const html=await f.render(await page.default({searchParams:Promise.resolve({})}));
  assert.match(html,/Fixture Customer/);assert.match(html,/0912345678/);assert.ok(!html.includes(secret));
  const patients=f.queries.find(q=>q.table==='patients');assert.equal(patients.projection,'id, name, phone, birthday, gender, tags, blocked_until, membership_level_id, created_at');
  for(const q of f.queries.filter(q=>['patients','appointments'].includes(q.table)))assert.ok(q.filters.some(([name,column,value])=>name==='eq'&&column==='clinic_id'&&value==='fixture-brand'));
});

test('chat page disabled module does not pass threads to client',async()=>{
  const f=fixture({moduleEnabled:false});const page=load('app/admin/chat/page.tsx',f.deps);
  const html=await f.render(await page.default());assert.match(html,/模組未啟用/);assert.ok(!f.props.some(x=>x.name==='ChatConsole'));
});

test('new appointment route delegates to the guarded editor',async()=>{
  const f=fixture();const page=load('app/admin/appointments/new/page.tsx',f.deps);
  await f.render(await page.default({searchParams:Promise.resolve({date:'2026-09-30',return_to:'/admin/calendar'})}));
  const editor=f.props.find(x=>x.name==='AppointmentEditor')?.props;
  assert.equal(editor.date,'2026-09-30');assert.equal(editor.returnTo,'/admin/calendar');
});

test('reschedule route forwards only id and return target to the guarded editor',async()=>{
  const f=fixture();const page=load('app/admin/appointments/[id]/reschedule/page.tsx',f.deps);
  await f.render(await page.default({params:Promise.resolve({id:'appointment-a'}),searchParams:Promise.resolve({return_to:'/admin'})}));
  const editor=f.props.find(x=>x.name==='AppointmentEditor')?.props;
  assert.equal(editor.appointmentId,'appointment-a');assert.equal(editor.returnTo,'/admin');
});

test('new sales route delegates to the guarded source editor',async()=>{
  const f=fixture();const page=load('app/admin/checkout/new/page.tsx',f.deps);
  await f.render(await page.default({searchParams:Promise.resolve({appointment_id:'appointment-a',registration_id:'registration-a'})}));
  const editor=f.props.find(x=>x.name==='SalesOrderEditor')?.props;
  assert.equal(editor.appointmentId,'appointment-a');assert.equal(editor.registrationId,'registration-a');
});

test('legacy beauty route redirects without querying brand data',()=>{
  const f=fixture();f.deps['next/navigation'].redirect=target=>{assert.equal(target,'/admin/operations/inventory');throw denied;};
  const page=load('app/admin/beauty/page.tsx',f.deps);
  assert.throws(()=>page.default(),error=>error===denied);assert.equal(f.queries.length,0);
});

test('schedules page projects scoped people, service and every schedule segment',async()=>{
  const f=fixture({rows:{doctors:[{id:'doctor-a',name:'Fixture Provider',specialty:null,active:true}],schedule_templates:[{id:'segment-a',doctor_id:'doctor-a',service_id:null,weekday:1,start_time:'09:00',end_time:'12:00',slot_minutes:30,capacity:1,active:true},{id:'segment-b',doctor_id:'doctor-a',service_id:null,weekday:1,start_time:'13:00',end_time:'18:00',slot_minutes:30,capacity:1,active:true}],services:[{id:'service-a',name:'Fixture Service',active:true}]}});
  const page=load('app/admin/schedules/page.tsx',f.deps);
  const html=await f.render(await page.default());
  assert.match(html,/啟用時段/);assert.match(html,/>2</);
  assert.equal(f.props.find(x=>x.name==='ScheduleEditor')?.props.templates.length,2);
  for(const q of f.queries)assert.ok(q.filters.some(([name,column,value])=>name==='eq'&&column==='clinic_id'&&value==='fixture-brand'));
});

for(const table of ['doctors','schedule_templates','services'])test(`schedules page: ${table} failure cannot look empty`,async()=>{
  const f=fixture({errors:{[table]:{message:secret}}});const page=load('app/admin/schedules/page.tsx',f.deps);
  await assert.rejects(()=>page.default(),error=>{assert.match(error.message,/目前無法確認/);assert.ok(!error.message.includes(secret));return true;});
});

test('LINE template page sends only display settings to gallery',async()=>{
  const f=fixture({rows:{clinics:{name:'Fixture Brand',private:secret},clinic_settings:{line_flex_designs:{booking:{title:'Fixture card'}},brand_primary_color:'#123456',brand_accent_color:'#abcdef',private:secret}}});
  const page=load('app/admin/line-templates/page.tsx',f.deps);
  await f.render(await page.default({searchParams:Promise.resolve({template:'booking'})}));
  const gallery=f.props.find(x=>x.name==='LineTemplateGallery')?.props;
  assert.equal(gallery.clinicName,'Fixture Brand');assert.equal(gallery.initialTemplateKey,'booking');assert.ok(!JSON.stringify(gallery).includes(secret));
  for(const q of f.queries)assert.ok(q.filters.some(([name,column,value])=>name==='eq'&&column===(q.table==='clinics'?'id':'clinic_id')&&value==='fixture-brand'));
});

for(const table of ['clinics','clinic_settings'])test(`LINE template page: ${table} failure cannot look default`,async()=>{
  const f=fixture({rows:{clinics:{name:'Fixture Brand'},clinic_settings:{line_flex_designs:{}}},errors:{[table]:{message:secret}}});
  const page=load('app/admin/line-templates/page.tsx',f.deps);
  await assert.rejects(()=>page.default({searchParams:Promise.resolve({})}),error=>{assert.match(error.message,/目前無法確認/);assert.ok(!error.message.includes(secret));return true;});
});

test('LINE message list sends selected brand record to composer',async()=>{
  const f=fixture({rows:{line_messages:[{id:'message-a',name:'Fixture Message',kind:'text',data:{text:'Hello'},private:secret}]}});
  const page=load('app/admin/messages/page.tsx',f.deps);
  const html=await f.render(await page.default({searchParams:Promise.resolve({edit:'message-a'})}));
  assert.match(html,/Fixture Message/);assert.ok(!html.includes(secret));
  const q=f.queries.find(x=>x.table==='line_messages');assert.equal(q.projection,'id, name, kind, data');assert.ok(q.filters.some(([name,column,value])=>name==='eq'&&column==='clinic_id'&&value==='fixture-brand'));
});

test('LINE message list: read failure cannot look like zero saved messages',async()=>{
  const f=fixture({errors:{line_messages:{message:secret}}});const page=load('app/admin/messages/page.tsx',f.deps);
  await assert.rejects(()=>page.default({searchParams:Promise.resolve({})}),error=>{assert.match(error.message,/目前無法確認/);assert.ok(!error.message.includes(secret));return true;});
});

test('LINE replies page sends scoped selected data without extra private columns',async()=>{
  const f=fixture({rows:{
    line_auto_replies:[{id:'reply-a',keywords:['hello'],action:'text',reply_text:'Fixture reply',message_id:null,sort:1,active:true,private:secret}],
    clinic_settings:{line_welcome_text:'Welcome',line_fallback_text:'Fallback',line_menu_title:'Menu',private:secret},
    line_messages:[{id:'message-a',name:'Fixture Message',kind:'text',data:{text:'Hello'},private:secret}],
    clinics:{name:'Fixture Brand',private:secret},
  }});
  const page=load('app/admin/replies/page.tsx',f.deps);
  const html=await f.render(await page.default());
  assert.match(html,/自動回覆設定/);assert.match(html,/>1</);assert.ok(!html.includes(secret));
  assert.equal(f.props.find(x=>x.name==='RepliesEditor')?.props.replies.length,1);
  assert.equal(f.props.find(x=>x.name==='LineReplySettingsEditor')?.props.clinicName,'Fixture Brand');
  for(const q of f.queries)assert.ok(q.filters.some(([name,column,value])=>name==='eq'&&column===(q.table==='clinics'?'id':'clinic_id')&&value==='fixture-brand'));
  assert.equal(f.queries.find(x=>x.table==='line_messages').projection,'id, name, kind, data');
});

for(const table of ['line_auto_replies','clinic_settings','line_messages','clinics'])test(`LINE replies page: ${table} failure cannot look empty`,async()=>{
  const f=fixture({rows:{clinic_settings:{},clinics:{name:'Fixture Brand'}},errors:{[table]:{message:secret}}});
  const page=load('app/admin/replies/page.tsx',f.deps);
  await assert.rejects(()=>page.default(),error=>{assert.match(error.message,/目前無法確認/);assert.ok(!error.message.includes(secret));return true;});
  assert.equal(f.props.length,0);
});

for(const table of ['clinic_settings','clinics'])test(`LINE replies page: missing ${table} cannot look default`,async()=>{
  const rows={clinic_settings:{},clinics:{name:'Fixture Brand'}};rows[table]=null;
  const f=fixture({rows});const page=load('app/admin/replies/page.tsx',f.deps);
  await assert.rejects(()=>page.default(),error=>{assert.match(error.message,/目前無法確認/);return true;});
});
