import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';import {existsSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {chromium} from 'playwright';import {MusicService} from '../../src/service/service.ts';import {testResources} from '../../src/service/resources/testing.ts';import {serveHttp} from '../../src/server/http.ts';
import {ResourceError} from '../../src/service/resources/contracts.ts';
test('task page shows measured hardware and shared queue controls; settings owns the memory limit; mobile remains usable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resources-ui-')),read=p=>readFile(resolve('dist',p)),service=await MusicService.open(root,()=>{throw Error('unused');},read,false,undefined,{installed:()=>true,prepare:async()=>{},cleanReference:async()=>{throw Error('must remain paused');},generate:async()=>{throw Error('unused');}},undefined,testResources()),http=await serveHttp(service,{read,has:p=>existsSync(resolve('dist',p)),embedded:false}),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(http.runtime.url);await page.click('[data-action="task-list"]');const overview=page.locator('#resource-status'),live=page.locator('.sidebar [data-task-live]');await overview.filter({hasText:'16.0 GiB'}).waitFor();await overview.filter({hasText:'应用上限 12.0 GiB'}).waitFor();
  assert.equal(await overview.locator('.memory-legend').isVisible(),true);assert.equal(await overview.locator('.memory-capability-list').isVisible(),true);
  const music=overview.locator('.memory-capability-item').filter({hasText:'音乐 · YuE2'});
  await music.filter({hasText:'8.0 GiB 起'}).filter({hasText:'达到起步要求'}).waitFor();
  let pressure='warning',available=12*2**30;
  const pressuredStatus=async route=>{
   const status=await service.resources.status();
   status.hardware.pressure=pressure;status.hardware.pools[0].available=available;
   await route.fulfill({json:status});
  };
  await page.route('**/api/resource_status',pressuredStatus);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await overview.filter({hasText:'偏高，预算充足可启动'}).waitFor();
  await music.filter({hasText:'达到起步要求'}).waitFor();
  assert.match(await overview.locator('.memory-summary').innerText(),/新任务可用 11\.0 GiB/);
  assert.doesNotMatch(await overview.innerText(),/等待压力恢复|后续任务等待/);
  await mkdir('test-results/resources-ui',{recursive:true});
  await page.screenshot({path:'test-results/resources-ui/warning-budget-ready.png',fullPage:true});
  available=7*2**30;await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await music.filter({hasText:'还差 2.0 GiB'}).waitFor();
  available=12*2**30;pressure='critical';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await music.filter({hasText:'等待压力恢复'}).waitFor();
  assert.doesNotMatch(await overview.locator('.memory-summary').innerText(),/新任务可用/);
  await page.unroute('**/api/resource_status',pressuredStatus);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await music.filter({hasText:'达到起步要求'}).waitFor();
  const dropResourceStatus=route=>route.fulfill({status:503,json:{message:'暂时无法读取电脑资源'}});
  await page.route('**/api/resource_status',dropResourceStatus);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await music.filter({hasText:'状态未知'}).waitFor();
  assert.equal(await overview.locator('.memory-summary').count(),0);
  await page.unroute('**/api/resource_status',dropResourceStatus);
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await music.filter({hasText:'达到起步要求'}).waitFor();
  await page.click('#resource-pause-button');await live.getByText('已暂停',{exact:true}).waitFor();assert.equal(await page.locator('#resource-pause-button').textContent(),'恢复后续任务');
  const voice=service.speech.addVoice('等待清理',await readFile('public/tts-presets/official.wav'),true);await live.getByText('已暂停 · 1 排队',{exact:true}).waitFor();await service.call('resource_cancel',{taskId:voice.id});await live.getByText('已暂停',{exact:true}).waitFor();assert.equal(service.speech.snapshot().voices[0].processing.state,'interrupted');
  await overview.locator('[data-action="settings"][data-section="memory"]').click();await page.locator('#settings-memory').waitFor();await page.fill('#resource-memory-limit','3');await page.click('[data-action="resource-limit-save"]');await page.locator('#memory-limit-status').filter({hasText:'当前应用上限 3.0 GiB（手动设置）'}).waitFor();assert.equal(service.resources.snapshot().policy.limits.memory,3*2**30);
  await page.click('[data-action="task-list"]');await music.filter({hasText:'超出上限'}).waitFor();
  await overview.locator('[data-action="settings"][data-section="memory"]').click();await page.locator('#settings-memory').waitFor();await page.click('[data-action="resource-limit-auto"]');await page.locator('#memory-limit-status').filter({hasText:'当前应用上限 12.0 GiB（自动管理）'}).waitFor();
  await page.click('[data-action="task-list"]');await overview.filter({hasText:'应用上限 12.0 GiB'}).waitFor();await music.filter({hasText:'达到起步要求'}).waitFor();await page.click('#resource-pause-button');await page.waitForFunction(()=>document.querySelector('[data-task-live]')?.textContent==='');assert.equal(await page.locator('#resource-pause-button').textContent(),'暂停后续任务');await overview.locator('[data-action="resource-release"]').click();
  await mkdir('test-results/resources-ui',{recursive:true});await page.screenshot({path:'test-results/resources-ui/desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.ok(await overview.evaluate(el=>el.getBoundingClientRect().right<=innerWidth));await page.screenshot({path:'test-results/resources-ui/mobile.png',fullPage:true});assert.deepEqual(errors,[]);}
 finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('saved warning-only wait failure keeps its cause after restart and separates current retry advice',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resource-history-ui-'));
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const message='任务启动预约 8.0 GiB；虽然含系统缓存的启动预算约 15.0 GiB，但当前系统内存压力偏高';
 const open=()=>MusicService.open(root,()=>{throw Error('unused');},assets.read,false,undefined,
  {installed:()=>true,prepare:async()=>{},generate:async()=>{throw new ResourceError('WAITING_FOR_MEMORY',message);}},undefined,testResources());
 let service,browser,http;
 try{
  service=await open();
  await service.call('create_project',{projectId:'history',title:'历史内存记录'});
  const sound=await service.call('studio_create_sound',{projectId:'history',title:'等待超时的旁白',kind:'speech'});
  const voice=service.speech.addVoice('参考声音',await readFile('public/tts-presets/official.wav'),false);
  const version=await service.call('studio_generate',{soundId:sound.id,voiceId:voice.id,text:'保留这段创作要求。'});
  let failed;
  for(let n=0;n<200;n++){
   failed=(await service.call('studio_library',{})).versions.find(v=>v.id===version.id);
   if(failed?.state==='failed')break;
   await new Promise(r=>setTimeout(r,5));
  }
  assert.equal(failed?.state,'failed');assert.equal(failed.resource.reason,'WAITING_FOR_MEMORY');
  await service.close();service=await open();
  http=await serveHttp(service,assets);browser=await chromium.launch({channel:'chrome',headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:900}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(http.runtime.url);
  const reason=page.locator('.resource-failure-reason');await reason.waitFor();
  assert.equal(await reason.innerText(),'当时记录的原因：'+message);
  const player=page.locator('.empty-player');
  assert.match(await player.innerText(),/重试时会重新检查启动预算和压力/);
  assert.doesNotMatch(await player.innerText(),/启动预算不足或系统内存压力达到危险级别/);
  assert.equal((await player.innerText()).split(message).length-1,1);
  assert.equal(await page.getByRole('button',{name:'重试生成',exact:true}).isVisible(),true);
  await page.getByRole('button',{name:'查看内存状态',exact:true}).click();
  await page.locator('#resource-status .memory-summary').filter({hasText:'新任务可用 11.0 GiB'}).waitFor();
  await page.click('[data-action="project"][data-id="history"]');await reason.waitFor();
  await page.reload();await reason.waitFor();assert.equal(await reason.innerText(),'当时记录的原因：'+message);
  await mkdir('test-results/memory-history-2026-11-26',{recursive:true});
  for(const width of [1280,390]){
   await page.setViewportSize({width,height:900});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await reason.evaluate(el=>el.scrollIntoView({block:'center'}));
   await page.screenshot({path:`test-results/memory-history-2026-11-26/history-${width}.png`});
  }
  const restored=(await service.call('studio_library',{})).versions.find(v=>v.id===version.id);
  assert.equal(restored.resource.message,message);assert.equal(restored.input.text,'保留这段创作要求。');
  assert.deepEqual(errors,[]);
 }finally{await browser?.close();await http?.close();await service?.close();await rm(root,{recursive:true,force:true});}
});
