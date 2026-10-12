import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {serveHttp} from '../src/server/http.ts';
import {testResources} from '../src/service/resources/testing.ts';
import {encodeWav} from '../src/wav.ts';
const wav=Buffer.from(encodeWav([Float32Array.from({length:22050*5},(_,i)=>Math.sin(i*.1)*.1)],22050));
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
test('sound library collects decisions, imports and downloads audio, preserves playback on refresh and works on mobile',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sound-library-ui-')),assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await service.call('create_project',{projectId:'film',title:'跨项目作品'});const sound=await service.call('studio_create_sound',{projectId:'film',title:'保留的旋律',kind:'music'}),jobs=[];
  service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'就绪',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});service.yue2Client.list=async()=>({jobs});service.yue2Client.audio=async()=>wav;
  service.yue2.inspectInput=async()=>({prefixTokens:100,planningTokens:4098,semanticTokens:9000,contextTokens:24576,requiredTokens:13198,remainingTokens:11378});
  service.yue2Client.generate=async()=>{const job={id:crypto.randomUUID().replaceAll('-',''),status:'done',kind:'create',title:'旋律'};jobs.push(job);return {job};};
  const version=await service.call('studio_generate',{soundId:sound.id,text:'安静钢琴',instrumental:true});await service.call('studio_library',{});await service.call('studio_update_version',{versionId:version.id,kept:true,final:true});
  await page.goto(http.runtime.url);await page.click('[data-action="sound-library"]');await page.locator('.sound-library-card').waitFor();assert.equal(await page.locator('.sound-library-card').count(),1);assert.match(await page.locator('.sound-library-card').innerText(),/成品[\s\S]*灵感/);assert.match(await page.locator('.sound-library-card').innerText(),/跨项目作品/);
  await page.locator('.sound-library-card').click();await page.click('#sound-library-open');await page.locator('#version-audio').waitFor();assert.equal(await page.locator('#version-audio').getAttribute('data-version'),version.id);
  await page.click('[data-action="settings"]');await page.click('[data-action="close"]');await page.click('[data-action="sound-library"]');await page.click('#import-library-sound');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.setInputFiles('#sound-import-file',{name:'损坏.wav',mimeType:'audio/wav',buffer:Buffer.from('broken')});await page.click('#sound-import-submit');await page.locator('#sound-import-status').filter({hasText:'超出处理范围'}).waitFor();assert.ok(await page.locator('#sound-import-submit').isEnabled());
  await page.setInputFiles('#sound-import-file',{name:'测试目录的声音.wav',mimeType:'audio/wav',buffer:wav});assert.equal(await page.inputValue('#sound-import-title'),'测试目录的声音');await page.fill('#sound-import-title','导入的测试声音');await page.click('#sound-import-submit');await page.locator('#dialog').waitFor({state:'hidden'});await page.locator('.sound-library-card').filter({hasText:'导入的测试声音'}).waitFor();assert.equal(await page.locator('.sound-library-card').count(),2);
  await page.selectOption('#sound-library-filter','imported');assert.equal(await page.locator('.sound-library-card').count(),1);assert.equal(await page.locator('#sound-library-open').isVisible(),false);await page.fill('#sound-library-search','不存在');assert.equal(await page.locator('.sound-library-card').count(),0);await page.fill('#sound-library-search','测试');assert.equal(await page.locator('.sound-library-card').count(),1);
  await page.locator('.sound-library-card').click();await page.waitForFunction(()=>{const a=document.querySelector('#sound-library-audio');return a.readyState>=2&&!a.paused;});
  await page.evaluate(()=>window.libraryPlayer=document.querySelector('#sound-library-audio'));await service.call('create_project',{projectId:'other',title:'另一个项目'});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('#projects').textContent.includes('另一个项目'));assert.ok(await page.evaluate(()=>window.libraryPlayer===document.querySelector('#sound-library-audio')));assert.equal(await page.inputValue('#sound-library-search'),'测试');assert.equal(await page.inputValue('#sound-library-filter'),'imported');
  const downloadPromise=page.waitForEvent('download');await page.click('#sound-library-download');const download=await downloadPromise;assert.equal(download.suggestedFilename(),'导入的测试声音.mp3');const mp3=await readFile(await download.path());assert.ok(mp3.length>0&&mp3.length<wav.length);
  const originalPromise=page.waitForEvent('download');await page.click('#sound-library-download-original');const original=await originalPromise;assert.equal(original.suggestedFilename(),'导入的测试声音.wav');assert.deepEqual(await readFile(await original.path()),wav);
  await page.reload();await page.locator('#sound-library').waitFor();assert.equal(await page.locator('[data-action="sound-library"]').getAttribute('aria-current'),'page');assert.equal(await page.locator('.sound-library-card').count(),2);
  await service.call('studio_update_version',{versionId:version.id,kept:false,final:false});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelectorAll('.sound-library-card').length===1);
  await page.setViewportSize({width:390,height:844});const voice=await page.locator('[data-action="voice-library"]').boundingBox(),sounds=await page.locator('[data-action="sound-library"]').boundingBox();assert.ok(sounds.x>=voice.x+voice.width||sounds.y>=voice.y+voice.height);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
