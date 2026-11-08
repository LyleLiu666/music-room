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
  await page.locator('.sound-library-card').click();await page.waitForFunction(()=>!document.querySelector('#sound-library-audio').paused);await service.call('studio_update_version',{versionId:version.id,deleted:true});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('#sound-library-audio').paused&&!document.querySelector('#sound-library-audio').getAttribute('src'));await service.call('studio_update_version',{versionId:version.id,deleted:false});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.locator('.sound-library-card').waitFor();await page.locator('.sound-library-card').click();await page.click('#sound-library-open');await page.locator('#version-audio').waitFor();assert.equal(await page.locator('#version-audio').getAttribute('data-version'),version.id);
  await page.click('[data-action="settings"]');await page.click('[data-action="close"]');await page.click('[data-action="sound-library"]');await page.click('#import-library-sound');await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.setInputFiles('#sound-import-file',{name:'损坏.wav',mimeType:'audio/wav',buffer:Buffer.from('broken')});await page.click('#sound-import-submit');await page.locator('#sound-import-status').filter({hasText:'超出处理范围'}).waitFor();assert.ok(await page.locator('#sound-import-submit').isEnabled());
  await page.setInputFiles('#sound-import-file',{name:'测试目录的声音.wav',mimeType:'audio/wav',buffer:wav});assert.equal(await page.inputValue('#sound-import-title'),'测试目录的声音');await page.fill('#sound-import-title','导入的测试声音');await page.click('#sound-import-submit');await page.locator('#dialog').waitFor({state:'hidden'});await page.locator('.sound-library-card').filter({hasText:'导入的测试声音'}).waitFor();assert.equal(await page.locator('.sound-library-card').count(),2);
  await page.selectOption('#sound-library-filter','imported');assert.equal(await page.locator('.sound-library-card').count(),1);assert.equal(await page.locator('#sound-library-open').isVisible(),false);await page.fill('#sound-library-search','不存在');await page.waitForFunction(()=>document.querySelectorAll('.sound-library-card').length===0);assert.equal(await page.locator('.sound-library-card').count(),0);await page.fill('#sound-library-search','测试');await page.waitForFunction(()=>document.querySelectorAll('.sound-library-card').length===1);assert.equal(await page.locator('.sound-library-card').count(),1);
  await page.locator('.sound-library-card').click();await page.waitForFunction(()=>{const a=document.querySelector('#sound-library-audio');return a.readyState>=2&&!a.paused;});
  await page.evaluate(()=>window.libraryPlayer=document.querySelector('#sound-library-audio'));await service.call('create_project',{projectId:'other',title:'另一个项目'});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelector('#projects').textContent.includes('另一个项目'));assert.ok(await page.evaluate(()=>window.libraryPlayer===document.querySelector('#sound-library-audio')));assert.equal(await page.inputValue('#sound-library-search'),'测试');assert.equal(await page.inputValue('#sound-library-filter'),'imported');
  const downloadPromise=page.waitForEvent('download');await page.click('#sound-library-download');const download=await downloadPromise;assert.equal(download.suggestedFilename(),'导入的测试声音.mp3');const mp3=await readFile(await download.path());assert.ok(mp3.length>0&&mp3.length<wav.length);
  const originalPromise=page.waitForEvent('download');await page.click('#sound-library-download-original');const original=await originalPromise;assert.equal(original.suggestedFilename(),'导入的测试声音.wav');assert.deepEqual(await readFile(await original.path()),wav);
  await page.reload();await page.locator('#sound-library').waitFor();assert.equal(await page.locator('[data-action="sound-library"]').getAttribute('aria-current'),'page');assert.equal(await page.locator('.sound-library-card').count(),2);
  await service.call('studio_update_version',{versionId:version.id,kept:false,final:false});await page.evaluate(()=>window.dispatchEvent(new Event('focus')));await page.waitForFunction(()=>document.querySelectorAll('.sound-library-card').length===1);
  await page.setViewportSize({width:390,height:844});const voice=await page.locator('[data-action="voice-library"]').boundingBox(),sounds=await page.locator('[data-action="sound-library"]').boundingBox();assert.ok(sounds.x>=voice.x+voice.width||sounds.y>=voice.y+voice.height);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('sound effects can be created as separate recordings from the library and keep their source',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sound-effects-ui-')),assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const effectDriver={profile:{id:'fixture'},installed:()=>true,prepare:async()=>{},generate:async req=>Buffer.from(encodeWav([Float32Array.from({length:req.seconds*24000},(_,i)=>Math.sin(i*.1)*.1)],24000))};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources(),undefined,effectDriver);
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(http.runtime.url);await page.click('[data-action="sound-library"]');await page.click('#generate-library-effect');
  await page.fill('#effect-title','我的碎纸机');await page.fill('#effect-prompt','   ');await page.locator('#effect-submit:enabled').waitFor();await page.click('#effect-submit');assert.equal(await page.locator('#effect-prompt').evaluate(e=>e.validity.customError),true);await page.fill('#effect-prompt','A paper shredder shredding paper');await page.selectOption('#effect-seconds','3');await page.click('#effect-submit');
  await page.locator('#effect-status').filter({hasText:'音效已保存到声音库'}).waitFor();await page.click('[data-action="close"]');
  await page.locator('.sound-library-card').filter({hasText:'我的碎纸机'}).waitFor();assert.match(await page.locator('.sound-library-card').filter({hasText:'我的碎纸机'}).innerText(),/音效生成/);
  await page.selectOption('#sound-library-filter','effects');assert.equal(await page.locator('.sound-library-card').count(),1);
  await page.locator('.sound-library-card').click();await page.waitForFunction(()=>{const a=document.querySelector('#sound-library-audio');return a?.readyState>=2&&!a.paused;});
  const item=service.soundLibrary.list()[0];assert.equal(item.source.kind,'sound-effect');assert.equal(item.source.seconds,3);assert.equal(item.source.prompt,'A paper shredder shredding paper');assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('sound effect model preparation is explicit, cancellable and does not generate audio',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sound-effects-setup-ui-')),assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};let installs=0,stopped=0;
 const driver={profile:{id:'fixture'},installed:()=>false,prepare:async(execution)=>{installs++;await new Promise((_,reject)=>execution.signal.addEventListener('abort',()=>{stopped++;reject(execution.signal.reason);},{once:true}));},generate:async()=>{throw Error('must not generate');}};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources(),undefined,driver),http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 try{await page.goto(http.runtime.url);await page.click('[data-action="sound-library"]');await page.click('#generate-library-effect');await page.locator('#effect-prepare').waitFor({state:'visible'});assert.equal(installs,0);assert.equal(await page.locator('#effect-submit').isDisabled(),true);
  await page.click('#effect-prepare');await page.locator('#effect-cancel-prepare').waitFor({state:'visible'});await page.click('#effect-cancel-prepare');await page.waitForFunction(()=>document.querySelector('#effect-status')?.textContent.includes('已取消'));assert.equal(installs,1);assert.equal(stopped,1);assert.equal(service.soundLibrary.list().length,0);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('reopening sound effect creation shows a background failure rather than hiding it',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sound-effects-failure-ui-')),assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};let rejectRun,started=false;
 const driver={profile:{id:'fixture'},installed:()=>true,prepare:async()=>{},generate:async()=>{started=true;return new Promise((_,reject)=>{rejectRun=reject;});}};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources(),undefined,driver),http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 try{await page.goto(http.runtime.url);await page.click('[data-action="sound-library"]');await page.click('#generate-library-effect');await page.fill('#effect-title','雨声');await page.fill('#effect-prompt','rain falling');await page.locator('#effect-submit:enabled').waitFor();await page.click('#effect-submit');
  for(let i=0;i<100&&!started;i++)await new Promise(r=>setTimeout(r,20));assert.equal(started,true);await page.click('[data-action="close"]');rejectRun(Error('模型发生故障'));
  for(let i=0;i<100&&service.effects.status().jobs[0].state!=='failed';i++)await new Promise(r=>setTimeout(r,20));assert.equal(service.effects.status().jobs[0].state,'failed');await page.click('#generate-library-effect');await page.locator('#effect-status').filter({hasText:'模型发生故障'}).waitFor({timeout:3000});
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
