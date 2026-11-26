import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium,webkit} from 'playwright';
import {MusicService} from '../../src/service/service.ts';
import {serveHttp} from '../../src/server/http.ts';
import {testResources} from '../../src/service/resources/testing.ts';

async function withLiveWorkbench(check,beforeStart){
 const root=await mkdtemp(join(tmpdir(),'magenta-live-ui-'));
 const read=p=>readFile(resolve('dist',p));
 const music={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
 const speech={installed:()=>false,prepare:async()=>{},generate:async()=>{throw Error('unused');}};
 let generated=0,released=false;const moves=[];
 const pcm=new Uint8Array(Int16Array.from({length:96000},(_,i)=>Math.round(4000*Math.sin(i*.05))).buffer);
 const live={installed:()=>true,prepare:async()=>{},open:async execution=>({
   next:async style=>{generated++;moves.push(style.mix);return pcm;},
   done:new Promise(resolve=>execution.signal.addEventListener('abort',()=>{released=true;resolve();},{once:true})),
 })};
 const service=await MusicService.open(root,()=>{throw Error('unused');},read,false,music,speech,undefined,testResources(),undefined,{live});
 let http,browser;
 try{
  await service.call('create_project',{projectId:'capture-target',title:'演奏记录'});
  http=await serveHttp(service,{read,has:p=>existsSync(resolve('dist',p)),embedded:false});
  browser=process.env.MUSIC_ROOM_BROWSER==='webkit'?await webkit.launch({headless:true}):await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
  const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:'light'});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(http.runtime.url);
  await page.locator('[data-action=new-sound]').first().click();
  await beforeStart?.(page);
  await page.locator('#sound-form [data-action=live-create]').click();
  if(!beforeStart)await page.waitForFunction(()=>document.querySelector('[data-live-status]')?.textContent.includes('正在演奏'));
  await check({service,page,moves,engine:process.env.MUSIC_ROOM_BROWSER==='webkit'?'webkit':'chrome',generated:()=>generated,released:()=>released});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await http?.close();await service.close();await rm(root,{recursive:true,force:true});}
}

test('improvisation records from the explicit start, previews, discards and saves V1 to its project',()=>withLiveWorkbench(async({service,page,moves,engine,released})=>{
 await page.locator('[data-live-mix]').fill('100');
 await page.waitForFunction(()=>document.querySelector('[data-live-heard-label]')?.textContent.includes('迪斯科 100%'));
 assert.ok(moves.includes(1));
 await page.locator('[data-action=task-list]').click();
 await page.getByRole('heading',{name:'任务与资源',exact:true}).waitFor();
 assert.equal((await service.call('live_play_status',{})).session.phase,'running');
 await page.locator('[data-action=return-live]').click();
 await page.locator('[data-live-save]').waitFor();
 await page.locator('[data-live-save]').click();
 await page.waitForTimeout(1500);
 await page.locator('[data-live-save]').click();
 await page.locator('.live-decision:not([hidden])').waitFor();
 assert.equal(service.soundLibrary.list().length,0,'preview does not publish an abandoned recording');
 await page.waitForFunction(()=>Number.isFinite(document.querySelector('[data-take-preview]')?.duration));
 const length=await page.locator('[data-take-preview]').evaluate(a=>a.duration);
 assert.ok(length>0&&length<5,'preview contains only intentionally recorded audio');
 await page.locator('[data-take-discard]').click();
 await page.locator('[data-live-save]').click();
 await page.waitForTimeout(11000);
 await page.locator('[data-live-save]').click();
 await page.locator('.live-decision:not([hidden])').waitFor();
 await page.locator('[data-take-title]').fill('夜行即兴');
 await mkdir('test-results/magenta-live-ui',{recursive:true});
 await page.evaluate(()=>scrollTo(0,0));
 await page.screenshot({path:`test-results/magenta-live-ui/${engine}-light.png`});
 await page.locator('[data-theme-choice=dark]').click();
 await page.screenshot({path:`test-results/magenta-live-ui/${engine}-dark.png`});
 await page.locator('[data-take-keep]').click();
 await page.locator('#live-panel').waitFor({state:'hidden'});
 const state=await service.call('studio_library',{});
 assert.equal(state.sounds[0].title,'夜行即兴');assert.equal(state.sounds[0].projectId,'capture-target');
 assert.equal(state.versions[0].number,1);assert.ok(state.versions[0].audioPath);
 assert.equal(released(),true);
 await page.locator('[data-action=cover]').click();
 await page.locator('#cover-panel').waitFor();
 assert.ok(Number(await page.locator('#cover-form [name=length]').inputValue())>=10,'the saved improvisation immediately enters style editing');
}));

