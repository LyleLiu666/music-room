import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {chromium} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {serveHttp} from '../src/server/http.ts';
import {testResources} from '../src/service/resources/testing.ts';
import {encodeWav} from '../src/wav.ts';
test('production player displays persisted lyrics, follows seeks, keeps background playback and exports authenticated LRC',async()=>{
 const root=await mkdtemp(join(tmpdir(),'lyrics-ui-'));const read=p=>readFile(resolve('dist',p));
 const versions=[1,2].map(number=>({id:'lyric-v'+number,soundId:'lyric-sound',number,createdAt:'2026-10-12T00:00:00Z',state:'succeeded',stage:'完成',kept:false,deleted:false,source:{kind:'audio',id:'lyric-v'+number},input:{soundId:'lyric-sound',text:'歌词测试',lyrics:'参考词'},audioPath:'/studio-audio/lyric-v'+number,duration:12}));
 await writeFile(join(root,'studio.json'),JSON.stringify({format:'music-room-studio',version:1,sounds:[{id:'lyric-sound',projectId:'lyrics',title:'歌词测试',kind:'music',createdAt:'2026-10-12T00:00:00Z'}],versions}));
 await mkdir(join(root,'studio-audio'));const wav=Buffer.from(encodeWav([new Float32Array(22050*12)],22050));for(const v of versions){await writeFile(join(root,'studio-audio',v.id+'.wav'),wav);v.audioHash=createHash('sha256').update(wav).digest('hex');}
 await writeFile(join(root,'studio.json'),JSON.stringify({format:'music-room-studio',version:1,sounds:[{id:'lyric-sound',projectId:'lyrics',title:'歌词测试',kind:'music',createdAt:'2026-10-12T00:00:00Z'}],versions}));
 await mkdir(join(root,'lyrics'));const lines=[{text:'第一句',start:1,end:3},{text:'重复句',start:4,end:6},{text:'重复句',start:8,end:10}];await writeFile(join(root,'lyrics','lyric-v2.json'),JSON.stringify({format:'music-room-lyrics',version:1,versionId:'lyric-v2',audioPath:versions[1].audioPath,audioSha256:versions[1].audioHash,duration:12,draft:true,lines}));
 const service=await MusicService.open(root,()=>{throw Error('unused');},read,false,undefined,undefined,undefined,testResources());await service.call('create_project',{projectId:'lyrics',title:'歌词回归'});
 const http=await serveHttp(service,{read,has:p=>existsSync(resolve('dist',p)),embedded:false}),browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']}),page=await browser.newPage({viewport:{width:1280,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
 const url=http.runtime.url+'/api/studio-lyrics?versionId=lyric-v2',headers={authorization:'Bearer '+http.runtime.token};assert.equal((await fetch(url)).status,401);assert.equal((await fetch(url,{headers,method:'POST'})).status,405);assert.equal((await(await fetch(url,{headers})).json()).lines.length,3);
 await page.goto(http.runtime.url);await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=1);await page.locator('#workspace .lyric-line').first().waitFor();assert.equal(await page.locator('#workspace .lyric-line').count(),3);
 await page.locator('#version-audio').evaluate(a=>{window.retainedAudio=a;a.currentTime=4.5;a.dispatchEvent(new Event('timeupdate'));});assert.equal(await page.locator('.current-lyric').textContent(),'重复句');
 await page.locator('#version-audio').evaluate(a=>{a.currentTime=7;a.dispatchEvent(new Event('timeupdate'));});assert.equal(await page.locator('.current-lyric').count(),0);
 await page.getByRole('button',{name:'收起歌词',exact:true}).click();assert.equal(await page.locator('.lyrics-scroll').isVisible(),false);await page.getByRole('button',{name:'显示歌词',exact:true}).click();
 await page.locator('.lyric-line').last().click();assert.equal(await page.locator('#version-audio').evaluate(a=>a.currentTime),8);await page.locator('.lyrics-scroll').dispatchEvent('wheel');await page.getByRole('button',{name:'恢复跟随',exact:true}).click();
 const promise=page.waitForEvent('download');await page.getByRole('button',{name:'下载 LRC',exact:true}).click();assert.equal(await readFile(await(await promise).path(),'utf8'),'[00:01.00]第一句\n[00:04.00]重复句\n[00:08.00]重复句\n');
 await page.locator('#version-audio').evaluate(a=>{a.currentTime=1;return a.play();});await page.locator('[data-select-version]').first().check();assert.equal(await page.evaluate(()=>retainedAudio===document.querySelector('#version-audio')&&!retainedAudio.paused),true);
 await page.locator('[data-action="version"][data-id="lyric-v1"]').click();await page.waitForFunction(()=>document.querySelector('#version-audio')?.dataset.version==='lyric-v1');await page.locator('#workspace .player-lyrics').getByText('参考歌词 · 暂无同步时间').waitFor();assert.equal(await page.locator('#workspace .lyric-line').count(),0);assert.equal(await page.evaluate(()=>retainedAudio.isConnected&&!retainedAudio.paused),true);
 await page.locator('#global-status-bar [data-action="return-playback"]').click();await page.waitForFunction(()=>document.querySelector('#version-audio')===retainedAudio);assert.equal(await page.locator('#workspace .lyric-line').count(),3);
 await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await mkdir('test-results/lyrics-integration',{recursive:true});await page.screenshot({path:'test-results/lyrics-integration/mobile.png',fullPage:true});assert.deepEqual(errors,[]);
 await service.call('studio_update_version',{versionId:'lyric-v2',deleted:true});assert.notEqual((await fetch(url,{headers})).status,200);await service.call('studio_update_version',{versionId:'lyric-v2',deleted:false});assert.equal((await fetch(url,{headers})).status,200);await service.call('studio_update_version',{versionId:'lyric-v2',deleted:true});await service.studio.purge({kind:'version',id:'lyric-v2'});assert.equal(existsSync(join(root,'lyrics','lyric-v2.json')),false);

 }finally{await browser.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});}
});
