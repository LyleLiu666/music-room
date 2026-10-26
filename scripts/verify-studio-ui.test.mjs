import {ResourceError} from '../src/service/resources/contracts.ts';
import {testResources} from '../src/service/resources/testing.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {serveHttp} from '../src/server/http.ts';
import {encodeWav} from '../src/wav.ts';
import {wavInfo} from '../src/service/tts/speech.ts';
import {readBuiltinVoices} from '../src/service/tts/presets.ts';
const wav=Buffer.from(encodeWav([Float32Array.from({length:22050*4},(_,i)=>Math.sin(i*.1)*.2)],22050));
async function openTrash(page){await page.click('[data-action="settings"]');await page.click('[data-action="trash"]');await page.locator('#dialog-title').filter({hasText:'回收站'}).waitFor();}
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
test('music lyrics: explicit modes, complete example, draft preservation and isolated instrumental submission',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-lyrics-ui-'));
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());
 const jobs=[],requests=[];
 service.yue2.inspectInput=async()=>({prefixTokens:200,planningTokens:4098,semanticTokens:9000,contextTokens:24576,requiredTokens:13298,remainingTokens:11278});service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'就绪',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});
 service.yue2Client.list=async()=>({jobs});
 service.yue2Client.generate=async args=>{requests.push(structuredClone(args));const job={id:crypto.randomUUID().replaceAll('-',''),status:'done',kind:'create',title:args.title};jobs.push(job);return {job};};
 service.yue2Client.audio=async()=>wav;
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await service.call('create_project',{projectId:'lyrics',title:'歌词交互'});
  await service.call('studio_create_sound',{projectId:'lyrics',title:'春日主题曲',kind:'music'});
  await page.goto(http.runtime.url);await page.click('[data-action="compose"]');
  const instrumental=page.getByRole('radio',{name:'不带歌词（纯音乐）',exact:true}),vocal=page.getByRole('radio',{name:'带歌词（演唱）',exact:true});
  assert.equal(await instrumental.count(),1);assert.ok(await instrumental.isChecked());assert.equal(await page.locator('#lyrics-wrap').isVisible(),false);
  await page.fill('#creation-text','轻快的民谣，温柔女声');await vocal.check();
  assert.ok(await page.locator('#lyrics-wrap').isVisible());assert.match(await page.locator('#lyrics-help').innerText(),/完整歌词/);
  await page.click('#generate');assert.equal(requests.length,0);assert.equal(await page.locator('#lyrics').evaluate(e=>e.validity.valueMissing),true);
  await page.fill('#lyrics','   ');await page.click('#generate');assert.equal(requests.length,0);assert.equal(await page.locator('#lyrics').evaluate(e=>e.validity.customError),true);await page.fill('#lyrics','');
  await page.getByText('查看完整歌词示例 · 风来时',{exact:true}).click();
  const sample=await page.locator('#lyrics-example-text').innerText();assert.match(sample,/\[Verse\]/);assert.match(sample,/\[Chorus\]/);assert.match(sample,/\[Outro\]/);
  await page.getByRole('button',{name:'填入示例歌词',exact:true}).click();
  assert.equal(await page.inputValue('#lyrics'),sample);assert.equal(await page.inputValue('#creation-text'),'轻快的民谣，温柔女声');assert.equal(requests.length,0);
  assert.ok(await page.locator('#fill-lyrics-example').isDisabled());
  const edited=sample.replace('收起桌上的纸张','收起昨天的匆忙');await page.fill('#lyrics',edited);
  await instrumental.check();assert.equal(await page.locator('#lyrics-wrap').isVisible(),false);await vocal.check();assert.equal(await page.inputValue('#lyrics'),edited);
  await page.click('[data-action="close"]');await page.reload();await page.click('[data-action="compose"]');
  assert.ok(await vocal.isChecked());assert.equal(await page.inputValue('#lyrics'),edited);
  await mkdir('test-results/studio',{recursive:true});
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.locator('#lyrics').scrollIntoViewIfNeeded();await page.screenshot({path:`test-results/studio/lyrics-${width}.png`,fullPage:true});
  }
  await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.locator('#version-audio').waitFor();
  assert.equal(requests.length,1);assert.equal(requests[0].instrumental,false);assert.equal(requests[0].lyrics,edited);
  await page.click('[data-action="iterate"]');assert.ok(await vocal.isChecked());assert.equal(await page.inputValue('#lyrics'),edited);
  await instrumental.check();await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);
  assert.equal(requests.length,2);assert.equal(requests[1].instrumental,true);assert.equal(requests[1].lyrics,'[instrumental]');
  await page.click('[data-action="compose"]');await vocal.check();assert.equal(await page.inputValue('#lyrics'),edited);
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
for(const memoryFailure of [false,true])test(`failed speech retry restores requirements and submits an edited new version from the player (memory=${memoryFailure})`,async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-retry-ui-'));
 const driver={installed:()=>true,prepare:async()=>{},generate:async(_,req)=>{
  if(req.text==='原来的正文')throw memoryFailure?new ResourceError('PRESSURE_PROTECTION','系统交换空间增长超过安全阈值，已停止任务'):Error('此模型配置的资源需求尚未验证');
  await writeFile(req.outputPath,wav);
 }};
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,driver,undefined,testResources());
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true});
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await service.call('create_project',{projectId:'retry',title:'失败重试'});
  const sound=await service.call('studio_create_sound',{projectId:'retry',title:'旁白',kind:'speech'});
  const voice=await service.call('tts_add_voice',{cleanup:false,name:'参考声音',audioBase64:wav.toString('base64')});
  const original=await service.call('studio_generate',{soundId:sound.id,voiceId:voice.id,text:'原来的正文',emotion:'平静',emotionStrength:'strong'});
  await page.goto(http.runtime.url);
  if(memoryFailure){
   await page.getByRole('button',{name:'查看内存状态',exact:true}).click();
   await page.locator('#resource-status').filter({hasText:'应用上限'}).waitFor();
   await page.click('[data-action="close"]');
   await page.setViewportSize({width:390,height:844});
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await mkdir('test-results/studio',{recursive:true});
   await page.screenshot({path:'test-results/studio/memory-failure.png',fullPage:true});
  }
  await page.getByRole('button',{name:memoryFailure?'修改要求':'修改后重试',exact:true}).click();
  assert.equal(await page.inputValue('#creation-text'),'原来的正文');
  assert.equal(await page.inputValue('#voice'),voice.id);
  assert.equal(await page.inputValue('#emotion'),'平静');
  assert.equal(await page.inputValue('#emotion-strength'),'strong');
  await page.fill('#creation-text','修改后的正文');await page.click('#generate');
  await page.locator('#version-audio').waitFor();
  const versions=(await service.call('studio_library',{})).versions;
  assert.equal(versions.length,2);
  const retry=versions.find(v=>v.id!==original.id);
  assert.equal(retry.state,'succeeded');assert.equal(retry.parentId,original.id);
  assert.equal(retry.input.text,'修改后的正文');assert.equal(retry.input.emotionStrength,'strong');
  assert.equal(versions.find(v=>v.id===original.id).state,'failed');
  await page.reload();await page.locator('#version-audio').waitFor();
  assert.equal(await page.locator('.version-row').count(),2);assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
