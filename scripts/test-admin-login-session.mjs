import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

async function visit(search) {
  const effects=[]; const state=[]; let signouts=0; const replacements=[];
  const code=ts.transpileModule(readFileSync(new URL('../app/admin/login/page.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  const exports={};
  vm.runInNewContext(code,{exports,URLSearchParams,window:{location:{search},history:{replaceState:(_s,_t,url)=>replacements.push(url)}},require:(name)=>{
    if(name==='react')return {useEffect:fn=>effects.push(fn),useState:initial=>[initial,value=>state.push(value)]};
    if(name==='react/jsx-runtime')return {jsx:()=>null,jsxs:()=>null};
    if(name==='next/navigation')return {useRouter:()=>({})};
    if(name==='@/lib/supabase-browser')return {createSupabaseBrowser:()=>({auth:{signOut:async()=>{signouts++;}}})};
    if(name==='../actions')return {setActiveClinicAction:async()=>{}};
    throw Error('Unexpected import '+name);
  }});
  exports.default();for(const effect of effects)effect();await Promise.resolve();
  return {signouts,replacements,state};
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
