import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {serveHttp} from '../src/server/http.ts';
import {encodeWav} from '../src/wav.ts';

test('native playback menus and playback survive library refreshes; changing versions replaces the player',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-player-menu-'));
 const wav=Buffer.from(encodeWav([Float32Array.from({length:22050*12},(_,i)=>Math.sin(i*.1)*.2)],22050));
 const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
 const driver={installed:()=>true,prepare:async()=>{},generate:async(_,req)=>writeFile(req.outputPath,wav)};
 const read=p=>readFile(resolve('dist',p));
 const service=await MusicService.open(root,()=>{throw Error('unused');},read,false,unused,driver);
 const http=await serveHttp(service,{read,has:p=>existsSync(resolve('dist',p)),embedded:false});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required','--lang=en-US']});
 const page=await browser.newPage({viewport:{width:1440,height:1000},locale:'en-US'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await service.call('create_project',{projectId:'menus',title:'播放菜单回归'});
  const sound=await service.call('studio_create_sound',{projectId:'menus',title:'菜单试听',kind:'speech'});
  const voice=await service.call('tts_add_voice',{cleanup:false,name:'参考声音',audioBase64:wav.toString('base64')});
  const versions=[];
  for(const text of ['第一版','第二版']){
   const v=await service.call('studio_generate',{soundId:sound.id,text,voiceId:voice.id});versions.push(v);
   for(let i=0;i<100&&service.speech.job(v.id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,20));
   assert.equal(service.speech.job(v.id).state,'succeeded');
  }
  let polls=0;
  await page.route('**/api/studio_library',async route=>{
   const response=await route.fetch(),body=await response.json();
   body.engines.music.message=`后台状态更新 ${++polls}`;
   await route.fulfill({response,json:body});
  });
  await page.goto(http.runtime.url);
  await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=1);
  await page.evaluate(()=>{
   window.player=document.querySelector('#version-audio');window.playerRemovals=0;
   new MutationObserver(records=>{for(const r of records)for(const n of r.removedNodes)if(n===player||n.contains(player))playerRemovals++;}).observe(document.querySelector('#workspace'),{childList:true,subtree:true});
  });
  const box=await page.locator('#version-audio').boundingBox();
  await page.mouse.click(box.x+box.width-20,box.y+box.height/2);
  const cdp=await page.context().newCDPSession(page);
  const names=async()=>(await cdp.send('Accessibility.getFullAXTree')).nodes.filter(n=>!n.ignored).map(n=>n.name?.value);
  const speedMenuNames=['显示播放速度菜单','Show playback speed menu','Playback speed'];
  const speedMenuOpen=async()=>(await names()).some(n=>speedMenuNames.includes(n));
  const clickNative=async labels=>{
   const node=(await cdp.send('Accessibility.getFullAXTree')).nodes.find(n=>!n.ignored&&n.role?.value!=='StaticText'&&labels.includes(n.name?.value));
   assert.ok(node,`native control exists: ${labels.join(' / ')}`);
   const {model}=await cdp.send('DOM.getBoxModel',{backendNodeId:node.backendDOMNodeId});
   const q=model.content;await page.mouse.click((q[0]+q[4])/2,(q[1]+q[5])/2);
  };
  assert.ok(await speedMenuOpen(),'native overflow menu opens');
  const before=polls;
  await page.waitForTimeout(4100);
  assert.ok(polls>=before+2,'at least two real polling responses');
  assert.equal(await page.evaluate(()=>playerRemovals),0,'refresh must never detach the active audio or its ancestors');
  assert.ok(await speedMenuOpen(),'native menu remains open after polling');
  await clickNative(speedMenuNames);
  await page.waitForTimeout(4100);
  await clickNative(['1.5']);
  assert.equal(await page.locator('#version-audio').evaluate(a=>a.playbackRate),1.5,'native speed selection takes effect');
  await page.locator('#version-audio').evaluate(a=>{a.currentTime=1;a.volume=.4;a.loop=true;return a.play();});
  await page.waitForTimeout(4100);
  assert.equal(await page.evaluate(()=>player===document.querySelector('#version-audio')&&!player.paused&&player.playbackRate===1.5&&player.volume===.4&&player.currentTime>3&&playerRemovals===0),true,'playback advances without resets');
  await page.locator('[data-select-version]').first().check();
  assert.equal(await page.evaluate(()=>playerRemovals),0,'selection refresh also retains the player');
  await service.call('studio_update_version',{versionId:versions[1].id,kept:true});
  await page.waitForFunction(()=>document.querySelector('[data-action="keep"]')?.textContent.includes('已保留'));
  assert.equal(await page.evaluate(()=>playerRemovals),0,'version metadata updates around the connected player');
  await page.locator(`[data-action="version"][data-id="${versions[0].id}"]`).click();
  await page.waitForFunction(id=>document.querySelector('#version-audio')?.dataset.version===id&&document.querySelector('#version-audio')?.readyState>=1,versions[0].id);
  assert.equal(await page.evaluate(()=>player!==document.querySelector('#version-audio')&&player.paused&&!player.isConnected),true,'switching versions replaces and pauses the old player');
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
