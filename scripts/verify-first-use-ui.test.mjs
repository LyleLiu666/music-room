import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {testResources} from '../src/service/resources/testing.ts';
import {serveHttp} from '../src/server/http.ts';
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};

test('empty workspace chooses a sound first, names once and never generates without confirmation',async()=>{
 const root=await mkdtemp(join(tmpdir(),'first-use-ui-'));
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(http.runtime.url);
  await page.locator('[data-action="quick-start"][data-kind="speech"]').waitFor();
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await mkdir('test-results/ux-perf-2026-10-29',{recursive:true});
   await page.screenshot({path:`test-results/ux-perf-2026-10-29/welcome-${width}.png`,fullPage:true});
  }
  await page.click('[data-action="quick-start"][data-kind="speech"]');
  assert.equal(await page.inputValue('#project-name'),'我的声音创作');
  assert.equal(await page.inputValue('#sound-title'),'第一段旁白');
  await page.fill('#project-name','新手项目');await page.fill('#sound-title','开场白');
  await page.click('#quick-start-form button[type="submit"]');
  await page.locator('#creation-text').waitFor();
  const library=await service.call('studio_library',{});
  assert.equal(library.projects.length,1);assert.equal(library.projects[0].title,'新手项目');
  assert.equal(library.sounds.length,1);assert.equal(library.sounds[0].kind,'speech');assert.equal(library.sounds[0].title,'开场白');
  assert.equal(library.versions.length,0);
  await page.click('[data-action="close"]');await page.reload();
  await page.locator('[data-action="compose"]').first().waitFor();
  assert.equal(await page.locator('[data-action="quick-start"]').count(),0);
  await page.click('[data-action="settings"]');await page.click('[data-action="backup-guide"]');
  await page.locator('#backup-commands').waitFor();
  const guide=await page.locator('#dialog').innerText(),commands=await page.inputValue('#backup-commands');
  assert.match(guide,/停止服务/);assert.match(guide,/草稿/);assert.match(commands,/backup/);assert.match(commands,/verify-backup/);
  assert.equal(commands.includes(http.runtime.token),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
