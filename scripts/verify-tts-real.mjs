// Explicit acceptance against the running production service and real IndexTTS weights.
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {chromium} from 'playwright';
import {wavInfo} from '../src/service/tts/speech.ts';
import {sourceRevision} from '../src/service/tts/runtime.ts';
import {modelRevision} from '../src/service/tts/python.ts';
const workspace=process.env.MUSIC_ROOM_WORKSPACE;
if(process.env.MUSIC_ROOM_TTS_REAL!=='1'||!workspace)throw Error('Set MUSIC_ROOM_TTS_REAL=1 and MUSIC_ROOM_WORKSPACE; prepare the real models first.');
const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));
async function call(name,args={}){const r=await fetch(runtime.url+'/api/'+name,{method:'POST',headers:{authorization:'Bearer '+runtime.token,'content-type':'application/json'},body:JSON.stringify(args)}),v=await r.json();assert.ok(r.ok,JSON.stringify(v));return v;}
const library=await call('tts_library');assert.equal(library.status.engine,'IndexTTS 2.0');assert.equal(library.status.canGenerate,true);assert.ok(library.voices.length,'Reference voice required');
const existingIds=new Set(library.versions.map(v=>v.id));
const installed=JSON.parse(await readFile(join(library.status.directory,'installed.json'),'utf8'));assert.equal(installed.sourceRevision,sourceRevision);assert.equal(installed.modelRevision,modelRevision);
const id='speech-studio',title='语音创作';let projects=(await call('list_projects')).projects;
if(!projects.some(p=>p.id===id))await call('create_project',{projectId:id,title});
let sound=library.sounds.find(s=>s.projectId===id&&s.title==='中文旁白');if(!sound)sound=await call('tts_create_sound',{projectId:id,title:'中文旁白'});
const out=resolve('test-results/speech-real');await mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage({viewport:{width:1440,height:1050}}),errors=[];
page.on('pageerror',e=>errors.push(e.message));let job,done=false;
try{
 await page.goto(runtime.url+'/speech.html');await page.locator(`[data-action="project"][data-id="${id}"]`).click();await page.locator(`[data-action="sound"][data-id="${sound.id}"]`).click();
 const text='你好，欢迎来到 Music Room。现在你可以在这里生成自己的语音。',emotion='平静、温暖';
 await page.locator('[data-action="compose"]').click();await page.locator('.advanced summary').click();
 await page.selectOption('#voice',library.voices[0].id);await page.fill('#creation-text',text);await page.fill('#emotion',emotion);await page.click('#generate');
 const deadline=Date.now()+30*60*1000;let last='';
 while(Date.now()<deadline){const versions=(await call('tts_library')).versions.filter(v=>v.soundId===sound.id&&v.text===text&&v.emotion===emotion&&!existingIds.has(v.id));job=versions.at(-1);if(job){const state=JSON.stringify({id:job.id,state:job.state,stage:job.stage,error:job.error});if(state!==last){console.log(state);last=state;}if(['succeeded','failed','cancelled','interrupted'].includes(job.state))break;}await new Promise(r=>setTimeout(r,3000));}
 assert.equal(job?.state,'succeeded',job?.error??'Real generation timed out');done=true;assert.equal(job.engine,'IndexTTS 2.0');assert.equal(job.text,text);assert.equal(job.emotion,emotion);
 const audioPath=join(workspace,'speech','audio',job.id+'.wav'),bytes=await readFile(audioPath),analysis=wavInfo(bytes),sha256=createHash('sha256').update(bytes).digest('hex');assert.ok(analysis.duration>1);assert.ok(analysis.peak>.001);assert.equal(sha256,job.artifact.sha256);
 const response=await fetch(runtime.url+'/speech/audio/'+job.id,{headers:{authorization:'Bearer '+runtime.token}});assert.equal(response.status,200);assert.deepEqual(Buffer.from(await response.arrayBuffer()),bytes);
 await page.locator(`[data-action="version"][data-id="${job.id}"]`).click();await page.waitForFunction(()=>!!document.querySelector('#version-audio')?.src);await page.locator('#version-audio').evaluate(a=>a.play());await page.waitForFunction(()=>document.querySelector('#version-audio')?.currentTime>.1);assert.ok(Math.abs(await page.locator('#version-audio').evaluate(a=>a.duration)-analysis.duration)<.1);
 const event=page.waitForEvent('download');await page.locator('[data-action="download"]').first().click();const download=await event;assert.match(download.suggestedFilename(),/中文旁白-V\d+\.wav/);assert.deepEqual(await readFile(await download.path()),bytes);
 await page.locator('[data-action="final"]').click();await page.waitForFunction(()=>document.querySelector('[data-action="final"]')?.textContent.includes('已选为成品'));
 await page.reload();await page.locator(`[data-action="project"][data-id="${id}"]`).click();await page.locator(`[data-action="sound"][data-id="${sound.id}"]`).click();await page.locator('#version-audio').waitFor();assert.match(await page.locator('.listening-top').innerText(),new RegExp('V'+job.number));await page.locator('[data-action="compose"]').click();assert.equal(await page.inputValue('#creation-text'),text);await page.click('[data-action="close"]');
 await page.screenshot({path:join(out,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:join(out,'mobile.png'),fullPage:true});assert.deepEqual(errors,[]);
 const report={realModel:true,engine:'IndexTTS 2.0',sourceRevision,modelRevision,versionId:job.id,audioPath,sha256,bytes:bytes.length,analysis,checks:['production browser submits real inference','fixed v2.0 source and weights','reference voice and text emotion inference','saved audible PCM WAV','authenticated bytes equal saved WAV','browser playback and duration','download bytes match saved WAV','selected final and draft survive reload','mobile layout'],errors};await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(job&&!done&&['queued','running'].includes(job.state))await call('tts_cancel',{versionId:job.id});await browser.close();}
