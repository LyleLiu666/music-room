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
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
test('unified production UI: mixed project, real routes, versions, playback, drafts, comparison, trash, MIDI and responsive hierarchy',async()=>{
 const root=await mkdtemp(join(tmpdir(),'studio-ui-'));const driver={installed:()=>true,prepare:async()=>{},cleanReference:async(_,req)=>{await writeFile(req.outputPath,wav);},generate:async(_,req,ctx)=>{await new Promise((resolve,reject)=>{const timer=setTimeout(resolve,2300);ctx.signal.addEventListener('abort',()=>{clearTimeout(timer);reject(Error('cancelled'));},{once:true});});await writeFile(req.outputPath,wav);}};
 const renderer=({composition})=>{const pcm=Float32Array.from({length:Math.round(composition.score.duration*44100)},(_,i)=>Math.sin(i*.1)*.2);return {result:Promise.resolve({wav:new Uint8Array(encodeWav([pcm,pcm],44100)),peak:.2,rms:.1,attenuation:1,engine:'test-pcm'}),cancel:()=>{}};};
 const service=await MusicService.open(root,renderer,p=>readFile(resolve('dist',p)),false,unused,driver,undefined,testResources()),http=await serveHttp(service,{read:p=>readFile(resolve('dist',p)),has:p=>existsSync(resolve('dist',p)),embedded:false});
 const musicJobs=[];service.yue2.status=async()=>({phase:'running',canGenerate:true,installed:true,modelsReady:true,message:'就绪',logs:[],autoStart:true,defaultDirectory:'/tmp/unused'});
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
  const download=page.waitForEvent('download');await page.locator('[data-action="download"]').click();assert.match((await download).suggestedFilename(),/开场旁白-V\d.wav/);
  await page.click('[data-action="new-sound"]');await page.locator('[name="kind"][value="clip"]').check();await page.fill('#sound-title','钢琴片头');await page.locator('#sound-form button').click();await page.fill('#creation-text','清晨，轻快的钢琴短句');await page.click('#generate');await page.locator('#version-audio').waitFor();await page.waitForFunction(()=>!!document.querySelector('#version-audio')?.src);assert.equal(await page.locator('.sound-tab').count(),2);assert.equal((await service.call('studio_library',{})).projects.length,1);
  await page.click('[data-action="tools"]');await page.click('[data-action="import"]');const example=await readFile('src/music/authoring/example.json');await page.locator('#score-file').setInputFiles({name:'score.json',mimeType:'application/json',buffer:example});await page.waitForFunction(()=>document.querySelectorAll('.version-row').length===2);
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
  await page.reload();await page.getByRole('button',{name:'回收站',exact:true}).click();await page.waitForFunction(()=>document.querySelector('dialog')?.open&&document.querySelectorAll('.trash-row').length===7);assert.equal(await page.locator('.trash-row').count(),7);
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
  await page.locator('.reference-upload summary').click();await page.fill('#voice-name','温暖旁白');await page.locator('#voice-cleanup').uncheck();await page.locator('#voice-file').setInputFiles({name:'voice.wav',mimeType:'audio/wav',buffer:wav});await page.click('[data-action="upload-voice"]');
  await page.locator('[data-action="select-voice"]').waitFor();await page.waitForFunction(()=>!!document.querySelector('#voice-preview audio')?.src);
  const first=service.speech.snapshot().voices[0];assert.equal(first.name,'温暖旁白');
  await page.locator('#voice-preview audio').evaluate(a=>{a.loop=true;return a.play();});await page.waitForTimeout(2000);assert.equal(await page.locator('#voice-preview audio').evaluate(a=>!a.paused),true);
  await page.click('[data-action="favorite-voice"]');await page.locator('[data-action="favorite-voice"][aria-pressed="true"]').waitFor();assert.equal(service.speech.snapshot().voices[0].favorite,true);
  const second=await service.call('tts_add_voice',{cleanup:false,name:'清晰播报',audioBase64:wav.toString('base64')});
  await page.waitForFunction(()=>document.querySelectorAll('[data-action="select-voice"]').length===2);
  await page.fill('#voice-search','播报');assert.equal(await page.locator('[data-action="select-voice"]').count(),1);
  await page.click(`[data-action="select-voice"][data-id="${second.id}"]`);await page.waitForFunction(id=>document.querySelector('#voice-preview audio')?.dataset.voiceAudio===id,second.id);
  await page.fill('#voice-search','没有这个音色');assert.match(await page.locator('#voice-list').innerText(),/没有找到/);await page.fill('#voice-search','');
  await mkdir('test-results/studio',{recursive:true});await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/studio/voice-library-dark-desktop.png',fullPage:true});
  await page.getByRole('button',{name:'日间',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/studio/voice-library-light-desktop.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/studio/voice-library-light-mobile.png',fullPage:true});
  await page.getByRole('button',{name:'夜间',exact:true}).click();await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await page.screenshot({path:'test-results/studio/voice-library-dark-mobile.png',fullPage:true});await page.setViewportSize({width:1440,height:1000});
  await page.click('[data-action="clean-voice"]');await page.locator('#voice-preview').filter({hasText:'处理后人声'}).waitFor();assert.equal(await page.locator('#voice-preview audio').count(),2);assert.equal(service.speech.snapshot().voices.length,3);
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
  await page.locator('[aria-label="项目更多操作"]').click();await page.click('[data-action="rename-entity"][data-kind="project"]');await page.fill('#entity-name','重命名项目');await page.locator('#rename-form button').click();await page.waitForFunction(()=>document.querySelector('.project-header h1')?.textContent==='重命名项目');
  await page.locator('[aria-label="片段更多操作"]').click();await page.click('[data-action="rename-entity"][data-kind="sound"]');await page.fill('#entity-name','改名片段');await page.locator('#rename-form button').click();await page.waitForFunction(()=>document.querySelector('.sound-tab.selected > span:last-child')?.textContent==='改名片段');
  await page.locator('[aria-label="片段更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="sound"]');assert.match(await page.locator('dialog').innerText(),/3 个版本/);await page.click('[data-action="close"]');assert.equal(await page.locator('.sound-tab').count(),2);
  await page.locator('[aria-label="片段更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="sound"]');await page.click('[data-action="confirm-delete"]');await page.waitForFunction(()=>document.querySelectorAll('.sound-tab').length===1);
  await page.click('[data-action="trash"]');await page.locator(`[data-action="restore-entity"][data-id="${sound.id}"]`).click();await page.click('[data-action="close"]');await page.click(`[data-action="sound"][data-id="${sound.id}"]`);assert.equal(await page.locator('.version-row').count(),2);assert.match(await page.locator('[data-action="final"]').innerText(),/已选为成品/);
  await page.locator('[aria-label="项目更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="project"]');assert.match(await page.locator('dialog').innerText(),/2 个片段/);await page.click('[data-action="confirm-delete"]');await page.waitForFunction(()=>document.querySelectorAll('.project-link').length===0);
  await page.click('[data-action="trash"]');await page.locator('[data-action="restore-entity"][data-kind="project"]').click();await page.click('[data-action="close"]');await page.click(`[data-action="sound"][data-id="${sound.id}"]`);assert.equal(await page.locator('.version-row').count(),2);
  await page.click('[data-action="voice-library"]');await page.click(`[data-action="select-voice"][data-id="${a.id}"]`);await page.locator('[aria-label="音色更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="voice"]');await page.click('[data-action="confirm-delete"]');await page.waitForFunction(()=>document.querySelectorAll('.voice-card').length===1);
  await page.click('[data-action="trash"]');await page.locator(`[data-action="purge-entity"][data-id="${a.id}"]`).click();assert.match(await page.locator('dialog').innerText(),/不可恢复/);await page.click('[data-action="close"]');await page.click('[data-action="trash"]');await page.locator(`[data-action="restore-entity"][data-id="${a.id}"]`).click();await page.click('[data-action="close"]');assert.equal(await page.locator('.voice-card').count(),2);
  await page.click(`[data-action="select-voice"][data-id="${a.id}"]`);await page.locator('[aria-label="音色更多操作"]').click();await page.click('[data-action="delete-entity"][data-kind="voice"]');await page.click('[data-action="confirm-delete"]');await page.click('[data-action="trash"]');await page.locator(`[data-action="purge-entity"][data-id="${a.id}"]`).click();await page.click('[data-action="confirm-purge"]');await page.click('[data-action="close"]');await page.reload();await page.locator('.voice-card').waitFor();assert.equal(await page.locator('.voice-card').count(),1);
  await page.click('[data-action="project"][data-id="film"]');await page.click(`[data-action="sound"][data-id="${sound.id}"]`);assert.match(await page.locator('.version-list').innerText(),/最初音色/);assert.deepEqual(service.speech.audio(versions[0].id),new Uint8Array(wav));
  await mkdir('test-results/studio',{recursive:true});for(const theme of ['light','dark']){await page.click(`[data-theme-choice="${theme}"]`);await page.screenshot({path:`test-results/studio/hierarchy-${theme}-desktop.png`,fullPage:true});await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:`test-results/studio/hierarchy-${theme}-mobile.png`,fullPage:true});await page.setViewportSize({width:1440,height:1000});}
  assert.deepEqual(errors,[]);
 }finally{await browser.close();await http.close();await service.close();await rm(dir,{recursive:true,force:true});}
});
