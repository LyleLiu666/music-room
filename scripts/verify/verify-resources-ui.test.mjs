import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';import {existsSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {chromium} from 'playwright';import {MusicService} from '../../src/service/service.ts';import {testResources} from '../../src/service/resources/testing.ts';import {serveHttp} from '../../src/server/http.ts';
test('task page shows measured hardware and shared queue controls; settings owns the memory limit; mobile remains usable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'resources-ui-')),read=p=>readFile(resolve('dist',p)),service=await MusicService.open(root,()=>{throw Error('unused');},read,false,undefined,{installed:()=>true,prepare:async()=>{},cleanReference:async()=>{throw Error('must remain paused');},generate:async()=>{throw Error('unused');}},undefined,testResources()),http=await serveHttp(service,{read,has:p=>existsSync(resolve('dist',p)),embedded:false}),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(http.runtime.url);await page.click('[data-action="task-list"]');const overview=page.locator('#resource-status'),live=page.locator('.sidebar [data-task-live]');await overview.filter({hasText:'16.0 GiB'}).waitFor();await overview.filter({hasText:'应用上限 12.0 GiB'}).waitFor();
  assert.equal(await overview.locator('.memory-legend').isVisible(),true);assert.equal(await overview.locator('.memory-capability-list').isVisible(),true);
  const music=overview.locator('.memory-capability-item').filter({hasText:'音乐 · YuE2'});
  await music.filter({hasText:'8.0 GiB 起'}).filter({hasText:'达到起步要求'}).waitFor();
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
