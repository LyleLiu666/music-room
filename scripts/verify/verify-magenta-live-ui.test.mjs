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

async function withLiveWorkbench(check){
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
  await page.locator('[data-action=sound-library]').click();
  await page.locator('#play-live').click();
  await page.waitForFunction(()=>document.querySelector('[data-live-status]')?.textContent.includes('正在演奏'));
  await check({service,page,moves,engine:process.env.MUSIC_ROOM_BROWSER==='webkit'?'webkit':'chrome',generated:()=>generated,released:()=>released});
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await http?.close();await service.close();await rm(root,{recursive:true,force:true});}
}

test('play live changes style while streaming, captures the heard window and joins an explicit project',()=>withLiveWorkbench(async({service,page,moves,engine,generated,released})=>{
  assert.equal(await page.locator('#play-live').getAttribute('aria-pressed'),'true');
  const titleBox=await page.locator('.sound-library-title').boundingBox(),entryBox=await page.locator('#play-live').boundingBox(),tabsBox=await page.locator('.library-tabs').boundingBox();
  assert.ok(Math.abs(titleBox.y-entryBox.y)<5&&tabsBox.y>entryBox.y+entryBox.height,'desktop live entry shares the heading row above the tabs');
  assert.match(await page.locator('[data-task-live]').innerText(),/正在演奏/);
  assert.equal(await page.locator('[data-live-save]').isDisabled(),true);
  const slider=page.locator('[data-live-mix]');await slider.focus();await page.keyboard.press('End');
  await page.waitForFunction(()=>document.querySelector('[data-live-heard-label]')?.textContent.includes('迪斯科 100%'));
  assert.ok(moves.includes(0)&&moves.includes(1));
  await page.locator('[data-live-save]').waitFor();
  await page.waitForFunction(()=>!document.querySelector('[data-live-save]').disabled,{},{timeout:25000});
  const submissions=[];
  await page.route('**/api/live_play_save',async route=>{
   submissions.push(route.request().postDataJSON());
   if(submissions.length!==1)return route.continue();
   const response=await route.fetch();assert.ok(response.ok());
   await route.fulfill({status:503,json:{message:'模拟保存成功但响应丢失'}});
  });
  await page.locator('[data-live-save]').click();
  await page.locator('[data-live-save-message]').filter({hasText:'模拟保存成功但响应丢失'}).waitFor();
  await page.locator('[data-live-save]').click();
  const row=page.locator('.sound-library-row').filter({hasText:'片段 1'});
  await row.waitFor();
  assert.deepEqual(submissions[1],submissions[0]);
  assert.equal(service.soundLibrary.list().filter(item=>item.origin==='live-capture').length,1);
  assert.match(await row.innerText(),/玩一段/);assert.match(await row.innerText(),/灵感/);
  const nameBox=await row.locator('.sound-library-copy strong').boundingBox(),sourceBox=await row.locator('.sound-library-copy > span').boundingBox();
  assert.ok(sourceBox.x>nameBox.x&&Math.abs(sourceBox.y-nameBox.y)<5,'source appears in its own desktop column');
  assert.match(await page.locator('[data-live-saved]').innerText(),/0:15/);
  const count=generated();await page.waitForTimeout(1200);assert.ok(generated()>count,'capture does not interrupt stream');
  await mkdir('test-results/magenta-live-ui',{recursive:true});
  await page.screenshot({path:`test-results/magenta-live-ui/${engine}-light.png`});
  await page.locator('[data-theme-choice=dark]').click();
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.screenshot({path:`test-results/magenta-live-ui/${engine}-dark.png`});
  const preview=page.getByRole('button',{name:'试听 爵士转迪斯科 · 片段 1'});
  await preview.click();
  await page.waitForFunction(()=>document.querySelector('[data-live-status]')?.textContent.includes('试听其他音频'));
  await preview.click();
  await page.waitForFunction(()=>document.querySelector('[data-live-status]')?.textContent.includes('正在演奏'));
  await page.locator('[data-live-saved]').getByRole('button',{name:'加入项目'}).click();
  await page.locator('#attach-project').selectOption('capture-target');
  await page.locator('#attach-submit').click();
  await page.waitForFunction(()=>document.querySelector('.sound-library-row .sound-library-copy')?.textContent.includes('演奏记录'));
  const state=await service.call('studio_library',{});
  assert.equal(state.sounds[0].projectId,'capture-target');assert.equal(state.sounds[0].kind,'clip');
  assert.equal((await service.call('live_play_status',{})).session.phase,'running');
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.locator('[data-stop-live]').click();
  await page.locator('#live-panel').waitFor({state:'hidden'});
  assert.equal(released(),true);
  assert.equal(service.resources.snapshot().active,undefined);
  assert.equal(await page.locator('#play-live').getAttribute('aria-pressed'),'false');
}));

test('a pending save whose audio expires can be replaced by a fresh capture',()=>withLiveWorkbench(async({page,service})=>{
 const button=page.locator('[data-live-save]'),message=page.locator('[data-live-save-message]'),requests=[];
 await page.route('**/api/live_play_save',async route=>{
  requests.push(route.request().postDataJSON());
  if(requests.length===1)await route.fulfill({status:503,json:{message:'模拟提交前连接中断'}});
  else await route.continue();
 });
 await button.click({timeout:25_000});
 await message.filter({hasText:'模拟提交前连接中断'}).waitFor();
 await page.waitForRequest(request=>request.url().endsWith('/api/live_play_next')&&request.postDataJSON().offset>=requests[0].heardFrame+10*48000,{timeout:18_000});
 await button.click();
 await message.filter({hasText:'超出回留范围'}).waitFor();
 assert.deepEqual(requests[1],requests[0]);
 const response=page.waitForResponse(r=>r.url().endsWith('/api/live_play_save'));
 await button.click();
 assert.ok((await response).ok(),'the next click saves newly heard audio');
 assert.notEqual(requests[2].requestId,requests[0].requestId);
 assert.ok(requests[2].heardFrame>requests[0].heardFrame);
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
 await panel.locator('[data-live-status]').filter({hasText:'后台尚未确认模型释放'}).waitFor();
 assert.equal(service.resources.snapshot().active?.id,ids[0]);
 await button.click();
 await panel.waitFor({state:'hidden'});
 assert.deepEqual(ids,[ids[0],ids[0],ids[0]]);
 assert.equal(released(),true);
 assert.equal(service.resources.snapshot().active,undefined);
}));
