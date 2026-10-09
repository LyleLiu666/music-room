// Run after verify-tts-real.mjs: cover the default reference emotion, iteration and real cancellation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {chromium} from 'playwright';
import {wavInfo} from '../src/service/tts/speech.ts';
const workspace=process.env.MUSIC_ROOM_WORKSPACE;
if(process.env.MUSIC_ROOM_TTS_REAL!=='1'||!workspace)throw Error('Requires MUSIC_ROOM_TTS_REAL=1 and MUSIC_ROOM_WORKSPACE. Run verify-tts-real first.');
const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8')),report=JSON.parse(await readFile('test-results/speech-real/verification.json','utf8'));
async function call(name,args={}){
 for(let attempt=0;;attempt++){
  let response;
  try{response=await fetch(runtime.url+'/api/'+name,{method:'POST',headers:{authorization:'Bearer '+runtime.token,'content-type':'application/json'},body:JSON.stringify(args)});}
  catch(error){if(attempt<2&&['tts_library','tts_get_version'].includes(name)){await new Promise(r=>setTimeout(r,250));continue;}throw error;}
  const value=await response.json();assert.ok(response.ok,JSON.stringify(value));return value;
 }
}
const first=await call('tts_get_version',{versionId:report.versionId}),library=await call('tts_library'),existing=new Set(library.versions.map(v=>v.id));assert.equal(first.state,'succeeded');assert.ok(library.status.canGenerate);
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];page.on('pageerror',e=>errors.push(e.message));let version,done=false;
try{
 await page.goto(runtime.url+'/speech.html');await page.locator(`[data-action="project"][data-id="${first.projectId}"]`).click();await page.locator(`[data-action="sound"][data-id="${first.soundId}"]`).click();await page.locator(`[data-action="version"][data-id="${first.id}"]`).click();await page.locator('[data-action="iterate"]').first().click();
 const text='这是一段使用参考声音的普通旁白。每个版本都会保存下来，你可以试听，再决定保留哪一版。';await page.fill('#creation-text',text);await page.fill('#emotion','');await page.click('#generate');const deadline=Date.now()+15*60*1000;let last='';
 while(Date.now()<deadline){version=(await call('tts_library')).versions.find(v=>!existing.has(v.id)&&v.soundId===first.soundId&&v.text===text);if(version){const state=JSON.stringify({id:version.id,state:version.state,stage:version.stage,error:version.error});if(state!==last){console.log(state);last=state;}if(['succeeded','failed','cancelled','interrupted'].includes(version.state))break;}await new Promise(r=>setTimeout(r,3000));}
 assert.equal(version?.state,'succeeded',version?.error??'generation timed out');done=true;assert.equal(version.parentId,first.id);assert.equal(version.emotion,undefined);assert.equal((await call('tts_library')).sounds.find(s=>s.id===first.soundId).finalVersionId,first.id);
 const audioPath=join(workspace,'speech','audio',version.id+'.wav'),bytes=await readFile(audioPath),analysis=wavInfo(bytes);assert.ok(analysis.duration>1&&analysis.peak>.001);
 await page.locator('#version-audio').waitFor();await page.waitForFunction(()=>!!document.querySelector('#version-audio')?.src);await page.locator('#version-audio').evaluate(a=>a.play());await page.waitForFunction(()=>document.querySelector('#version-audio')?.currentTime>.1);
 await page.locator(`[data-compare="${first.id}"]`).check();await page.locator(`[data-compare="${version.id}"]`).check();await page.locator('[data-action="compare"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('dialog audio')].every(a=>a.src));await page.locator('dialog audio').first().evaluate(a=>a.play());await page.waitForFunction(()=>document.querySelector('dialog audio')?.currentTime>.1);await page.locator('dialog audio').last().evaluate(a=>a.play());assert.equal(await page.locator('dialog audio').first().evaluate(a=>a.paused),true);await page.locator('[data-action="close"]').click();
 const probe=await call('tts_generate',{soundId:first.soundId,voiceId:first.voiceId,text:'用于验证取消的语音。'});await new Promise(r=>setTimeout(r,1200));assert.equal((await call('tts_get_version',{versionId:probe.id})).state,'running');const started=Date.now();assert.equal((await call('tts_cancel',{versionId:probe.id})).state,'cancelled');assert.equal(existsSync(join(workspace,'speech','audio',probe.id+'.wav')),false);assert.equal(existsSync(join(library.status.directory,'.music-room-indextts.lock')),false);await call('tts_update_version',{versionId:probe.id,deleted:true});
 await page.reload();await page.locator('#version-audio').waitFor();assert.equal(await page.locator('.sound-heading h2').innerText(),'中文旁白');await page.locator('[data-action="compose"]').click();assert.equal(await page.inputValue('#creation-text'),text);await page.click('[data-action="close"]');await page.screenshot({path:'test-results/speech-real/two-versions.png',fullPage:true});assert.deepEqual(errors,[]);
 report.plainVersion={versionId:version.id,parentId:version.parentId,audioPath,sha256:version.artifact.sha256,analysis};report.cancellation={versionId:probe.id,seconds:(Date.now()-started)/1000,state:'cancelled',noAudioPublished:true,modelLockReleased:true};report.checks.push('default reference emotion generates real speech','iteration preserves original final and source version','real two-version audio comparison and playback mutex','real Python inference cancellation releases the process lease','last sound and next draft restored after reload');await writeFile('test-results/speech-real/verification.json',JSON.stringify(report,null,2));console.log(JSON.stringify({plainVersion:report.plainVersion,cancellation:report.cancellation}));
}finally{if(version&&!done&&['queued','running'].includes(version.state))await call('tts_cancel',{versionId:version.id});await browser.close();}
