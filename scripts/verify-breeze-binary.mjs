import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
if(process.env.MUSIC_ROOM_BREEZE_REAL!=='1')throw Error('Set MUSIC_ROOM_BREEZE_REAL=1 to run installed real models');
const binary=resolve('release/music-room'),root=resolve('test-results/breeze-integration-2026-10-26/binary-real-'+Date.now());mkdirSync(root,{recursive:true});
const report={binarySha256:createHash('sha256').update(readFileSync(binary)).digest('hex'),results:[],humanListening:'pending'};
const env={...process.env,PATH:'/usr/bin:/bin'};let browser,runtime;
const start=()=>{execFileSync(binary,['start','--workspace',root],{env,stdio:'pipe',timeout:15000});runtime=JSON.parse(readFileSync(join(root,'.music-room.runtime.json'),'utf8'));};
const stop=()=>execFileSync(binary,['stop','--workspace',root],{env,stdio:'pipe',timeout:20000});
async function call(name,args={}){const response=await fetch(runtime.url+'/api/'+name,{method:'POST',headers:{authorization:'Bearer '+runtime.token,'content-type':'application/json'},body:JSON.stringify(args)});const r=await response.json();assert.ok(response.ok,JSON.stringify(r));return r;}
async function wait(id){const end=Date.now()+120000;while(Date.now()<end){const v=await call('tts_get_version',{versionId:id});if(!['queued','running'].includes(v.state)){assert.equal(v.state,'succeeded',v.error);return v;}await new Promise(r=>setTimeout(r,500));}throw Error('Binary TTS timeout');}
try{start();const status=await call('tts_status');assert.match(status.engine,/Breeze/);await call('create_project',{projectId:'breeze-binary',title:'Breeze 安装包验收'});const sound=await call('studio_create_sound',{projectId:'breeze-binary',title:'兼容语音',kind:'speech'}),voice=(await call('tts_library')).voices.find(v=>v.builtinId==='official');assert.ok(voice);
 browser=await chromium.launch({channel:'chrome',headless:true});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(runtime.url);await page.click('[data-action="project"][data-id="breeze-binary"]');await page.click(`[data-action="sound"][data-id="${sound.id}"]`);await page.click('[data-action="compose"]');await page.selectOption('#voice',voice.id);await page.click('#reference-transcript summary');await page.fill('#reference-text','翻译翻译，什么叫惊喜？');await page.fill('#creation-text','今天的天气很好，我们出发吧。');await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);
 let pending;for(let i=0;i<40&&!pending;i++){pending=(await call('tts_library')).versions.find(v=>v.soundId===sound.id);if(!pending)await new Promise(r=>setTimeout(r,250));}assert.ok(pending);const fresh=await wait(pending.id);assert.equal(fresh.engine,'Breeze TTS 2');report.results.push(fresh);
 await page.locator('#version-audio').waitFor();await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=2);await page.locator('#version-audio').evaluate(a=>a.play());await page.waitForFunction(()=>document.querySelector('#version-audio').currentTime>.1);await page.screenshot({path:join(root,'breeze-playing.png')});
 const legacy=await wait((await call('tts_generate',{soundId:sound.id,voiceId:voice.id,text:'今天的天气很好，我们出发吧。',seed:42})).id);assert.equal(legacy.engine,'IndexTTS 2.0');report.results.push(legacy);
 for(const v of report.results){const response=await fetch(runtime.url+'/speech/audio/'+v.id,{headers:{authorization:'Bearer '+runtime.token}});assert.equal(response.status,200);assert.equal(createHash('sha256').update(new Uint8Array(await response.arrayBuffer())).digest('hex'),v.artifact.sha256);}
 assert.deepEqual(errors,[]);await browser.close();browser=undefined;stop();start();for(const v of report.results){const restored=await call('tts_get_version',{versionId:v.id});assert.equal(restored.engine,v.engine);assert.equal(restored.referenceText,v.referenceText);assert.equal(restored.artifact.sha256,v.artifact.sha256);}report.status='passed';
}catch(error){report.status='failed';report.error=String(error);throw error;}
finally{await browser?.close();stop();writeFileSync(join(root,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({root,status:report.status,engines:report.results.map(v=>v.engine)}));}
