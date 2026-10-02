import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

async function factory(path,name,deps){
  const source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const body=source.statements.filter(node=>!ts.isImportDeclaration(node)).map(node=>node.getText(source).replace(/^export /,'')).join('\n');
  const {outputText}=ts.transpileModule(`export function factory(deps){const {${deps.join(',')}}=deps;${body};return ${name};}`,{fileName:'calendar.ts',compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
  return (await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'))).factory;
}

const fetchAllSupabasePages=(await factory('lib/supabase-pagination.ts','fetchAllSupabasePages',['adminQuery','adminErrorMessage']))({adminQuery:async query=>await query,adminErrorMessage:()=> '讀取清單失敗'});
const route=(await factory('app/api/admin/calendar/route.ts','GET',['NextResponse','requireMember','getAssignedDoctorIds','createSupabaseServer','canViewSensitiveCustomerData','fail','fetchAllSupabasePages']));
const start='2026-10-01T00:00:00.000Z';
const end='2026-10-01T00:25:00.000Z';
const appointment=(id,clinic_id='own',doctor_id='assigned')=>({id,clinic_id,doctor_id,start_at:start,end_at:end,status:'booked',visit_type:'return',deposit_status:'none',doctors:{name:'Provider'},patients:{name:'Synthetic Customer',phone:'0912345678'},services:{name:'Service'}});

function setup(rows,role='admin',failSecondPage=false){
  const ranges=[];
  const orders=[];
  const db={from:table=>{
    assert.equal(table,'appointments');
    const filters=[];
    let from=0,to=999;
    const q={
      select:()=>q,
      eq:(field,value)=>{filters.push(row=>row[field]===value);return q;},
      gte:(field,value)=>{filters.push(row=>row[field]>=value);return q;},
      lt:(field,value)=>{filters.push(row=>row[field]<value);return q;},
      in:(field,values)=>{filters.push(row=>values.includes(row[field]));return q;},
      order:field=>{orders.push(field);return q;},
      range:(first,last)=>{from=first;to=last;ranges.push([first,last]);return q;},
      then:(resolve,reject)=>{
        if(failSecondPage&&from>=1000)return Promise.resolve({data:null,error:{message:'SYNTHETIC_PRIVATE_DB_ERROR'}}).then(resolve,reject);
        const data=rows.filter(row=>filters.every(filter=>filter(row))).sort((a,b)=>a.start_at.localeCompare(b.start_at)||a.id.localeCompare(b.id)).slice(from,to+1);
        return Promise.resolve({data,error:null}).then(resolve,reject);
      },
    };
    return q;
  }};
  const GET=route({NextResponse:{json:Response.json},requireMember:async()=>({clinicId:'own',role}),getAssignedDoctorIds:async()=>['assigned'],createSupabaseServer:async()=>db,canViewSensitiveCustomerData:value=>value==='admin',fail:()=>Response.json({error:'安全錯誤'},{status:500}),fetchAllSupabasePages});
  return {GET,ranges,orders};
}

function request(){return {nextUrl:new URL('https://example.invalid/api/admin/calendar?start=2026-10-01&end=2026-10-02')};}

test('calendar returns the 1,001st appointment, with stable ordering and tenant filtering',async()=>{
  const rows=Array.from({length:1001},(_,i)=>appointment(`a${String(i).padStart(4,'0')}`));
  rows.push(appointment('FOREIGN_MARKER','foreign'));
  const harness=setup(rows);
  const response=await harness.GET(request());
  const body=await response.json();
  assert.equal(response.status,200);
  assert.equal(body.events.length,1001);
  assert.equal(body.events.at(-1).id,'a1000');
  assert(!body.events.some(row=>row.id==='FOREIGN_MARKER'));
  assert.deepEqual(harness.ranges,[[0,999],[1000,1999]]);
  assert.deepEqual(harness.orders,['start_at','id','start_at','id']);
});

test('provider sees only assigned appointments with masked phone',async()=>{
  const harness=setup([appointment('allowed'),appointment('unassigned','own','another')],'provider');
  const response=await harness.GET(request());
  const body=await response.json();
  assert.equal(response.status,200);
  assert.deepEqual(body.events.map(row=>row.id),['allowed']);
  assert.equal(body.events[0].extendedProps.customerPhone,'••••••5678');
});

test('a failed later page rejects the whole calendar instead of returning a partial 200',async()=>{
  const rows=Array.from({length:1001},(_,i)=>appointment(`a${String(i).padStart(4,'0')}`));
  const harness=setup(rows,'admin',true);
  const response=await harness.GET(request());
  assert.equal(response.status,500);
  const body=await response.json();
  assert.equal(body.events,undefined);
  assert.deepEqual(harness.ranges,[[0,999],[1000,1999]]);
});
