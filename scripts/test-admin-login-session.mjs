import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

async function visit(search, brandLookup=null) {
  const effects=[]; const state=[]; let signouts=0; const replacements=[]; const requests=[];
  const code=ts.transpileModule(readFileSync(new URL('../app/admin/login/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};
  vm.runInNewContext(code,{exports,URLSearchParams,window:{location:{search},history:{replaceState:(_s,_t,url)=>replacements.push(url)}},fetch:async url=>{requests.push(url);if(!brandLookup)throw Error('Unexpected brand lookup');return {ok:true,json:async()=>brandLookup};},require:(name)=>{
    if(name==='react')return {useEffect:fn=>effects.push(fn),useState:initial=>[initial,value=>state.push(value)]};
    if(name==='react/jsx-runtime')return {jsx:()=>null,jsxs:()=>null};
    if(name==='next/navigation')return {useRouter:()=>({})};
    if(name==='@/lib/supabase-browser')return {createSupabaseBrowser:()=>({auth:{signOut:async()=>{signouts++;}}})};
    if(name==='../actions')return {setActiveClinicAction:async()=>{}};
    throw Error('Unexpected import '+name);
  }});
  exports.default();for(const effect of effects)effect();await new Promise(resolve=>setImmediate(resolve));
  return {signouts,replacements,state,requests};
}

test('access refusal preserves current login and permission reason',async()=>{
  for(const reason of ['platform-access-required','brand-access-required','unknown']){
    const r=await visit('?reason='+reason);assert.equal(r.signouts,0);assert.deepEqual(r.replacements,[]);assert(r.state.includes(true));
  }
});
test('accepted invitation still clears its temporary session',async()=>{
  const r=await visit('?invite=accepted');assert.equal(r.signouts,1);assert.deepEqual(r.replacements,['/admin/login']);
});
test('ordinary login page does not revoke an existing session',async()=>{
  const r=await visit('');assert.equal(r.signouts,0);assert.deepEqual(r.replacements,[]);
});
test('full brand UUID resolves the targeted login instead of showing an invalid entry',async()=>{
  const id='7410ceb9-9d6f-4d67-a6ce-c14a3414765c';
  const r=await visit(`?brand=${id}`,{id,name:'QA Role Matrix Brand'});
  assert.deepEqual(r.requests,[`/api/admin/brand-entry?brand=${id}`]);
  assert(r.state.includes(id));
  assert(r.state.includes('QA Role Matrix Brand'));
  assert(!r.state.includes('品牌入口無效，請從系統管理的品牌清單重新進入。'));
});
