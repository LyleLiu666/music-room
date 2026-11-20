// Native Safari compatibility against an isolated service with saved real audio.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createServer} from 'node:net';
const workspace=resolve(process.env.MUSIC_ROOM_SYSTEM_WORKSPACE??'test-results/system-ui/workspace');
assert.ok(workspace.startsWith(resolve('test-results')+'/'),'only disposable acceptance workspaces');
const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));
const out=resolve('test-results/safari-native');await mkdir(out,{recursive:true});
const report={startedAt:new Date().toISOString(),status:'running',browser:'native Safari',checks:[],scope:'saved real audio, keyboard modal, persisted draft, playback and responsive layout; native download outside this script'};
const port=await new Promise((yes,no)=>{const server=createServer();server.once('error',no);server.listen(0,'127.0.0.1',()=>{const port=server.address().port;server.close(()=>yes(port));});});
const driver=spawn('/usr/bin/safaridriver',['--port',String(port)],{stdio:['ignore','pipe','pipe']});let session,driverLog='';
for(const stream of [driver.stdout,driver.stderr])stream.on('data',chunk=>{driverLog+=chunk;});
async function command(path,body,method=body===undefined?'GET':'POST'){
 const response=await fetch(`http://127.0.0.1:${port}${path}`,{method,headers:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(path==='/session'?120000:20000)});
 const data=await response.json();if(!response.ok)throw Error(path+': '+JSON.stringify(data));return data.value;
}
const cmd=(path,body,method)=>command('/session/'+session+path,body,method);
const execute=(script,args=[])=>cmd('/execute/sync',{script,args});
const element=async selector=>(await cmd('/element',{using:'css selector',value:selector}))['element-6066-11e4-a52e-4f735466cecf'];
async function withElement(selector,action){
 for(let n=0;n<3;n++){try{return await action(await element(selector));}catch(error){if(n===2||!String(error).includes('stale element reference'))throw error;report.staleReferences=(report.staleReferences??0)+1;}}
}
const click=async selector=>withElement(selector,id=>cmd('/element/'+id+'/click',{}));
const keys=async text=>cmd('/actions',{actions:[{type:'key',id:'keyboard',actions:[...text].flatMap(value=>[{type:'keyDown',value},{type:'keyUp',value}])}]}).then(()=>cmd('/actions',undefined,'DELETE'));
const wait=async(script,message)=>{for(let n=0;n<100;n++){if(await execute(script))return;await new Promise(r=>setTimeout(r,100));}throw Error(message);};
const screenshot=async name=>writeFile(join(out,name+'.png'),Buffer.from(await cmd('/screenshot'),'base64'));
const settleFrames=()=>cmd('/execute/async',{script:'const done=arguments[arguments.length-1]; requestAnimationFrame(()=>requestAnimationFrame(()=>done(true)));',args:[]});
try{
 for(let n=0;n<100;n++){try{await command('/status');break;}catch(error){if(driver.exitCode!==null||n===99)throw error;await new Promise(r=>setTimeout(r,50));}}
 const started=await command('/session',{capabilities:{alwaysMatch:{browserName:'safari',platformName:'macOS'}}});session=started.sessionId;report.capabilities=started.capabilities;
 const libraryResponse=await fetch(runtime.url+'/api/studio_library',{method:'POST',headers:{authorization:'Bearer '+runtime.token,'content-type':'application/json'},body:'{}'});assert.equal(libraryResponse.status,200);
 const library=await libraryResponse.json(),version=library.versions.find(v=>v.source.kind==='speech'&&v.state==='succeeded');assert.ok(version,'saved real speech required');const sound=library.sounds.find(s=>s.id===version.soundId);assert.ok(sound);
 await cmd('/window/rect',{width:1280,height:900});await cmd('/url',{url:runtime.url});
 await wait("return !!document.querySelector('[data-action=project]')",'projects unavailable');
 await click(`[data-action="project"][data-id="${sound.projectId}"]`);
 await wait(`return !!document.querySelector('[data-action="sound"][data-id="${sound.id}"]')`,'saved sound unavailable');await click(`[data-action="sound"][data-id="${sound.id}"]`);
 await wait("return !!document.querySelector('#version-audio')",'saved real audio was not shown');
 await execute("document.querySelector('[data-action=compose]').focus(); return true");await keys('\uE007');await wait("return document.querySelector('#dialog').open",'keyboard compose did not open');
 assert.ok(await execute("return document.querySelector('#dialog').getAttribute('aria-labelledby')"));
 for(let n=0;n<12;n++){await keys('\uE004');assert.equal(await execute("return document.activeElement===document.body||document.querySelector('#dialog').contains(document.activeElement)"),true);}
 const text='Safari 原生兼容草稿 🌧️';await withElement('#creation-text',id=>cmd('/element/'+id+'/clear',{}));await withElement('#creation-text',id=>cmd('/element/'+id+'/value',{text}));
 await wait("return document.querySelector('#draft-save-status')?.textContent.includes('草稿已保存')",'draft was not saved');
 await keys('\uE00C');await wait("return !document.querySelector('#dialog').open",'Escape did not close dialog');
 assert.equal(await execute("return document.activeElement?.dataset.action"),'compose');report.checks.push('native keyboard Tab excludes background controls; Escape returns focus to compose');
 await cmd('/refresh',{});await wait("return !!document.querySelector('[data-action=compose]')",'reload failed');await click('[data-action="compose"]');
 await wait("return document.querySelector('#dialog')?.open&&!!document.querySelector('#creation-text')",'compose did not open after reload');
 assert.equal(await execute("return document.querySelector('#creation-text').value"),text);report.checks.push('Unicode draft survives native Safari reload');
 await keys('\uE00C');await wait("return document.querySelector('#version-audio')?.readyState>=1",'WAV metadata unavailable');
 await click('#version-audio');await execute("document.querySelector('#version-audio').play(); return true");
 await wait("return document.querySelector('#version-audio').currentTime>.1",'native Safari WAV playback did not advance');
 report.audio=await execute("const a=document.querySelector('#version-audio'); a.pause(); return {duration:a.duration,readyState:a.readyState,currentTime:a.currentTime}");assert.ok(report.audio.duration>1);report.checks.push('saved real WAV decodes and plays in native Safari');await screenshot('desktop');
 await cmd('/window/rect',{width:720,height:456});await click('[data-action="settings"]');await wait("return document.querySelector('#dialog').open",'short viewport settings inaccessible');await keys('\uE00C');report.checks.push('Settings remains clickable in a short native Safari window');
 await cmd('/window/rect',{width:390,height:844});await execute('window.scrollTo(0,0); return true');await settleFrames();
 report.viewport=await execute('const sidebar=document.querySelector(".sidebar").getBoundingClientRect(),main=document.querySelector("#workspace").getBoundingClientRect(); return {innerWidth,outerWidth,scrollWidth:document.documentElement.scrollWidth,sidebarBottom:sidebar.bottom,mainLeft:main.left,mainTop:main.top}');
 assert.ok(report.viewport.scrollWidth<=report.viewport.innerWidth);if(report.viewport.innerWidth<=650){assert.ok(report.viewport.mainLeft<24);assert.ok(report.viewport.mainTop>=report.viewport.sidebarBottom);}
 await screenshot('narrow');report.checks.push('native Safari narrow layout stacks the sidebar above the workspace without horizontal overflow');
 report.status='passed';
}catch(error){report.status=String(error).includes('Allow remote automation')?'blocked':'failed';report.error=String(error);process.exitCode=1;
 if(session){report.failureState=await execute("return {title:document.title,heading:document.querySelector('main h1')?.textContent,active:document.activeElement?.outerHTML?.slice(0,500),buttons:[...document.querySelectorAll('[data-action=project],[data-action=sound]')].map(e=>({action:e.dataset.action,id:e.dataset.id,text:e.textContent}))}").catch(String);await screenshot('failure').catch(()=>{});}
}
finally{
 if(session)await cmd('',undefined,'DELETE').catch(error=>{report.cleanupError=String(error);process.exitCode=1;});
 if(driver.exitCode===null){const exited=new Promise(r=>driver.once('close',r));driver.kill('SIGTERM');await exited;}
 report.finishedAt=new Date().toISOString();report.driverLog=driverLog;await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
