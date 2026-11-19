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
  await page.setViewportSize({width:1440,height:1000});
  await page.locator('.speech-workspace').waitFor();
  await page.fill('#creation-text','保留原稿');
  await page.setInputFiles('#speech-script-file',{name:'旁白.txt',mimeType:'text/plain',buffer:Buffer.from('导入的新段落')});
  await page.waitForFunction(()=>document.querySelector('#creation-text').value==='保留原稿\n\n导入的新段落');
  assert.match(await page.textContent('#speech-character-count'),/12 \/ 8000/);
  assert.match(await page.textContent('#speech-import-status'),/已追加/);
  const editor=await page.locator('.speech-script').boundingBox(),reference=await page.locator('.speech-reference').boundingBox();
  assert.ok(editor.x<reference.x);assert.ok(editor.width>reference.width);
  await page.setInputFiles('#speech-script-file',{name:'too-long.txt',mimeType:'text/plain',buffer:Buffer.from('字'.repeat(8001))});
  await page.waitForFunction(()=>document.querySelector('#speech-import-status').textContent.includes('8000'));
  assert.equal(await page.inputValue('#creation-text'),'保留原稿\n\n导入的新段落');
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   assert.ok(await page.evaluate(()=>document.querySelector('#dialog').scrollWidth<=document.querySelector('#dialog').clientWidth));
   await mkdir('test-results/voicestudio-ux-2026-11-07',{recursive:true});
   await page.screenshot({path:`test-results/voicestudio-ux-2026-11-07/speech-${width}.png`});
  }
  const library=await service.call('studio_library',{});
  assert.equal(library.projects.length,1);assert.equal(library.projects[0].title,'新手项目');
  assert.equal(library.sounds.length,1);assert.equal(library.sounds[0].kind,'speech');assert.equal(library.sounds[0].title,'开场白');
  assert.equal(library.versions.length,0);
  await page.click('[data-action="close"]');await page.reload();
  await page.locator('[data-action="compose"]').first().waitFor();
  await page.locator('[data-action="compose"]').first().click();
  assert.equal(await page.inputValue('#creation-text'),'保留原稿\n\n导入的新段落');
  await page.click('[data-action="close"]');
  assert.equal(await page.locator('[data-action="quick-start"]').count(),0);
  await page.click('[data-action="settings"]');await page.click('[data-settings-section="backup"]');
  await page.locator('#backup-commands').waitFor();
  const guide=await page.locator('#settings-backup').innerText(),commands=await page.inputValue('#backup-commands');
  assert.match(guide,/停止服务/);assert.match(guide,/草稿/);assert.match(commands,/backup/);assert.match(commands,/verify-backup/);
  assert.equal(commands.includes(http.runtime.token),false);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('quick start survives lost creation responses without duplicating the project or sound',async()=>{
 const root=await mkdtemp(join(tmpdir(),'quick-start-lost-')),assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false},service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources()),http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();let lostProject=false,lostSound=false;
 try{await page.route('**/api/create_project',async route=>{if(lostProject)return route.continue();lostProject=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});await page.route('**/api/studio_create_sound',async route=>{if(lostSound)return route.continue();lostSound=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
  await page.goto(http.runtime.url);await page.click('[data-action="quick-start"][data-kind="speech"]');await page.fill('#project-name','首次创作项目');await page.fill('#sound-title','首次创作旁白');
  for(let i=0;i<4&&await page.locator('#quick-start-form').count();i++){await page.locator('#quick-start-form button[type="submit"]').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));}
  await page.locator('#creation-text').waitFor();const snapshot=await service.call('studio_library',{});assert.equal(lostProject,true);assert.equal(lostSound,true);assert.equal(snapshot.projects.filter(p=>p.title==='首次创作项目').length,1);assert.equal(snapshot.sounds.filter(s=>s.title==='首次创作旁白').length,1);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('new project and new sound recover lost responses without duplicating content',async()=>{
 const root=await mkdtemp(join(tmpdir(),'new-project-lost-')),assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false},service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources()),http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();let lostProject=false,lostSound=false;
 try{await service.call('create_project',{projectId:'original',title:'已有项目'});await page.route('**/api/create_project',async route=>{if(lostProject)return route.continue();lostProject=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});await page.route('**/api/studio_create_sound',async route=>{if(lostSound)return route.continue();lostSound=true;const response=await route.fetch();assert.equal(response.status(),200);await route.abort('failed');});
  await page.goto(http.runtime.url);await page.click('[data-action="new-project"]');await page.fill('#project-name','新增项目');for(let i=0;i<3&&await page.locator('#project-form').count();i++){await page.locator('#project-form button[type="submit"]').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));}
  await page.locator('#sound-form').waitFor();await page.fill('#sound-title','新增旋律');for(let i=0;i<3&&await page.locator('#sound-form').count();i++){await page.locator('#sound-form button[type="submit"]').click();await page.waitForFunction(()=>!document.body.classList.contains('busy'));}
  await page.locator('#creation-text').waitFor();const snapshot=await service.call('studio_library',{});assert.equal(lostProject,true);assert.equal(lostSound,true);assert.equal(snapshot.projects.filter(p=>p.title==='新增项目').length,1);assert.equal(snapshot.sounds.filter(s=>s.title==='新增旋律').length,1);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('closing creation forms while a committed response is delayed never reopens the editor',async()=>{
 const root=await mkdtemp(join(tmpdir(),'creation-close-late-')),assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false},service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources()),http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 let releaseSound,enteredSound=false,releaseProject,enteredProject=false;
 const soundGate=new Promise(resolve=>releaseSound=resolve),projectGate=new Promise(resolve=>releaseProject=resolve);
 try{await page.goto(http.runtime.url);await page.route('**/api/studio_create_sound',async route=>{const response=await route.fetch();enteredSound=true;await soundGate;await route.fulfill({response});});
  await page.click('[data-action="quick-start"][data-kind="speech"]');await page.fill('#project-name','关闭时的项目');await page.fill('#sound-title','关闭时的旁白');await page.locator('#quick-start-form button[type="submit"]').click();
  for(let i=0;i<100&&!enteredSound;i++)await new Promise(r=>setTimeout(r,20));assert.equal(enteredSound,true);await page.click('[data-action="close"]');releaseSound();await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert.equal(await page.locator('#dialog').isVisible(),false);assert.equal((await service.call('studio_library',{})).sounds.filter(s=>s.title==='关闭时的旁白').length,1);
  await page.route('**/api/create_project',async route=>{const response=await route.fetch();enteredProject=true;await projectGate;await route.fulfill({response});});await page.click('[data-action="new-project"]');await page.fill('#project-name','关闭时的另一项目');await page.locator('#project-form button[type="submit"]').click();
  for(let i=0;i<100&&!enteredProject;i++)await new Promise(r=>setTimeout(r,20));assert.equal(enteredProject,true);await page.click('[data-action="close"]');releaseProject();await page.waitForFunction(()=>!document.body.classList.contains('busy'));assert.equal(await page.locator('#dialog').isVisible(),false);assert.equal((await service.call('studio_library',{})).projects.filter(p=>p.title==='关闭时的另一项目').length,1);
 }finally{releaseSound?.();releaseProject?.();await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