test('music settings reflect enablement, show pending feedback and can enable again after stopping',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-music-enable-ui-'));
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());
 let enabled=false,fail=false,calls=0,release;const gate=new Promise(r=>release=r);
 service.yue2.inspectInput=async()=>({prefixTokens:200,planningTokens:4098,semanticTokens:9000,contextTokens:24576,requiredTokens:13298,remainingTokens:11278});service.yue2.status=async()=>({phase:'stopped',canGenerate:enabled,installed:true,modelsReady:true,autoStart:enabled,message:enabled?'YuE2 已启用，生成时按需加载':'YuE2 尚未启用',logs:[],defaultDirectory:'/tmp/unused'});
 service.yue2.start=async()=>{calls++;await gate;if(fail)throw Error('测试启用失败');enabled=true;return service.yue2.status();};
 service.yue2.stop=async()=>{enabled=false;return service.yue2.status();};
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 try{
  await page.goto(http.runtime.url);await page.click('[data-action="settings"]');
  const button=page.locator('[data-action="start-music"]');assert.equal(await button.innerText(),'启用');
  await button.click();await page.getByRole('button',{name:'启用中…',exact:true}).waitFor();assert.equal(await button.isDisabled(),true);
  await page.waitForTimeout(1500);assert.equal(await button.isDisabled(),true);assert.equal(calls,1);
  release();await page.getByRole('button',{name:'已启用',exact:true}).waitFor();assert.equal(await button.isDisabled(),true);
  assert.match(await page.locator('#music-enable-help').innerText(),/创作窗口/);
  await page.click('[data-action="close"]');await page.reload();await page.click('[data-action="settings"]');
  assert.equal(await button.innerText(),'已启用');assert.equal(await button.isDisabled(),true);
  await page.locator('details.advanced summary').click();await page.click('[data-action="stop-music"]');
  await page.getByRole('button',{name:'启用',exact:true}).waitFor();assert.equal(await button.isEnabled(),true);
  fail=true;await button.click();await page.locator('#toast').filter({hasText:'测试启用失败'}).waitFor();
  assert.equal(await button.isEnabled(),true);assert.equal(await button.innerText(),'启用');
  fail=false;await button.click();await page.getByRole('button',{name:'已启用',exact:true}).waitFor();assert.equal(calls,3);
 }finally{release();await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
test('music pressure failure preserves quality requirements and submits a fast retry with history intact',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-music-retry-ui-'));
 const assets={read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false};
 const service=await MusicService.open(root,()=>{throw Error('unused');},assets.read,false,unused,undefined,undefined,testResources());
 const jobs=[],requests=[];
 service.yue2.inspectInput=async()=>({prefixTokens:200,planningTokens:4098,semanticTokens:9000,contextTokens:24576,requiredTokens:13298,remainingTokens:11278});service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'就绪',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});
 service.yue2Client.list=async()=>({jobs});
 service.yue2Client.generate=async args=>{
  requests.push(structuredClone(args));
  const job={id:crypto.randomUUID().replaceAll('-',''),status:requests.length===1?'failed':'done',kind:'create',title:args.title};
  if(job.status==='failed')Object.assign(job,{error:'系统交换空间增长超过安全阈值，已停止任务',stage:'系统交换空间增长超过安全阈值，已停止任务',resource:{id:job.id,engine:'yue2',stage:'blocked',submittedAt:Date.now(),reason:'PRESSURE_PROTECTION',message:'系统交换空间增长超过安全阈值，已停止任务'}});
  jobs.push(job);return {job};
 };
 service.yue2Client.audio=async()=>wav;
 const http=await serveHttp(service,assets),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage();
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await service.call('create_project',{projectId:'music-retry',title:'音乐重试'});
  const sound=await service.call('studio_create_sound',{projectId:'music-retry',title:'片段',kind:'music'});
  const original=await service.call('studio_generate',{soundId:sound.id,text:'快乐的小提琴',lyrics:'[instrumental]',instrumental:true,preset:'quality'});
  await page.goto(http.runtime.url);
  await page.getByRole('button',{name:'查看内存状态',exact:true}).click();
  await page.locator('#resource-status').filter({hasText:'应用上限'}).waitFor();await page.click('[data-action="close"]');
  await page.getByRole('button',{name:'修改要求',exact:true}).click();
  assert.equal(await page.inputValue('#creation-text'),'快乐的小提琴');assert.equal(await page.inputValue('#preset'),'quality');
  assert.equal(await page.inputValue('#lyrics'),'[instrumental]');assert.equal(await page.locator('[name="instrumental"][value="true"]').isChecked(),true);
  await page.getByText('生成偏好',{exact:true}).click();await page.selectOption('#preset','fast');await page.click('#generate');
  await page.locator('#version-audio').waitFor();
  assert.deepEqual(requests.map(r=>r.preset),['quality','fast']);
  const versions=(await service.call('studio_library',{})).versions,child=versions.find(v=>v.id!==original.id);
  assert.equal(versions.length,2);assert.equal(child.parentId,original.id);assert.equal(child.state,'succeeded');
  assert.equal(child.input.preset,'fast');assert.equal(child.input.text,original.input.text);
  assert.equal(versions.find(v=>v.id===original.id).state,'failed');assert.equal(versions.find(v=>v.id===original.id).input.preset,'quality');
  await page.locator(`[data-action="version"][data-id="${original.id}"]`).click();
  const retry=page.getByRole('button',{name:'重试生成',exact:true});assert.match(await retry.getAttribute('class'),/primary/);
  for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});
   const rect=await retry.boundingBox();assert.ok(rect.height>=44);assert.ok(rect.x>=0&&rect.x+rect.width<=width);
   assert.equal(await page.locator('.failure-actions button').first().innerText(),'重试生成');
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  }
  await page.setViewportSize({width:1440,height:1000});await mkdir('test-results/studio',{recursive:true});await page.screenshot({path:'test-results/studio/retry-actions-desktop.png',fullPage:true});
  await retry.click();await page.locator('#version-audio').waitFor();assert.equal(await page.locator('dialog').evaluate(d=>d.open),false);
  assert.deepEqual(requests.map(r=>r.preset),['quality','fast','quality']);
  const repeated=(await service.call('studio_library',{})).versions.find(v=>v.id===original.id);
  assert.equal(repeated.number,original.number);assert.equal(repeated.input.text,original.input.text);assert.equal(repeated.input.preset,'quality');
  assert.equal(repeated.musicAttempts.length,1);assert.equal(repeated.musicAttempts[0].jobId,original.source.id);assert.equal(repeated.musicAttempts[0].state,'failed');
  assert.notEqual(repeated.source.id,original.source.id);
  await page.reload();await page.locator('#version-audio').waitFor();assert.equal(await page.locator('.version-row').count(),2);assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
