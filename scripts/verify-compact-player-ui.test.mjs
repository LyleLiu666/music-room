import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {serveHttp} from '../src/server/http.ts';
import {testResources} from '../src/service/resources/testing.ts';
import {encodeWav} from '../src/wav.ts';

test('music player keeps desktop controls in one row and mobile controls reachable',async()=>{
 const root=await mkdtemp(join(tmpdir(),'compact-player-ui-'));
 const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());
 const jobs=[];
 service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'就绪',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});
 service.yue2Client.list=async()=>({jobs});
 service.yue2Client.generate=async args=>{const job={id:crypto.randomUUID().replaceAll('-',''),status:'done',kind:'create',title:args.title,truncated:{abc:false,semantic:false}};jobs.push(job);return {job};};
 service.yue2Client.audio=async()=>Buffer.from(encodeWav([Float32Array.from({length:22050*20},(_,i)=>Math.sin(i*.1)*.05)],22050));
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await service.call('create_project',{projectId:'compact',title:'语音创作'});
  const sound=await service.call('studio_create_sound',{projectId:'compact',title:'片段测试',kind:'music'});
  await service.call('studio_generate',{soundId:sound.id,text:'快乐、灵动，以小提琴为主，带大草原辽阔感。',instrumental:true});
  await service.call('studio_library',{});
  await page.goto(http.runtime.url);await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=1);await page.getByRole('button',{name:'夜间',exact:true}).click();
  await mkdir('test-results/compact-player',{recursive:true});
  for(const width of [1440,1280]){
   await page.setViewportSize({width,height:1000});
   const boxes=await Promise.all(['#playback-speed','#speed-note','#save-speed'].map(s=>page.locator(s).boundingBox()));
   assert.ok(boxes.every(b=>Math.abs(b.y+b.height/2-boxes[0].y-boxes[0].height/2)<=2),'slider, explanation and save belong on the same desktop row');
   const card=await page.locator('.listening').boundingBox();assert.ok(card.height<=225,`music card should stay compact, got ${card.height}px`);
   assert.ok((await page.locator('.ending-preview').boundingBox()).height<=36,'ending audition stays a compact utility row');
   await page.getByRole('button',{name:'0.8 倍',exact:true}).click();assert.equal(await page.locator('#version-audio').evaluate(a=>a.playbackRate),.8);
   assert.match(await page.locator('#speed-note').innerText(),/25.0 秒/);
   const note=await page.locator('#speed-note').boundingBox(),save=await page.locator('#save-speed').boundingBox();assert.ok(note.x+note.width<=save.x,'estimated duration must not overlap save');
   await page.screenshot({path:`test-results/compact-player/${width}.png`,fullPage:true});
   await page.getByRole('button',{name:'原速',exact:true}).click();
  }
  for(const width of [768,1024]){
   await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`no overflow at ${width}px`);
  }
  await page.setViewportSize({width:390,height:844});
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no mobile horizontal scroll');
  for(const selector of ['#playback-speed','#save-speed','[data-speed-preset="0.8"]','#preview-ending','[data-action="download"]','.listening .more-menu summary']){
   const box=await page.locator(selector).boundingBox();assert.ok(box.height>=44&&box.x>=0&&box.x+box.width<=390,`${selector} has a reachable mobile touch target`);
  }
  await page.getByRole('button',{name:'0.8 倍',exact:true}).click();assert.equal(await page.locator('#save-speed').isEnabled(),true);
  await page.locator('#preview-ending').click();await page.waitForFunction(()=>{const a=document.querySelector('#version-audio');return !a.paused&&a.currentTime>5.1;});
  await page.locator('#version-audio').evaluate(a=>a.pause());
  assert.equal(await page.locator('#ending-preview-error').isVisible(),false);
  await page.screenshot({path:'test-results/compact-player/390.png',fullPage:true});assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
