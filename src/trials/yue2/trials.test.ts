import {test,afterEach} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Trials,prepareRequest} from './trials.ts';
const temporary:string[]=[];const temp=()=>{const path=mkdtempSync(join(tmpdir(),'music-trials-'));temporary.push(path);return path;};afterEach(()=>{for(const path of temporary.splice(0))rmSync(path,{recursive:true,force:true});});
const abc=readFileSync(new URL('./fixture.abc',import.meta.url),'utf8');
const input={style:'Piano',lyrics:'[verse]\nhello\n[outro]',instrumental:false,seed:42,preset:'fast' as const};
test('immutable versions, proposals bind hash, rejected proposal retained',async()=>{
 const dir=temp();const t=new Trials(dir);
 const a=await t.importScore(abc,input);const changed=abc.replace('"C"','"Am"');
 const b=await t.propose(a.id,a.hash,changed,'harmony');assert.equal(b.parent,a.id);assert.equal(t.version(a.id).abc,abc);
 await assert.rejects(t.propose(a.id,'stale',changed,'harmony'),/版本/);
 await assert.rejects(t.propose(a.id,a.hash,abc.replace('C32','D32'),'harmony'),/保留/);
 assert.equal(t.snapshot().proposals.at(-1)?.status,'rejected');
 assert.equal(new Trials(dir).snapshot().versions.length,2);
});
test('transfer clears lyric words, fixed ABC survives both presets',async()=>{
 const t=new Trials(temp());const a=await t.importScore(abc,input);
 const b=await t.transfer(a.id,a.hash,'error','Piano');
 assert.equal(b.input.instrumental,true);assert.ok(!b.input.lyrics.includes('hello'));
 for(const preset of ['fast','quality'] as const){const p=prepareRequest({...b.input,preset},b.abc);assert.equal(p.params.abc,b.abc);assert.equal(p.loras.length,2);assert.equal(p.params.cfg_scale,2);}
});
test('restart interrupts pending tasks without running model; unrelated files intact',()=>{
 const dir=temp();writeFileSync(join(dir,'studio.json'),'sentinel');
 writeFileSync(join(dir,'index.json'),JSON.stringify({versions:[],proposals:[],jobs:[{id:'x',status:'running'}]}));
 const t=new Trials(dir);assert.equal(t.snapshot().jobs[0].status,'interrupted');assert.equal(readFileSync(join(dir,'studio.json'),'utf8'),'sentinel');
});
test('fixed score mismatch is a failure; changing vocal mode cannot start a render',async()=>{
 const t=new Trials(temp());const a=await t.importScore(abc,input);
 assert.throws(()=>t.start('render',{...input,instrumental:true,lyrics:'[instrumental]'},a.id,a.hash,async()=>{}),/设置/);
 const {mkdirSync}=await import('node:fs');
 const j=t.start('render',input,a.id,a.hash,async(_job,path,_signal,_report,status)=>{status('succeeded');assert.equal(t.snapshot().jobs[0].status,'queued');mkdirSync(join(path,'song'));writeFileSync(join(path,'song/score.abc'),abc+'changed');writeFileSync(join(path,'song/audio.flac'),'fixture');});
 for(let i=0;i<50&&t.snapshot().jobs[0].status!=='failed';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(t.snapshot().jobs.find(x=>x.id===j.id)?.status,'failed');assert.match(t.snapshot().jobs[0].error!,/不一致/);await t.close();
});
test('plan stores score only; cancellation settles without publishing generated version',async()=>{
 const {mkdirSync}=await import('node:fs');const t=new Trials(temp());
 t.start('plan',input,undefined,undefined,async(_job,path)=>{mkdirSync(join(path,'plan'));writeFileSync(join(path,'plan/score.abc'),abc);});
 for(let i=0;i<50&&t.snapshot().jobs[0].status!=='succeeded';i++)await new Promise(r=>setTimeout(r,10));
 assert.equal(t.snapshot().versions.length,1);assert.equal(t.snapshot().jobs[0].status,'succeeded');
 const j=t.start('plan',input,undefined,undefined,async(_job,_path,signal)=>new Promise<void>((_resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true})));
 t.cancel(j.id);await t.close();assert.equal(t.snapshot().jobs[1].status,'cancelled');assert.equal(t.snapshot().versions.length,1);
});