test('unified production UI: mixed project, real routes, versions, playback, drafts, comparison, trash, MIDI and responsive hierarchy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-ui-'));const driver={installed:()=>true,prepare:async()=>{},cleanReference:async(_,req)=>{await writeFile(req.outputPath,wav);},generate:async(_,req,ctx)=>{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,2300);ctx.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('cancelled'));},{once:true});});await writeFile(req.outputPath,wav);}};
 const renderer=({composition})=>{const pcm=Float32Array.from({length:Math.round(composition.score.duration*44100)},(_,i)=>Math.sin(i*.1)*.2);return {result:Promise.resolve({wav:new Uint8Array(encodeWav([pcm,pcm],44100)),peak:.2,rms:.1,attenuation:1,engine:'test-pcm'}),cancel:()=>{}};};
 const service=await MusicService.open(root,renderer,p=>readFile(resolve('dist',p)),false,unused,driver,undefined,testResources()),http=await serveHttp(service,{read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false});
 const musicJobs=[];service.yue2.inspectInput=async()=>({prefixTokens:200,planningTokens:4098,semanticTokens:9000,contextTokens:24576,requiredTokens:13298,remainingTokens:11278});service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'就绪',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});
 service.yue2Client.list=async()=>({jobs:musicJobs});service.yue2Client.generate=async args=>{const job={id:crypto.randomUUID().replaceAll('-',''),status:'running',kind:'create',title:args.title};musicJobs.push(job);setTimeout(()=>{job.status='done';},1000);return {job};};service.yue2Client.audio=async()=>wav;
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('response',async r=>{if(r.status()>=400)console.log(r.url(),await r.text());});
 try{
  await page.goto(http.runtime.url);await page.getByRole('button',{name:'＋ 新建项目',exact:true}).first().click();await page.fill('#project-name','春日短片');await page.locator('#project-form button').click();
  await page.locator('[name="kind"][value="speech"]').check();await page.fill('#sound-title','开场旁白');await page.locator('#sound-form button').click();
  await page.locator('.reference-upload summary').click();await page.fill('#voice-name','我的声音');await page.locator('#voice-file').setInputFiles({name:'reference.wav',mimeType:'audio/wav',buffer:wav});await page.locator('[data-action="upload-voice"]').click();await page.waitForFunction(()=>document.querySelector('#voice')?.selectedOptions[0]?.textContent==='我的声音');
  await page.fill('#creation-text','第一版开场旁白');await page.click('#generate');await page.waitForFunction(()=>!document.querySelector('dialog').open);await page.locator('#version-audio').waitFor();await page.waitForFunction(()=>!!document.querySelector('#version-audio')?.src);
  assert.equal(await page.locator('canvas').count(),0);assert.equal(await page.getByRole('link',{name:'语音创作 ↗'}).count(),0);assert.equal(await page.locator('[data-action="compose"]').count(),1);
  await page.locator('[data-action="final"]').click();await page.waitForFunction(()=>document.querySelector('[data-action="final"]')?.textContent.includes('已选'));await page.locator('[data-action="keep"]').click();
  await page.locator('[data-action="iterate"]').click();assert.equal(await page.inputValue('#creation-text'),'第一版开场旁白');await page.fill('#creation-text','第二版开场旁白');await page.click('#generate');await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===2);const first=service.speech.snapshot().versions[0];await page.locator(`[data-action="version"][data-id="${first.id}"]`).click();await page.waitForFunction(()=>!!document.querySelector('#version-audio')?.src);await page.evaluate(()=>{window.player=document.querySelector('#version-audio');player.loop=true;return player.play();});await page.waitForTimeout(2400);assert.equal(await page.evaluate(()=>player===document.querySelector('#version-audio')&&!player.paused),true);
  await page.waitForFunction(()=>document.querySelectorAll('[data-select-version]:not([disabled])').length===2);assert.equal(service.speech.snapshot().sounds[0].finalVersionId,first.id);
  await page.locator('[data-select-version]').first().check();await page.locator('[data-select-version]').last().check();await page.locator('[data-action="compare"]').click();await page.waitForFunction(()=>[...document.querySelectorAll('dialog audio')].every(a=>a.src));await page.locator('dialog audio').first().evaluate(a=>a.play());await page.locator('dialog audio').last().evaluate(a=>a.play());assert.equal(await page.locator('dialog audio').first().evaluate(a=>a.paused),true);await page.click('[data-action="close"]');
  await page.locator('.more-menu summary').click();await page.click('[data-action="delete"]');await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===1);await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===2);assert.equal(service.speech.snapshot().sounds[0].finalVersionId,undefined);
  await page.locator('[data-action="compose"]').click();await page.fill('#creation-text','刷新后仍然保留的草稿');await page.click('[data-action="close"]');await page.reload();await page.locator('[data-action="compose"]').click();assert.equal(await page.inputValue('#creation-text'),'刷新后仍然保留的草稿');await page.click('[data-action="close"]');
  const download=page.waitForEvent('download');await page.locator('[data-action="download"]').click();assert.match((await download).suggestedFilename(),/开场旁白-V\d.mp3/);
  await page.locator('.more-menu summary').click();const originalPromise=page.waitForEvent('download');await page.click('[data-action="download-original"]');const original=await originalPromise;assert.match(original.suggestedFilename(),/开场旁白-V\d.wav/);assert.deepEqual(await readFile(await original.path()),wav);await page.locator('.more-menu summary').click();
  await page.click('[data-action="new-sound"]');await page.locator('[name="kind"][value="clip"]').check();await page.fill('#sound-title','钢琴片头');await page.locator('#sound-form button').click();await page.fill('#creation-text','清晨，轻快的钢琴短句');await page.click('#generate');await page.locator('#version-audio').waitFor();await page.waitForFunction(()=>!!document.querySelector('#version-audio')?.src);assert.equal(await page.locator('.sound-tab').count(),2);assert.equal((await service.call('studio_library',{})).projects.length,1);
  await page.click('[data-action="tools"]');await page.getByText('MIDI / JSON 导入与编辑工具',{exact:true}).click();await page.click('[data-action="import"]');const example=await readFile('src/music/authoring/example.json');await page.locator('#score-file').setInputFiles({name:'score.json',mimeType:'application/json',buffer:example});await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===2);
  await page.locator('[data-select-version]').first().check();await page.locator('[data-select-version]').last().check();assert.equal(await page.locator('[data-action="compare"]').count(),0);await page.getByRole('button',{name:'取消选择',exact:true}).click();
  await page.click('[data-action="render"]');await page.locator('#version-audio').waitFor();await page.waitForFunction(()=>!!document.querySelector('#version-audio')?.src);assert.equal(await page.locator('.sound-tab').count(),2);
  await page.locator('.more-menu summary').click();const midi=page.waitForEvent('download');await page.click('[data-action="midi"]');assert.match((await midi).suggestedFilename(),/钢琴片头-V2.mid/);await page.locator('.more-menu summary').click();
  await page.click('[data-action="new-sound"]');await page.locator('[name="kind"][value="music"]').check();await page.fill('#sound-title','片尾主题曲');await page.locator('#sound-form button').click();await page.locator('[name="instrumental"][value="false"]').check();await page.fill('#creation-text','温暖的民谣');await page.fill('#lyrics','[verse]\n走向春天');await page.click('#generate');await page.locator('#version-audio').waitFor();assert.equal(await page.locator('.sound-tab').count(),3);
  const toolbar=await page.locator('.workspace-toolbar').evaluate(el=>{const rect=el.getBoundingClientRect();return {height:rect.height,centers:[el.querySelector('h1'),el.querySelector('.sound-nav'),el.querySelector('.project-actions')].map(x=>{const r=x.getBoundingClientRect();return r.y+r.height/2;})};});assert.ok(toolbar.height<70,'project controls occupy a compact row');assert.ok(Math.max(...toolbar.centers)-Math.min(...toolbar.centers)<2,'title, sound tabs and actions share a row');assert.equal(await page.locator('.sound-heading').count(),0,'current sound heading is not repeated');
  await mkdir('test-results/studio',{recursive:true});await page.screenshot({path:'test-results/studio/desktop.png',fullPage:true});
  for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`overflow ${width}`);}
  await page.screenshot({path:'test-results/studio/mobile.png',fullPage:true});await page.click('[data-action="compose"]');assert.ok(await page.evaluate(()=>document.querySelector('dialog').getBoundingClientRect().right<=innerWidth));await page.screenshot({path:'test-results/studio/mobile-compose.png',fullPage:true});
  // Scroll-performance guard: `background-attachment: local` on a scroller forces a full repaint
  // every scroll frame (measured 60fps -> 8.8fps), and a full-viewport backdrop blur is a
  // per-frame compositor pass. See scripts/perf-studio-scroll.mjs (LEGACY=local reproduces it).
  const dialogPaint=await page.evaluate(()=>{const el=document.querySelector('dialog .dialog-body');return {attachment:getComputedStyle(el).backgroundAttachment,backdrop:getComputedStyle(document.querySelector('dialog'),'::backdrop').backdropFilter||getComputedStyle(document.querySelector('dialog'),'::backdrop').webkitBackdropFilter};});
  assert.ok(!dialogPaint.attachment.includes('local'),`dialog scroller must not use local-attachment backgrounds (got: ${dialogPaint.attachment})`);assert.equal(dialogPaint.backdrop,'none','dialog backdrop must not use backdrop-filter');
  assert.deepEqual(errors,[]);console.log('Unified UI integration passed; model drivers are fixtures, no claim of new model inference.');
 }catch(e){console.log(await page.locator('#toast').textContent());console.log(await page.locator('#workspace').innerText());throw e;}finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('reference voices are cleaned in the existing backend, previewed, favourited and reused after switching projects and reloading',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-voices-ui-')),cleaned=new Uint8Array(encodeWav([Float32Array.from({length:22050},(_,i)=>Math.sin(i*.15)*.2)],22050));
 let release=()=>{},fail=false,cleaningCalls=0;const gate=new Promise(r=>release=r);
 const driver={installed:()=>true,prepare:async()=>{},cleanReference:async(_,req,ctx)=>{cleaningCalls++;ctx.stage('正在去除混响');await gate;if(fail)throw Error('测试清理失败');await writeFile(req.outputPath,cleaned);},generate:async(_,req)=>{assert.deepEqual(new Uint8Array(await readFile(req.referencePath)),cleaned);await writeFile(req.outputPath,wav);}};
 const service=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('dist',p)),false,unused,driver,undefined,testResources()),http=await serveHttp(service,{read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false});
 const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  for(const id of ['first','second']){await service.call('create_project',{projectId:id,title:id});await service.call('studio_create_sound',{projectId:id,title:'旁白',kind:'speech'});}
  await page.goto(http.runtime.url);await page.getByRole('button',{name:'＋ 开始创作',exact:true}).click();
  await page.fill('#creation-text','保存音色时也要保留草稿');await page.locator('.reference-upload summary').click();await page.fill('#voice-name','我的旁白');await page.fill('#voice-start','1');
  await page.locator('#voice-file').setInputFiles({name:'reference.wav',mimeType:'audio/wav',buffer:wav});assert.equal(await page.locator('#voice-cleanup').isChecked(),true);await page.click('[data-action="upload-voice"]');
  await page.locator('#voice-preview').filter({hasText:'正在去除混响'}).waitFor();assert.equal(await page.locator('#generate').isDisabled(),true);assert.equal(await page.inputValue('#creation-text'),'保存音色时也要保留草稿');
  const voice=service.speech.snapshot().voices[0];assert.ok(Math.abs(wavInfo(service.speech.voiceAudio(voice.id,true)).duration-3)<.01);
  release();await page.locator('#voice-preview').filter({hasText:'处理后人声'}).waitFor();assert.equal(await page.locator('#generate').isEnabled(),true);assert.equal(await page.locator('#voice-preview audio').count(),2);
  await page.waitForFunction(()=>[...document.querySelectorAll('#voice-preview audio')].every(a=>a.src));
  await page.locator('#voice-preview audio').first().evaluate(a=>a.play());await page.locator('#voice-preview audio').last().evaluate(a=>a.play());assert.equal(await page.locator('#voice-preview audio').first().evaluate(a=>a.paused),true);
  await page.click('[data-action="favorite-voice"]');await page.locator('[data-action="favorite-voice"][aria-pressed="true"]').waitFor();assert.equal(service.speech.snapshot().voices[0].favorite,true);
  await mkdir('test-results/studio',{recursive:true});await page.waitForFunction(()=>[...document.querySelectorAll('#voice-preview audio')].every(a=>a.readyState>=1));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/studio/reference-voices-desktop.png',fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/studio/reference-voices-mobile.png',fullPage:true});
  await page.click('[data-action="close"]');await page.locator('[data-action="project"][data-id="second"]').click();await page.click('[data-action="compose"]');assert.equal(await page.inputValue('#voice'),voice.id);await page.fill('#creation-text','在另一个项目复用音色');await page.click('#generate');await page.locator('#version-audio').waitFor();assert.equal(cleaningCalls,1);
  await page.reload();await page.click('[data-action="compose"]');assert.equal(await page.inputValue('#voice'),voice.id);assert.equal(await page.locator('[data-action="favorite-voice"]').getAttribute('aria-pressed'),'true');
  fail=true;await page.locator('.reference-upload summary').click();await page.fill('#voice-name','失败后重试');await page.locator('#voice-file').setInputFiles({name:'failed.wav',mimeType:'audio/wav',buffer:wav});await page.click('[data-action="upload-voice"]');await page.locator('#voice-preview').filter({hasText:'测试清理失败'}).waitFor();assert.equal(await page.locator('#generate').isDisabled(),true);
  fail=false;await page.click('[data-action="clean-voice"]');await page.locator('#voice-preview').filter({hasText:'处理后人声'}).waitFor();assert.equal(await page.locator('#generate').isEnabled(),true);assert.deepEqual(errors,[]);
 }finally{release();await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('version selection deletes failed and cancelled attempts in batches, preserves active jobs, and supports undo and recovery',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-delete-ui-'));
 const driver={installed:()=>true,prepare:async()=>{},generate:async(_,req,ctx)=>{
  if(req.text==='失败')throw Error('测试生成失败');
  if(['进行中','取消'].includes(req.text))await new Promise((_,reject)=>ctx.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));
  await writeFile(req.outputPath,wav);
 }};
 const service=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('dist',p)),false,unused,driver,undefined,testResources());
 const http=await serveHttp(service,{read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false});
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await service.call('create_project',{projectId:'cleanup',title:'清理试做版本'});
  const sound=await service.call('studio_create_sound',{projectId:'cleanup',title:'旁白',kind:'speech'});
  const other=await service.call('studio_create_sound',{projectId:'cleanup',title:'另一个声音',kind:'speech'});
  const voice=await service.call('tts_add_voice',{cleanup:false,name:'参考声音',audioBase64:wav.toString('base64')});
  const generate=text=>service.call('studio_generate',{soundId:sound.id,text,voiceId:voice.id});
  const waitState=async(id,state)=>{for(let i=0;i<100;i++){if(service.speech.job(id).state===state)return;await new Promise(r=>setTimeout(r,20));}assert.fail(`version ${id} did not reach ${state}`);};
  const completed=[];
  for(const text of ['一','二','三']){const v=await generate(text);await waitState(v.id,'succeeded');completed.push(v);}
  await service.call('studio_update_version',{versionId:completed[0].id,final:true,kept:true});
  const failed=await generate('失败');await waitState(failed.id,'failed');
  const cancelled=await generate('取消');await waitState(cancelled.id,'running');await service.call('studio_cancel',{versionId:cancelled.id});
  const running=await generate('进行中');await waitState(running.id,'running');
  const queued=await generate('排队中');
  await page.goto(http.runtime.url);await page.locator('.version-row').first().waitFor();
  const select=id=>page.locator(`[data-select-version="${id}"]`);
  assert.equal(await select(running.id).isDisabled(),true);assert.equal(await select(queued.id).isDisabled(),true);
  await select(failed.id).check();assert.equal(await page.locator('[data-action="compare"]').count(),0);
  await select(cancelled.id).check();assert.equal(await page.locator('[data-action="compare"]').count(),0);
  await page.getByRole('button',{name:'取消选择',exact:true}).click();
  await select(completed[0].id).check();await select(completed[1].id).check();assert.equal(await page.locator('[data-action="compare"]').count(),1);
  await select(completed[2].id).check();assert.equal(await page.locator('[data-select-version]:checked').count(),3);assert.equal(await page.locator('[data-action="compare"]').count(),0);
  await page.locator(`[data-action="version"][data-id="${completed[0].id}"]`).click();assert.equal(await page.locator('[data-select-version]:checked').count(),3);
  await page.locator(`[data-action="sound"][data-id="${other.id}"]`).click();await page.locator(`[data-action="sound"][data-id="${sound.id}"]`).click();assert.equal(await page.locator('[data-select-version]:checked').count(),0);
  await page.getByRole('button',{name:'全选',exact:true}).click();assert.equal(await page.locator('[data-select-version]:checked').count(),5);
  await mkdir('test-results/studio',{recursive:true});await page.screenshot({path:'test-results/studio/batch-delete-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:'test-results/studio/batch-delete-mobile.png',fullPage:true});
  const updateRoute='**/api/studio_update_version';
  await page.route(updateRoute,route=>route.request().postDataJSON().versionId===failed.id?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({message:'测试连接中断'})}):route.continue());
  await page.getByRole('button',{name:'删除所选（5）',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===3);
  await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('1 个版本删除失败'));
  assert.equal(service.speech.snapshot().versions.filter(v=>v.deleted).length,4);assert.equal(await select(failed.id).isChecked(),true);
  await page.unroute(updateRoute);await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===7);
  await page.getByRole('button',{name:'全选',exact:true}).click();
  await page.locator(`[data-action="version"][data-id="${completed[0].id}"]`).click();await page.waitForFunction(()=>!!document.querySelector('#version-audio')?.src);
  await page.evaluate(()=>{window.cleanupPlayer=document.querySelector('#version-audio');cleanupPlayer.loop=true;return cleanupPlayer.play();});
  await page.getByRole('button',{name:'删除所选（5）',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===2);
  assert.equal(await page.evaluate(()=>cleanupPlayer.paused),true);
  assert.equal(service.speech.snapshot().versions.filter(v=>v.deleted).length,5);assert.equal(service.speech.snapshot().sounds.find(s=>s.id===sound.id).finalVersionId,undefined);
  assert.equal(service.speech.job(running.id).state,'running');assert.equal(service.speech.job(queued.id).state,'queued');
  await page.getByRole('button',{name:'撤销',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===7);
  assert.equal(service.speech.job(completed[0].id).kept,true);assert.equal(service.speech.snapshot().sounds.find(s=>s.id===sound.id).finalVersionId,undefined);
  await service.call('studio_cancel',{versionId:queued.id});await service.call('studio_cancel',{versionId:running.id});
  await page.waitForFunction(()=>document.querySelectorAll('[data-select-version]:not([disabled])').length===7);
  await page.getByRole('button',{name:'全选',exact:true}).click();await page.getByRole('button',{name:'删除所选（7）',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===0);
  await page.reload();await openTrash(page);await page.waitForFunction(()=>document.querySelector('dialog')?.open&&document.querySelectorAll('.trash-row').length===7);assert.equal(await page.locator('.trash-row').count(),7);
  await page.locator(`[data-action="restore"][data-id="${failed.id}"]`).click();await page.waitForFunction(()=>document.querySelectorAll('.trash-row').length===6);await page.click('[data-action="close"]');
  assert.equal(await page.locator('.version-row').count(),1);assert.equal(await select(failed.id).isEnabled(),true);assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('day/night themes and the global voice library work without a project and preserve speech drafts',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-library-ui-'));
 const driver={installed:()=>true,prepare:async()=>{},cleanReference:async(_,req)=>writeFile(req.outputPath,wav),generate:async(_,req)=>writeFile(req.outputPath,wav)};
 const service=await MusicService.open(root,()=>{throw Error('unused');},p=>readFile(resolve('dist',p)),false,unused,driver,undefined,testResources());
 const http=await serveHttp(service,{read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false});
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000},colorScheme:'dark'}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(http.runtime.url);await page.locator('[data-action="voice-library"]').waitFor({timeout:5000});
  assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.getByRole('button',{name:'日间',exact:true}).click();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(244, 245, 241)');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--muted')),'#5f6a5d');assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).getPropertyValue('--line')),'#e3e7e0');
  await page.reload();await page.locator('[data-action="voice-library"]').waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'light');
  await page.getByRole('button',{name:'夜间',exact:true}).click();assert.equal(await page.evaluate(()=>getComputedStyle(document.documentElement).backgroundColor),'rgb(18, 22, 19)');
  await page.click('[data-action="voice-library"]');await page.getByRole('heading',{name:'音色库',exact:true}).waitFor();
  assert.match(await page.locator('#voice-list').innerText(),/还没有音色/);
  assert.equal(await page.locator('#workspace .voice-detail').count(),0);assert.equal(await page.locator('#dialog').isVisible(),false);
  await page.getByRole('button',{name:'新增音色',exact:true}).click();await page.fill('#voice-name','温暖旁白');await page.locator('#voice-cleanup').uncheck();assert.match(await page.locator('#voice-file').getAttribute('accept'),/\.m4a/);await page.locator('#voice-file').setInputFiles('tests/fixtures/reference.m4a');await page.click('[data-action="upload-voice"]');
  await page.locator('[data-action="select-voice"]').waitFor();await page.waitForFunction(()=>!!document.querySelector('#voice-preview audio')?.src);
  const first=service.speech.snapshot().voices[0];assert.equal(first.name,'温暖旁白');
  await page.locator('#voice-preview audio').evaluate(a=>{a.loop=true;return a.play();});await page.waitForTimeout(2000);assert.equal(await page.locator('#voice-preview audio').evaluate(a=>!a.paused),true);
  await page.click('[data-action="favorite-voice"]');await page.locator('[data-action="favorite-voice"][aria-pressed="true"]').waitFor();assert.equal(service.speech.snapshot().voices[0].favorite,true);
  const second=await service.call('tts_add_voice',{cleanup:false,name:'清晰播报',audioBase64:wav.toString('base64')});
  await page.waitForFunction(()=>document.querySelectorAll('[data-action="select-voice"]').length===2);
  await page.keyboard.press('Escape');assert.equal(await page.locator('#dialog').isVisible(),false);assert.equal(await page.locator('#voice-preview audio').evaluate(a=>a.paused),true);
  await page.fill('#voice-search','播报');assert.equal(await page.locator('[data-action="select-voice"]').count(),1);
  await page.click(`[data-action="select-voice"][data-id="${second.id}"]`);await page.waitForFunction(id=>document.querySelector('#voice-preview audio')?.dataset.voiceAudio===id,second.id);
  await page.click('[data-action="close"]');
  await page.fill('#voice-search','没有这个音色');assert.match(await page.locator('#voice-list').innerText(),/没有找到/);await page.fill('#voice-search','');
  await mkdir('test-results/studio',{recursive:true});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/studio/voice-library-dark-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'日间',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/studio/voice-library-light-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/studio/voice-library-light-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'夜间',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/studio/voice-library-dark-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.click(`[data-action="select-voice"][data-id="${second.id}"]`);await page.click('[data-action="clean-voice"]');await page.locator('#voice-preview').filter({hasText:'处理后人声'}).waitFor();assert.equal(await page.locator('#voice-preview audio').count(),2);assert.equal(service.speech.snapshot().voices.length,3);
  await page.reload();await page.getByRole('heading',{name:'音色库',exact:true}).waitFor();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
  await page.click('[data-action="new-project"]');await page.fill('#project-name','音色复用');await page.locator('#project-form button').click();await page.locator('[name="kind"][value="speech"]').check();await page.fill('#sound-title','旁白');await page.locator('#sound-form button').click();
  await page.fill('#creation-text','保留我的创作草稿');await page.click('[data-action="close"]');await page.click('[data-action="voice-library"]');await page.click(`[data-action="select-voice"][data-id="${second.id}"]`);await page.click('[data-action="use-voice"]');
  assert.equal(await page.inputValue('#voice'),second.id);assert.equal(await page.inputValue('#creation-text'),'保留我的创作草稿');await page.click('[data-action="close"]');
  await page.screenshot({path:'test-results/studio/workspace-dark-desktop.png',fullPage:true});await page.getByRole('button',{name:'日间',exact:true}).click();await page.screenshot({path:'test-results/studio/workspace-light-desktop.png',fullPage:true});
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});

