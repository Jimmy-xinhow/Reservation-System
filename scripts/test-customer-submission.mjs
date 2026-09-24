import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
const source=readFileSync(new URL('../lib/customer-submission.ts',import.meta.url),'utf8');
const {outputText}=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022}});
const {customerSubmissionFetch:send,canonicalSubmission}=await import('data:text/javascript;base64,'+Buffer.from(outputText).toString('base64'));
const storage=new Map();
globalThis.window={location:{origin:'https://staging.example'},localStorage:{getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)}};
const req=body=>({method:'POST',body:JSON.stringify(body)});
const url='/api/booking/reserve?clinic_slug=test';
const calls=[];
const response=(status,ok)=>new Response(JSON.stringify({ok,data:ok?{appointment_id:'saved'}:null}),{status,headers:{'Content-Type':'application/json'}});
test('canonical payload is independent of object key order and retains array order',()=>{
 assert.equal(canonicalSubmission({b:1,a:{z:2,y:3}}),canonicalSubmission({a:{y:3,z:2},b:1}));
 assert.notEqual(canonicalSubmission([1,2]),canonicalSubmission([2,1]));
});
test('lost response keeps same request ID; acknowledged success clears it; new intent gets new ID',async()=>{
 globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));throw new TypeError('offline');};
 await assert.rejects(send(url,req({patient_id:'one',start_at:'2026-10-01'})),/送出結果尚未確認/);
 const first=calls.at(-1).request_id;assert.equal(storage.size,1);
 globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));return response(200,true);};
 await send(url,req({start_at:'2026-10-01',patient_id:'one'}));assert.equal(calls.at(-1).request_id,first);assert.equal(storage.size,0);
 await send(url,req({patient_id:'one',start_at:'2026-10-01'}));assert.notEqual(calls.at(-1).request_id,first);
});
test('500 and malformed success preserve identity; changed customer or payload cannot reuse it',async()=>{
 globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));return response(503,false);};
 await send(url,req({patient_id:'one',start_at:'2026-10-02'}));const first=calls.at(-1).request_id;
 await send(url,req({patient_id:'one',start_at:'2026-10-02'}));assert.equal(calls.at(-1).request_id,first);
 await send(url,req({patient_id:'two',start_at:'2026-10-02'}));assert.notEqual(calls.at(-1).request_id,first);
 globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));return new Response('incomplete',{status:200});};
 await send(url,req({patient_id:'one',start_at:'2026-10-02'}));assert.equal(calls.at(-1).request_id,first);assert.ok([...storage.values()].includes(first));
});
test('renewed browser token keeps pending request for the same signed customer',async()=>{
 globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));return response(503,false);};
 const token=n=>Buffer.from(JSON.stringify({clinicId:'clinic',patientId:'person',expiresAt:n})).toString('base64url')+'.signature';
 await send(url,req({browser_token:token(1),start_at:'2026-10-03'}));const first=calls.at(-1).request_id;
 await send(url,req({browser_token:token(2),start_at:'2026-10-03'}));assert.equal(calls.at(-1).request_id,first);
 assert.ok([...storage.keys()].every(k=>/^customer_submission:[a-f0-9]{64}$/.test(k)));
 assert.ok([...storage.values()].every(v=>!v.includes('person')));
});
test('overlapping sends with the same pending payload share one stored request ID',async()=>{
 const waiting=[];globalThis.fetch=async(_url,init)=>{calls.push(JSON.parse(init.body));return new Promise(resolve=>waiting.push(resolve));};
 const a=send(url,req({patient_id:'parallel',start_at:'2026-10-04'}));const b=send(url,req({patient_id:'parallel',start_at:'2026-10-04'}));
 while(waiting.length<2)await new Promise(r=>setTimeout(r,1));
 assert.equal(calls.at(-1).request_id,calls.at(-2).request_id);waiting.forEach(resolve=>resolve(response(200,true)));await Promise.all([a,b]);
});