test('a failed recording save retries the same selected audio',()=>withLiveWorkbench(async({page,service})=>{
 const requests=[];
 await page.route('**/api/live_play_save',async route=>{
  requests.push(route.request().postDataJSON());
  if(requests.length===1)await route.fulfill({status:503,json:{message:'模拟提交前连接中断'}});
  else await route.continue();
 });
 await page.locator('[data-live-save]').click();await page.waitForTimeout(1200);await page.locator('[data-live-save]').click();
 await page.locator('.live-decision:not([hidden])').waitFor();
 await page.locator('[data-take-keep]').click();
 await page.locator('[data-take-status]').filter({hasText:'模拟提交前连接中断'}).waitFor();
 await page.locator('[data-take-keep]').click();
 await page.locator('#live-panel').waitFor({state:'hidden'});
 assert.deepEqual(requests[1],requests[0]);
 assert.equal(service.soundLibrary.list().filter(item=>item.origin==='live-capture').length,1);
}));

test('an unconfirmed stop leaves a retry control until the server releases the worker',()=>withLiveWorkbench(async({page,service,released})=>{
 const button=page.locator('[data-stop-live]'),panel=page.locator('#live-panel'),ids=[];
 await page.route('**/api/live_play_stop',async route=>{
  ids.push(route.request().postDataJSON().sessionId);
  if(ids.length===1)await route.fulfill({status:503,json:{message:'模拟停止请求未到达'}});
  else if(ids.length===2)await route.fulfill({json:{id:ids[0],phase:'failed',message:'模拟未确认释放',released:false}});
  else await route.continue();
 });
 const response=page.waitForResponse(r=>r.url().endsWith('/api/live_play_stop'));
 await button.click();
 await response;
 await page.locator('#toast').filter({hasText:'模拟停止请求未到达'}).waitFor();
 assert.equal(await panel.isVisible(),true);
 assert.equal(service.resources.snapshot().active?.id,ids[0]);
 await button.click();
 await panel.locator('[data-live-status]').filter({hasText:'模拟未确认释放'}).waitFor();
 assert.equal(service.resources.snapshot().active?.id,ids[0]);
 await button.click();
 await panel.waitFor({state:'hidden'});
 assert.deepEqual(ids,[ids[0],ids[0],ids[0]]);
 assert.equal(released(),true);
 assert.equal(service.resources.snapshot().active,undefined);
}));

test('stop releases an acknowledged server session while its start response is still pending',async()=>{
 let acknowledge,allowResponse;
 const started=new Promise(resolve=>{acknowledge=resolve;}),held=new Promise(resolve=>{allowResponse=resolve;});
 await withLiveWorkbench(async({page,service,released})=>{
  try{
   await started;
   for(let i=0;i<100&&(await service.call('live_play_status',{})).session?.phase!=='running';i++)await new Promise(resolve=>setTimeout(resolve,10));
   assert.equal((await service.call('live_play_status',{})).session?.phase,'running');
   await page.locator('[data-stop-live]').click();
   await page.locator('#live-panel').waitFor({state:'hidden',timeout:4000});
   assert.equal(released(),true);
   assert.equal(service.resources.snapshot().active,undefined);
  }finally{allowResponse();}
 },async page=>{
  await page.route('**/api/live_play_start',async route=>{
   const response=await route.fetch();assert.ok(response.ok());acknowledge();
   await held;await route.fulfill({response}).catch(()=>{});
  });
 });
});
