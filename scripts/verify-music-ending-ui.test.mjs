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

test('ending preference survives drafts and iteration; tail audition and honest truncation notices work',async()=>{
 const root=await mkdtemp(join(tmpdir(),'music-ending-ui-'));
 const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());
 const jobs=[],requests=[];let truncated={abc:false,semantic:false},seconds=20;
 service.yue2.inspectInput=async()=>({prefixTokens:200,planningTokens:4098,semanticTokens:9000,contextTokens:24576,requiredTokens:13298,remainingTokens:11278});service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'就绪',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});
 service.yue2Client.list=async()=>({jobs});
 service.yue2Client.generate=async args=>{requests.push(structuredClone(args));const job={id:crypto.randomUUID().replaceAll('-',''),status:'done',kind:'create',title:args.title,truncated};jobs.push(job);return {job};};
 service.yue2Client.audio=async()=>Buffer.from(encodeWav([Float32Array.from({length:22050*seconds},(_,i)=>Math.sin(i*.1)*.05)],22050));
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1100}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 const compose=async()=>{await page.click('[data-action="compose"]');await page.getByText('生成偏好',{exact:true}).click();};
 const generate=async()=>{await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.waitForFunction(()=>document.querySelector('#preview-ending')?.disabled===false);};
 const requirements=async()=>{await page.click('.listening .more-menu summary');await page.click('[data-action="requirements"]');};
 try{
  await service.call('create_project',{projectId:'ending',title:'收尾验收'});const sound=await service.call('studio_create_sound',{projectId:'ending',title:'钢琴配乐',kind:'music'});
  await page.goto(http.runtime.url);await compose();assert.equal(await page.inputValue('#music-ending'),'natural');
  await page.fill('#creation-text','温暖钢琴');await page.selectOption('#music-ending','as-described');await page.click('[data-action="close"]');await page.reload();await compose();assert.equal(await page.inputValue('#music-ending'),'as-described');
  await page.selectOption('#music-ending','natural');await generate();assert.equal(requests.at(-1).ending,'natural');assert.equal(await page.locator('#music-ending-warning').count(),0);
  const first=(await service.call('studio_library',{})).versions.find(v=>v.soundId===sound.id);assert.equal(first.input.ending,'natural');
  await page.click('#preview-ending');await page.waitForFunction(()=>{const a=document.querySelector('#version-audio');return a&&!a.paused&&a.currentTime>=5&&a.currentTime<8;});
  await page.locator('#version-audio').evaluate(a=>a.pause());await page.waitForTimeout(50);assert.equal(await page.locator('#ending-preview-error').isVisible(),false);
  await requirements();assert.match(await page.locator('#dialog').innerText(),/不代表听感收尾合格/);await page.click('[data-action="close"]');
  await page.click('[data-action="iterate"]');await page.getByText('生成偏好',{exact:true}).click();assert.equal(await page.inputValue('#music-ending'),'natural');
  await page.selectOption('#music-ending','as-described');truncated={abc:false,semantic:true};seconds=4;await generate();assert.equal(requests.at(-1).ending,'as-described');
  await page.locator('#music-ending-warning').waitFor();assert.match(await page.locator('#music-ending-warning').innerText(),/长度上限/);
  await page.click('#preview-ending');await page.waitForFunction(()=>{const a=document.querySelector('#version-audio');return a&&!a.paused&&a.currentTime<2;});await page.locator('#version-audio').evaluate(a=>a.pause());await page.waitForTimeout(50);assert.equal(await page.locator('#ending-preview-error').isVisible(),false);
  await mkdir('test-results/music-ending',{recursive:true});
  for(const width of [1440,390]){await page.setViewportSize({width,height:1100});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/music-ending/${width}.png`,fullPage:true});}
  await page.reload();await page.locator('#music-ending-warning').waitFor();await page.click('[data-action="iterate"]');await page.getByText('生成偏好',{exact:true}).click();assert.equal(await page.inputValue('#music-ending'),'as-described');
  truncated=undefined;await generate();assert.equal(await page.locator('#music-ending-warning').count(),0);await requirements();assert.match(await page.locator('#dialog').innerText(),/未记录生成是否达到长度上限/);await page.click('[data-action="close"]');
  const stored=(await service.call('studio_library',{})).versions.find(v=>v.id===first.id);assert.deepEqual(stored.input,first.input);assert.deepEqual(stored.musicTruncated,{abc:false,semantic:false});assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