test('five built-in dry voices are visible and playable in day and night themes without replacing library identities',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-presets-'));
 const read=p=>readFile(resolve('dist',p));
 const driver={installed:()=>true,prepare:async()=>{},generate:async()=>{},builtinVoices:()=>readBuiltinVoices(read)};
 const service=await MusicService.open(root,()=>{throw Error('unused');},read,false,unused,driver,undefined,testResources());
 const http=await serveHttp(service,{read,has:p=>existsSync(resolve('dist',p)),embedded:false});
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});
 try{
  await page.goto(http.runtime.url);await page.click('[data-action="voice-library"]');
  await page.waitForFunction(()=>document.querySelectorAll('.voice-card').length===5);
  assert.match(await page.locator('#voice-count').textContent(),/5 个内置/);
  for(const name of ['迪丽热巴','天津团团记','女网红','示例声音 · 官方样音','沈腾']){
   await page.getByRole('button',{name:new RegExp(name)}).click();
   await page.waitForFunction(()=>!!document.querySelector('#voice-preview audio')?.src);
   assert.equal(await page.locator('#library-voice-heading .eyebrow').textContent(),'内置音色');
   await page.locator('#voice-preview audio').evaluate(async a=>{await a.play();});
   assert.equal(await page.locator('#voice-preview audio').evaluate(a=>a.paused),false);
   await page.click('[data-action="close"]');
  }
  await page.click('[data-theme-choice="dark"]');
  assert.equal(await page.locator('.voice-card').count(),5);
  await page.reload();await page.locator('.voice-card').first().waitFor();
  assert.equal(await page.locator('.voice-card').count(),5);
  assert.equal(service.speech.snapshot().voices.filter(v=>v.builtinId).length,5);
  const response=await page.request.get(http.runtime.url+'/tts-presets/dilireba.wav');assert.equal(response.status(),401);
 }finally{await browser.close();await service.speech.close();await service.yue2.close();await service.jobs.close();await http.close();await service.store.close();await rm(root,{recursive:true,force:true});}
});

