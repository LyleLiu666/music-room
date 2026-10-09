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
const wav=Buffer.from(encodeWav([Float32Array.from({length:22050},(_,i)=>Math.sin(i*.1)*.2)],22050));
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
test('emotion tiers persist as drafts and versions after reload/restart; editing legacy inputs cannot apply new defaults',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-emotion-ui-')),received=[];
 const driver={installed:()=>true,prepare:async()=>{},generate:async(_,req)=>{received.push(structuredClone(req));await writeFile(req.outputPath,wav);}};
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const open=()=>MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,driver);
 let service=await open(),http=await serveHttp(service,assets);
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const waitVersion=async(id)=>{for(let i=0;i<100&&service.speech.job(id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,10));assert.equal(service.speech.job(id).state,'succeeded');};
 try{
  await service.call('create_project',{projectId:'emotion',title:'情绪对照'});
  const sound=await service.call('studio_create_sound',{projectId:'emotion',title:'旁白',kind:'speech'}),voice=await service.call('tts_add_voice',{name:'参考音色',cleanup:false,audioBase64:wav.toString('base64')});
  const legacyEmpty=await service.call('studio_generate',{soundId:sound.id,voiceId:voice.id,text:'旧版空情绪'});await waitVersion(legacyEmpty.id);
  const legacyText=await service.call('studio_generate',{soundId:sound.id,voiceId:voice.id,text:'旧版有情绪',emotion:'开心'});await waitVersion(legacyText.id);
  await page.goto(http.runtime.url);await page.click('[data-action="compose"]');
  assert.equal(await page.inputValue('#emotion-strength'),'normal');
  assert.deepEqual(await page.locator('#emotion-strength option').allTextContents(),['情绪平淡','情绪一般','情绪强烈']);
  await page.selectOption('#emotion-strength','flat');await page.fill('#creation-text','新建平淡正文');await page.locator('details.advanced summary').click();await page.fill('#emotion','温柔而开心');await page.click('[data-action="close"]');
  await page.reload();await page.click('[data-action="compose"]');assert.equal(await page.inputValue('#emotion-strength'),'flat');assert.equal(await page.inputValue('#emotion'),'温柔而开心');assert.equal(await page.inputValue('#creation-text'),'新建平淡正文');
  await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.locator('#version-audio').waitFor();
  assert.equal(received.at(-1).emotionStrength,'flat');await page.locator('.version-row.selected .version-metadata').filter({hasText:'情绪平淡'}).waitFor();
  const generated=service.speech.snapshot().versions.at(-1);assert.equal(generated.emotionStrength,'flat');
  const port=Number(new URL(http.runtime.url).port);await http.close();await service.close();service=await open();http=await serveHttp(service,assets,port);
  await page.reload();await page.click('[data-action="iterate"]');assert.equal(await page.inputValue('#emotion-strength'),'flat');assert.equal(await page.inputValue('#emotion'),'温柔而开心');
  await page.selectOption('#emotion-strength','strong');await page.fill('#emotion','');await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.locator('#version-audio').waitFor();assert.equal(received.at(-1).emotionStrength,'strong');assert.equal(received.at(-1).emotion,undefined);assert.equal(service.speech.job(generated.id).emotionStrength,'flat');
  for(const [legacy,tier] of [[legacyEmpty,'strong'],[legacyText,'normal']]){
   await page.locator(`[data-action="version"][data-id="${legacy.id}"]`).click();await page.click('[data-action="iterate"]');assert.equal(await page.inputValue('#emotion-strength'),tier);
   await page.fill('#creation-text','只修改正文');await page.click('[data-action="close"]');await page.reload();await page.click('[data-action="compose"]');assert.equal(await page.inputValue('#emotion-strength'),tier);
   await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.locator('#version-audio').waitFor();assert.equal(received.at(-1).emotionStrength,undefined);assert.equal(received.at(-1).emotion,legacy.input.emotion);
  }
  const stored=JSON.parse(await readFile(join(root,'speech','library.json'),'utf8'));assert.equal(stored.versions.filter(v=>v.emotionStrength==='flat').length,1);assert.equal(Object.hasOwn(stored.versions.at(-1),'emotionStrength'),false);assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
