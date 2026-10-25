import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium,webkit} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {serveHttp} from '../src/server/http.ts';
import {testResources} from '../src/service/resources/testing.ts';
import {encodeWav} from '../src/wav.ts';
const engine=process.env.MUSIC_ROOM_BROWSER??'chrome';
assert.ok(['chrome','webkit'].includes(engine),'MUSIC_ROOM_BROWSER must be chrome or webkit');
test(`${engine}: keyboard dialogs, labels, saved drafts, WAV playback/download and narrow layout`,{timeout:60000},async()=>{
 const root=await mkdtemp(join(tmpdir(),'browser-compat-'));
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const wav=new Uint8Array(encodeWav([Float32Array.from({length:24000*2},(_,i)=>Math.sin(i*.1)*.15)],24000));
 const music={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
 const speech={installed:()=>true,prepare:async()=>{},generate:async(_,request)=>writeFile(request.outputPath,wav)};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,music,speech,undefined,testResources());
 const http=await serveHttp(service,assets);let browser;
 const out=resolve('test-results/browser-compat',engine);await mkdir(out,{recursive:true});
 const report={engine,status:'running',checks:[],errors:[],startedAt:new Date().toISOString()};
 try{
  browser=engine==='chrome'?await chromium.launch({channel:'chrome',headless:true}):await webkit.launch({headless:true});
  report.version=browser.version();const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);page.on('pageerror',e=>report.errors.push(e.message));
  await service.store.createProject('compat','浏览器兼容');const sound=await service.studio.createSound({projectId:'compat',title:'旁白',kind:'speech'});
  const voice=await service.speech.addVoice('测试音色',wav,false),version=await service.studio.generate({soundId:sound.id,text:'浏览器兼容检查',voiceId:voice.id});
  for(let i=0;i<200&&service.speech.job(version.id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,10));assert.equal(service.speech.job(version.id).state,'succeeded');
  await page.goto(http.runtime.url);await page.locator('#version-audio').waitFor();
  const opener=page.locator('[data-action="compose"]').first();await opener.focus();await page.keyboard.press('Enter');
  await page.getByRole('dialog').waitFor();assert.ok(await page.getByRole('dialog').getAttribute('aria-labelledby'));
  for(let i=0;i<24;i++){await page.keyboard.press(i%7===0?'Shift+Tab':'Tab');assert.equal(await page.evaluate(()=>document.activeElement===document.body||document.querySelector('#dialog').contains(document.activeElement)),true,'Tab must not reach background controls (browser chrome may receive focus)');}
  await page.getByLabel('要说的话',{exact:true}).fill('跨浏览器草稿 🌧️');
  await page.locator('#draft-save-status').filter({hasText:'草稿已保存'}).waitFor();
  // Closing queues the `close` event that restores focus. Wait for that
  // observable result, not just the open flag changing earlier in the task.
  await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('#dialog').open&&document.activeElement?.matches('[data-action="compose"]'));
  await page.evaluate(()=>{window.compatOpener=document.querySelector('[data-action="compose"]');window.dispatchEvent(new Event('focus'));});
  await page.waitForFunction(()=>!window.compatOpener.isConnected);
  assert.equal(await opener.evaluate(e=>e===document.activeElement),true,'Escape and a forced refresh keep focus on the opener');report.checks.push('background controls excluded from tab order; Escape return');
  await page.reload();await page.locator('[data-action="compose"]').first().click();assert.equal(await page.inputValue('#creation-text'),'跨浏览器草稿 🌧️');
  await page.getByText('情绪描述（可选）',{exact:true}).click();
  const unnamed=await page.locator('#dialog').evaluate(dialog=>[...dialog.querySelectorAll('input:not([type=hidden]),select,textarea,button')].filter(e=>!e.hidden&&e.getClientRects().length&&!e.getAttribute('aria-label')&&!e.getAttribute('aria-labelledby')&&!e.labels?.length&&!e.textContent.trim()).map(e=>e.id||e.outerHTML));assert.deepEqual(unnamed,[]);report.checks.push('visible controls have labels; draft survives reload');
  await page.keyboard.press('Escape');await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=1);
  // Playback needs a trusted user gesture, especially in Safari/WebKit.
  await page.locator('#version-audio').click();await page.locator('#version-audio').evaluate(a=>a.play());
  await page.waitForFunction(()=>document.querySelector('#version-audio')?.currentTime>.1);assert.ok(Math.abs(await page.locator('#version-audio').evaluate(a=>a.duration)-2)<.01);
  await page.locator('.more-menu summary').click();const downloading=page.waitForEvent('download');await page.locator('[data-action="download-original"]').click();const download=await downloading;assert.deepEqual(await readFile(await download.path()),Buffer.from(wav));report.checks.push('authenticated WAV playback and byte-identical download');
  await page.locator('[data-action="compose"]').first().click();
  await page.evaluate(()=>{window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key.includes(':draft:'))throw new DOMException('full','QuotaExceededError');return window.savedSetItem.call(this,key,value);};});
  await page.fill('#creation-text','尚未保存，取消离开后继续编辑');await page.getByRole('button',{name:'重试保存草稿'}).waitFor();
  const leaving=page.waitForEvent('dialog'),navigation=page.reload().catch(()=>undefined);const warning=await leaving;assert.equal(warning.type(),'beforeunload');await warning.dismiss();await navigation;
  assert.equal(await page.inputValue('#creation-text'),'尚未保存，取消离开后继续编辑');
  const audioAfter=await page.evaluate(()=>new Promise(resolve=>{const probe=new Audio(),timer=setTimeout(()=>resolve({ok:false,reason:'metadata timeout'}),5000);probe.onloadedmetadata=()=>{clearTimeout(timer);resolve({ok:true,duration:probe.duration});};probe.onerror=()=>{clearTimeout(timer);resolve({ok:false,reason:probe.error?.message});};probe.src=document.querySelector('#version-audio').src;}));assert.equal(audioAfter.ok,true,JSON.stringify(audioAfter));
  await page.evaluate(()=>{Storage.prototype.setItem=window.savedSetItem;});await page.getByRole('button',{name:'重试保存草稿'}).click();await page.locator('#draft-save-status').filter({hasText:'草稿已保存'}).waitFor();await page.keyboard.press('Escape');report.checks.push('cancelled leave keeps unsaved input and audio usable');
  await page.setViewportSize({width:720,height:456});await page.locator('[data-action="settings"]').click();await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');report.checks.push('short tablet viewport keeps Settings above the fixed transport');
  await page.setViewportSize({width:390,height:844});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:join(out,'narrow.png'),fullPage:true});report.checks.push('390px layout without horizontal overflow');
  assert.deepEqual(report.errors,[]);report.status='passed';
 }catch(error){report.status='failed';report.failure=String(error);throw error;}
 finally{report.finishedAt=new Date().toISOString();await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));await browser?.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