test('hierarchy trash, permanent deletion and historical voice labels work through the production UI',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'studio-hierarchy-ui-')),read=p=>readFile(resolve('dist',p));
 const driver={installed:()=>true,prepare:async()=>{},generate:async(_,r)=>writeFile(r.outputPath,wav)};
 const service=await MusicService.open(dir,()=>{throw Error('unused');},read,false,unused,driver,undefined,testResources()),http=await serveHttp(service,{read,has:p=>existsSync(resolve('dist',p)),embedded:false});
 const browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await service.call('create_project',{projectId:'film',title:'删除功能验收'});const sound=await service.call('studio_create_sound',{projectId:'film',title:'测试片段',kind:'speech'});await service.call('studio_create_sound',{projectId:'film',title:'保留片段',kind:'clip'});
  const a=await service.call('tts_add_voice',{cleanup:false,name:'最初音色',audioBase64:wav.toString('base64')}),b=await service.call('tts_add_voice',{cleanup:false,name:'第二音色',audioBase64:wav.toString('base64')});
  const versions=[];for(const voiceId of [a.id,b.id,a.id]){const v=await service.call('studio_generate',{soundId:sound.id,text:'同样的正文',voiceId,emotion:voiceId===a.id?'开心':'平静'});for(let i=0;i<100&&service.speech.job(v.id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,10));versions.push(v);}
  await service.call('studio_update_version',{versionId:versions[2].id,deleted:true});await service.call('studio_update_version',{versionId:versions[1].id,final:true});await service.call('tts_update_voice',{voiceId:a.id,name:'改名后的音色'});
  await page.goto(http.runtime.url);await page.locator('.version-row').first().waitFor();assert.match(await page.locator('.version-list').innerText(),/最初音色/);assert.match(await page.locator('.version-list').innerText(),/第二音色/);assert.match(await page.locator('.version-list').innerText(),/情绪：开心/);assert.doesNotMatch(await page.locator('.version-list').innerText(),/改名后的音色/);
  assert.equal(await page.locator('.project-actions .entity-menu').count(),1);
  await page.locator('[aria-label="项目与片段更多操作"]').click();await page.click('[data-action="rename-entity"][data-kind="project"]');await page.fill('#entity-name','重命名项目');await page.locator('#rename-form button').click();await page.waitForFunction(()=>document.querySelector('.project-header h1')?.textContent==='重命名项目');
  await page.locator('[aria-label="项目与片段更多操作"]').click();await page.click('[data-action="rename-entity"][data-kind="sound"]');await page.fill('#entity-name','改名片段');await page.locator('#rename-form button').click();await page.waitForFunction(()=>document.querySelector('.sound-tab.selected > span:last-child')?.textContent==='改名片段');
  await page.locator('[aria-label="项目与片段更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="sound"]');assert.match(await page.locator('dialog').innerText(),/3 个版本/);await page.click('[data-action="close"]');assert.equal(await page.locator('.sound-tab').count(),2);
  await page.locator('[aria-label="项目与片段更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="sound"]');await page.click('[data-action="confirm-delete"]');await page.waitForFunction(()=>document.querySelectorAll('.sound-tab').length===1);
  await openTrash(page);await page.locator(`[data-action="restore-entity"][data-id="${sound.id}"]`).click();await page.click('[data-action="close"]');await page.click(`[data-action="sound"][data-id="${sound.id}"]`);assert.equal(await page.locator('.version-row').count(),2);assert.match(await page.locator('[data-action="final"]').innerText(),/已选为成品/);
  await page.locator('[aria-label="项目与片段更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="project"]');assert.match(await page.locator('dialog').innerText(),/2 个片段/);await page.click('[data-action="confirm-delete"]');await page.waitForFunction(()=>document.querySelectorAll('.project-link').length===0);
  await openTrash(page);await page.locator('[data-action="restore-entity"][data-kind="project"]').click();await page.click('[data-action="close"]');await page.click(`[data-action="sound"][data-id="${sound.id}"]`);assert.equal(await page.locator('.version-row').count(),2);
  await page.click('[data-action="voice-library"]');await page.click(`[data-action="select-voice"][data-id="${a.id}"]`);await page.locator('[aria-label="音色更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="voice"]');await page.click('[data-action="confirm-delete"]');await page.waitForFunction(()=>document.querySelectorAll('.voice-card').length===1);
  await openTrash(page);await page.locator(`[data-action="purge-entity"][data-id="${a.id}"]`).click();assert.match(await page.locator('dialog').innerText(),/不可恢复/);await page.click('[data-action="close"]');await openTrash(page);await page.locator(`[data-action="restore-entity"][data-id="${a.id}"]`).click();await page.click('[data-action="close"]');assert.equal(await page.locator('.voice-card').count(),2);
  await page.click(`[data-action="select-voice"][data-id="${a.id}"]`);await page.locator('[aria-label="音色更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="voice"]');await page.click('[data-action="confirm-delete"]');await openTrash(page);await page.locator(`[data-action="purge-entity"][data-id="${a.id}"]`).click();await page.click('[data-action="confirm-purge"]');await page.click('[data-action="close"]');await page.reload();await page.locator('.voice-card').waitFor();assert.equal(await page.locator('.voice-card').count(),1);
  await page.click('[data-action="project"][data-id="film"]');await page.click(`[data-action="sound"][data-id="${sound.id}"]`);assert.match(await page.locator('.version-list').innerText(),/最初音色/);assert.deepEqual(service.speech.audio(versions[0].id),new Uint8Array(wav));
  await mkdir('test-results/studio',{recursive:true});for(const theme of ['light','dark']){await page.click(`[data-theme-choice="${theme}"]`);await page.screenshot({path:`test-results/studio/hierarchy-${theme}-desktop.png`,fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/studio/hierarchy-${theme}-mobile.png`,fullPage:true});await page.setViewportSize({width:1440,height:1000});}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(dir,{recursive:true,force:true});}
});

 test('settings owns trash, bulk purge is confirmed, partial failure is retryable and live work stays intact',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-trash-clear-')),read=p=>readFile(resolve('dist',p)),driver={installed:()=>true,prepare:async()=>{},generate:async(_,req)=>writeFile(req.outputPath,wav)};
 const service=await MusicService.open(root,()=>{throw Error('unused');},read,false,unused,driver,undefined,testResources()),http=await serveHttp(service,{read,has:p=>existsSync(resolve('dist',p)),embedded:false}),browser=await chromium.launch({channel:'chrome',headless:true}),page=await browser.newPage({viewport:{width:1440,height:1000}});let rejectOne=true,calls=0;
 try{
 await service.call('create_project',{projectId:'live',title:'保留项目'});await service.call('create_project',{projectId:'dead',title:'待清空项目'});
 const voice=await service.call('tts_add_voice',{name:'待清空音色',cleanup:false,audioBase64:wav.toString('base64')});let deadVersion,liveVersion;
 for(const id of ['live','dead']){const sound=await service.call('studio_create_sound',{projectId:id,title:id,kind:'speech'}),v=await service.call('studio_generate',{soundId:sound.id,text:id,voiceId:voice.id});for(let i=0;i<100&&service.speech.job(v.id).state!=='succeeded';i++)await new Promise(r=>setTimeout(r,20));assert.equal(service.speech.job(v.id).state,'succeeded');if(id==='dead')deadVersion=v;else liveVersion=v;}
 await service.call('studio_update_project',{projectId:'dead',deleted:true});await service.call('tts_update_voice',{voiceId:voice.id,deleted:true});
 await page.route('**/api/studio_purge',async route=>{calls++;if(rejectOne&&route.request().postDataJSON().id==='dead')await route.fulfill({status:400,json:{message:'测试删除失败'}});else await route.continue();});
 await page.goto(http.runtime.url);assert.equal(await page.locator('.sidebar-bottom button').count(),1);assert.equal(await page.locator('.sidebar [data-action="trash"]').count(),0);assert.equal(await page.locator('.sidebar [data-theme-choice]').count(),0);
 const theme=await page.locator('.studio-topbar .theme-switch').boundingBox();assert.ok(theme.x>720&&theme.height<44);await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.setViewportSize({width:1440,height:1000});
 await page.click('[data-action="settings"]');await page.locator('.settings-theme [data-theme-choice="dark"]').click();assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');await mkdir('test-results/studio',{recursive:true});for(const width of [1440,390]){await page.setViewportSize({width,height:1000});const group=await page.locator('.settings-theme').boundingBox(),closeButton=await page.locator('.dialog-heading [data-action="close"]').boundingBox();assert.ok(group.x>=0&&group.x+group.width<=closeButton.x&&closeButton.x+closeButton.width<=width);await page.screenshot({path:`test-results/studio/settings-${width}.png`});}await page.setViewportSize({width:1440,height:1000});await page.click('[data-action="close"]');await openTrash(page);assert.equal(await page.locator('.trash-row').count(),2);await page.click('[data-action="clear-trash"]');assert.match(await page.locator('dialog').innerText(),/不可恢复/);await page.click('[data-action="close"]');assert.equal(calls,0);
 await openTrash(page);await page.click('[data-action="clear-trash"]');await page.click('[data-action="confirm-clear-trash"]');await page.locator('#toast').filter({hasText:'测试删除失败'}).waitFor();assert.equal(await page.locator('.trash-row').count(),1);assert.ok((await service.call('studio_library',{})).versions.some(v=>v.id===liveVersion.id));assert.deepEqual(service.speech.audio(liveVersion.id),new Uint8Array(wav));
 rejectOne=false;await page.click('[data-action="clear-trash"]');await page.click('[data-action="confirm-clear-trash"]');await page.locator('dialog').filter({hasText:'回收站是空的'}).waitFor();assert.equal(await page.locator('[data-action="clear-trash"]').isDisabled(),true);assert.ok(!(await service.call('studio_library',{})).versions.some(v=>v.id===deadVersion.id));await assert.rejects(readFile(join(root,'speech/audio',deadVersion.id+'.wav')),{code:'ENOENT'});
 await page.click('[data-action="close"]');await page.reload();await openTrash(page);assert.equal(await page.locator('.trash-row').count(),0);
 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
