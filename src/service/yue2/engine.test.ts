import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,writeFile,symlink,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../projects/store.ts';
import {YuE2Engine,type YuE2Driver,type YuE2Process} from './engine.ts';

async function fixture(t:any) {
  const root=await mkdtemp(join(tmpdir(),'music-yue2-')),directory=join(root,'模型 程序 缓存');
  const store=await ProjectStore.open(join(root,'workspace'));
  let installed=false,models=false,preparations=0,launches=0,stops=0;
  const processes:YuE2Process[]=[];
  const driver:YuE2Driver={
    unsupported:()=>undefined,installed:()=>installed,
    chooseDirectory:async()=>directory,
    prepare:async(_directory,downloadModels,{signal,report})=>{
      preparations++;report('下载运行环境');if(signal.aborted)throw signal.reason;installed=true;if(downloadModels)models=true;
    },
    launch:async(_directory,{signal})=>{
      launches++;if(signal.aborted)throw signal.reason;
      let finish!:(code:number|null)=>void;
      const exited=new Promise<number|null>(resolve=>{finish=resolve;});
      const run={url:'http://127.0.0.1:18999',exited,status:async()=>({modelsPresent:models,fake:false}),stop:async()=>{stops++;finish(0);}};
      processes.push(run);return run;
    },
  };
  const engine=await YuE2Engine.open(store,driver);
  t.after(async()=>{await engine.close();await store.close();await rm(root,{recursive:true,force:true});});
  return {root,directory,store,engine,driver,processes,counts:()=>({preparations,launches,stops})};
}
async function settled(engine:YuE2Engine) {
  for(let i=0;i<100;i++){const s=await engine.status();if(!['preparing','starting','stopping'].includes(s.phase))return s;await new Promise(r=>setTimeout(r,5));}throw new Error('engine did not settle');
}
test('one enable action installs into the selected folder, starts the engine and persists auto-start',async t=>{
  const {engine,directory,store,driver,counts}=await fixture(t);
  assert.equal((await engine.status()).phase,'uninstalled');
  await engine.prepare(directory,true);const running=await settled(engine);
  assert.equal(running.phase,'running');assert.equal(running.modelsReady,true);assert.equal(running.canGenerate,true);
  assert.equal(running.directory,await realpath(directory));assert.deepEqual(counts(),{preparations:1,launches:1,stops:0});
  await engine.start();assert.equal(counts().launches,1,'repeated start cannot spawn a second engine');
  await engine.close();assert.equal(counts().stops,1);
  const resumed=await YuE2Engine.open(store,driver);t.after(()=>resumed.close());
  assert.equal((await settled(resumed)).phase,'running');assert.equal(counts().launches,2);
  await resumed.stop();await resumed.close();
  const disabled=await YuE2Engine.open(store,driver);t.after(()=>disabled.close());
  assert.equal((await disabled.status()).autoStart,false);assert.equal(counts().launches,2,'explicit stop stays stopped on restart');
});
test('a running engine without weights is not reported as generation-ready',async t=>{
  const {engine,directory,counts}=await fixture(t);await engine.prepare(directory,false);
  const ready=await settled(engine);assert.equal(ready.phase,'running');assert.equal(ready.canGenerate,false);
  await engine.prepare(directory,true);assert.equal((await settled(engine)).canGenerate,true);
  assert.equal(counts().stops,1,'weight installation stops the owned service first');
});
test('stop cancels installation and permits retry; its late completion cannot start an engine',async t=>{
  const {engine,directory,driver,counts}=await fixture(t);let entered!:()=>void;
  const begun=new Promise<void>(r=>{entered=r;});const prepare=driver.prepare;
  driver.prepare=async(_directory,_models,{signal})=>{entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));};
  await engine.prepare(directory,true);await begun;
  await assert.rejects(engine.prepare(directory,false),/正在/);
  await engine.stop();assert.equal(counts().launches,0);assert.equal((await engine.status()).autoStart,false);
  driver.prepare=prepare;await engine.prepare(directory,true);assert.equal((await settled(engine)).phase,'running');
});
test('startup failure is readable, retains installed files and allows a clean retry',async t=>{
  const {engine,directory,driver}=await fixture(t);const launch=driver.launch;
  driver.launch=async()=>{throw new Error('Metal could not initialise');};
  await engine.prepare(directory,true);const failed=await settled(engine);
  assert.equal(failed.phase,'failed');assert.match(failed.error??'',/Metal/);assert.equal(failed.installed,true);
  driver.launch=launch;await engine.start();assert.equal((await settled(engine)).phase,'running');
});
test('root ownership rejects concurrent engines and unrelated or symlinked folders',async t=>{
  const {engine,directory,store,driver,root}=await fixture(t);
  const unrelated=join(root,'my-files');await mkdir(unrelated);await writeFile(join(unrelated,'keep.txt'),'original');
  await assert.rejects(engine.prepare(unrelated,true),/空文件夹/);assert.equal(await readFile(join(unrelated,'keep.txt'),'utf8'),'original');
  const linked=join(root,'linked');await symlink(unrelated,linked);await assert.rejects(engine.prepare(linked,true),/符号链接/);
  await assert.rejects(engine.prepare('relative-path',true),/绝对路径/);
  await engine.prepare(directory,true);await settled(engine);
  const otherStore=await ProjectStore.open(join(root,'other-workspace')),other=await YuE2Engine.open(otherStore,driver);
  t.after(async()=>{await other.close();await otherStore.close();});
  await other.prepare(directory,true);const failed=await settled(other);
  assert.equal(failed.phase,'failed');assert.match(failed.error??'',/正在使用/);
  assert.equal((await engine.status()).phase,'running','a competing owner cannot stop the original engine');
});
test('unsupported computers do not download or block the rest of the workbench',async t=>{
  const {engine,directory,driver,counts,store}=await fixture(t);await engine.close();
  driver.unsupported=()=> 'YuE2 需要 Apple Silicon Mac';
  const unsupported=await YuE2Engine.open(store,driver);t.after(()=>unsupported.close());
  assert.equal((await unsupported.status()).phase,'unsupported');
  await assert.rejects(unsupported.prepare(directory,true),/Apple Silicon/);assert.equal(counts().preparations,0);
  assert.deepEqual(await store.projects(),[]);
});
test('corrupt optional engine settings do not prevent opening the project library',async t=>{
  const {engine,store,driver}=await fixture(t);await engine.close();await mkdir(store.path('engines'));await writeFile(store.path('engines','yue2.json'),'{broken');
  const recovered=await YuE2Engine.open(store,driver);t.after(()=>recovered.close());
  assert.equal((await recovered.status()).phase,'failed');assert.deepEqual(await store.projects(),[]);
});
