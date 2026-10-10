import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {chromium} from 'playwright';
import {mkdtemp,copyFile,chmod,mkdir,readFile,writeFile,rm,rename,stat,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync,spawn} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {presetVoices} from '../src/service/tts/preset-manifest.ts';
import {nativeProgramManifest} from '../src/service/tts/native-program-manifest.ts';
const root=await mkdtemp(join(tmpdir(),'music-binary-')),binary=join(root,'music-room'),workspace=join(root,'workspace');
const out=resolve('test-results/binary');await mkdir(out,{recursive:true});await copyFile('release/music-room',binary);await chmod(binary,0o755);await copyFile('release/start.sh',join(root,'start.sh'));await chmod(join(root,'start.sh'),0o755);
const example=JSON.parse(await readFile('src/music/authoring/example.json','utf8'));
const held=resolve('build/verify-held-dist');await rename('dist',held); // prove it cannot rely on loose web/sound files
const env={...process.env,PATH:'/usr/bin:/bin'};let client,httpClient,browser;
const results=[];
try {
  assert.match(execFileSync(binary,['--help'],{cwd:root,env,encoding:'utf8'}),/stdio MCP/);results.push('copied executable runs without Node/Bun in PATH');
  const connect=async()=> {const transport=new StdioClientTransport({command:binary,args:['mcp','--workspace',workspace],cwd:root,env,stderr:'pipe'});const client=new Client({name:'binary-agent',version:'1'});await client.connect(transport);return client;};
  client=await connect();
  const tool=async(name,args={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse(r.content[0].text);};
  const status=await tool('status');assert.equal(status.workspace,await realpath(workspace));assert.equal(status.engines.find(e=>e.id==='yue2').available,false);
  assert.equal((await tool('yue2_status')).phase,'uninstalled');assert.ok((await client.listTools()).tools.some(t=>t.name==='yue2_generate'));
  const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));assert.equal(runtime.command,await realpath(binary));
  const speech=await tool('tts_library');
  assert.equal(speech.voices.filter(v=>v.builtinId).length,5);
  for(const voice of speech.voices.filter(v=>v.builtinId)){
    const reference=await fetch(runtime.url+`/speech/voice-audio/${voice.id}`,{headers:{authorization:`Bearer ${runtime.token}`}});
    assert.equal(reference.status,200);assert.equal(createHash('sha256').update(new Uint8Array(await reference.arrayBuffer())).digest('hex'),voice.sha256);
    const preset=presetVoices.find(p=>p.id===voice.builtinId);assert.ok(preset);assert.equal(voice.sha256,preset.audioSha256);
    const features=await fetch(runtime.url+`/tts-presets/${voice.builtinId}.npz`,{headers:{authorization:`Bearer ${runtime.token}`}});assert.equal(features.status,200);assert.equal(createHash('sha256').update(new Uint8Array(await features.arrayBuffer())).digest('hex'),preset.featuresSha256);
  }
  assert.equal((await fetch(runtime.url+'/tts-presets/official.npz')).status,401);
  const encoded=await fetch(runtime.url+'/tts-presets/official.npz',{headers:{authorization:`Bearer ${runtime.token}`}});assert.equal(encoded.status,200);assert.ok((await encoded.arrayBuffer()).byteLength>1000);
  results.push('five dry built-in voices and protected conditioning archives are embedded without loose files');
  const nativePackage=await fetch(runtime.url+'/'+nativeProgramManifest.asset,{headers:{authorization:`Bearer ${runtime.token}`}});
  assert.equal(nativePackage.status,200);
  const nativeBytes=new Uint8Array(await nativePackage.arrayBuffer());
  assert.equal(nativeBytes.byteLength,nativeProgramManifest.archiveBytes);
  assert.equal(createHash('sha256').update(nativeBytes).digest('hex'),nativeProgramManifest.archiveSha256);
  results.push('patched native TTS package is embedded and matches the pinned archive SHA-256');
  const requirements=await fetch(runtime.url+'/yue2-runtime/requirements.txt');assert.equal(requirements.status,200);assert.ok((await requirements.text()).includes('MUSIC_ROOM_MLX_YUE_ARCHIVE'));results.push('YuE2 contracts and hash-locked installer requirements are embedded');
  const managed=join(root,'模型 程序 测试');await mkdir(join(managed,'bin'),{recursive:true});await writeFile(join(managed,'.music-room-yue2.lock'),JSON.stringify({pid:process.pid,owner:'binary-lease'}));await writeFile(join(managed,'bin','uv'),'#!/bin/sh\nsleep 60 &\nprintf "%s" "$!" > child.pid\nwait\n');await chmod(join(managed,'bin','uv'),0o755);
  const supervisor=spawn(binary,['yue2-worker'],{cwd:root,env,stdio:['pipe','pipe','pipe']});let diagnostics='';supervisor.stderr.on('data',chunk=>diagnostics+=chunk);const supervised=new Promise(r=>supervisor.once('close',r));
  try{supervisor.stdin.write(JSON.stringify({directory:managed,owner:'binary-lease',step:'venv'})+'\n');for(let i=0;!existsSync(join(managed,'child.pid'))&&i<300;i++)await new Promise(r=>setTimeout(r,20));assert.ok(existsSync(join(managed,'child.pid')),diagnostics);const pid=Number(await readFile(join(managed,'child.pid'),'utf8'));supervisor.stdin.end();await supervised;let dead=false;for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{dead=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(dead,'compiled worker must stop owned process tree on parent EOF');}finally{supervisor.stdin.end();await supervised;}results.push('compiled YuE2 supervisor stops its fixture process tree on parent EOF (not inference)');
  assert.equal(JSON.parse(execFileSync(join(root,'start.sh'),['--workspace',workspace],{cwd:root,env,encoding:'utf8'})).reused,true);results.push('plain shell launcher reuses service without an App');
  const ctx=await tool('get_authoring_context',{stage:'eight'});assert.equal(ctx.example.score.bars.length,8);assert.ok(ctx.guide.includes('music-room-score'));results.push('stdio MCP tools, authoring resource, actual embedded example');
  await tool('create_project',{projectId:example.work.id,title:example.work.title,requirements:'先听 8 小节，再扩写'});
  await tool('validate_score',{compositionJson:JSON.stringify(example)});await tool('import_revision',{compositionJson:JSON.stringify(example)});
  const long=structuredClone(example);long.revision={...long.revision,id:'window-study-v2',label:'16 小节扩写验证'};long.score.duration*=2;long.score.bars.push(...structuredClone(long.score.bars));long.score.sections[0].bars*=2;long.score.notes.push(...structuredClone(long.score.notes).map(n=>({...n,beat:n.beat+32})));
  await tool('import_revision',{compositionJson:JSON.stringify(long),parentId:example.revision.id});
  assert.equal((await tool('get_revision',{projectId:example.work.id,revisionId:long.revision.id})).metadata.parentId,example.revision.id);results.push('MCP creates project and parent/child 8→16 bar versions');
  const render=await tool('render_revision',{projectId:example.work.id,revisionId:long.revision.id,idempotencyKey:'binary-render'});
  let done;for(let i=0;i<200;i++){done=await tool('get_job',{jobId:render.id});if(!['queued','running'].includes(done.state))break;await new Promise(r=>setTimeout(r,30));}
  assert.equal(done.state,'succeeded',done.error??'');const wav=await readFile(join(workspace,'projects',example.work.id,done.artifact.path));
  assert.equal(wav.length,44+40*44100*4);assert.equal(createHash('sha256').update(wav).digest('hex'),done.artifact.sha256);results.push('standalone backend worker uses embedded samples; real 40 second WAV/hash');
  const source=(await tool('studio_library')).versions.find(v=>v.source.kind==='score'&&v.source.id===long.revision.id);
  const speed=await tool('studio_save_speed',{versionId:source.id,rate:.8,requestId:'binary-speed'});
  assert.ok(Math.abs(speed.duration-50)<.002);assert.equal(speed.source.kind,'audio');
  const speedResponse=await fetch(runtime.url+speed.audioPath,{headers:{authorization:`Bearer ${runtime.token}`}});
  assert.equal(speedResponse.status,200);const speedBytes=new Uint8Array(await speedResponse.arrayBuffer());
  assert.equal(speedBytes.length,44+50*44100*4);
  results.push('standalone pitch-preserving speed save produces an independent 50 second WAV from a 40 second score');
  await tool('add_feedback',{projectId:example.work.id,revisionId:long.revision.id,text:'主题保留，下一版加一点变化。'});
  httpClient=new Client({name:'binary-http-agent',version:'1'});await httpClient.connect(new StreamableHTTPClientTransport(new URL(runtime.url+'/mcp'),{requestInit:{headers:{authorization:`Bearer ${runtime.token}`}}}));
  assert.ok((await httpClient.listTools()).tools.some(t=>t.name==='render_revision'));results.push('embedded HTTP MCP interoperates with official client');
  assert.equal((await fetch(runtime.url+'/api/status',{method:'POST'})).status,401);
  assert.equal((await fetch(runtime.url+'/api/status',{method:'POST',headers:{origin:'https://other.invalid',authorization:`Bearer ${runtime.token}`}})).status,403);
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(`${runtime.url}/score.html#${long.revision.id}`);
  await page.locator('.more-menu summary').click();await page.click('[data-action="score-tools"]');
  await page.locator('#score-feedback-list').filter({hasText:'主题保留，下一版加一点变化。'}).waitFor();
  assert.equal(await page.locator('#song-title').textContent(),example.work.title);
  await page.click('#play');await page.locator('#play').filter({hasText:'暂停'}).waitFor();
  // Browser preview must fetch its actual sound bank from the embedded executable.
  await page.screenshot({path:join(out,'desktop.png')});await page.click('[data-action="close"]');
  await page.waitForFunction(()=>document.querySelector('#version-audio')?.readyState>=1);
  await page.locator('#version-audio').evaluate(a=>a.play());await page.waitForFunction(()=>document.querySelector('#version-audio')?.currentTime>.05);
  assert.equal(await page.$eval('#version-audio',a=>a.duration),40);
  await page.locator('.sound-workspace').screenshot({path:join(out,'tasks.png')});assert.deepEqual(errors,[]);results.push('embedded studio previews real samples, plays saved WAV, shows version feedback');
  await browser.close();browser=undefined;await httpClient.close();httpClient=undefined;
  await client.close();client=undefined;
  // stdio-owned service exits; reopen the same workspace from the copied binary.
  client=await connect();const restoredVoices=(await tool('tts_library')).voices.filter(v=>v.builtinId);assert.deepEqual(restoredVoices.map(v=>({id:v.id,builtinId:v.builtinId})),speech.voices.filter(v=>v.builtinId).map(v=>({id:v.id,builtinId:v.builtinId})));const recovered=await tool('get_project',{projectId:example.work.id});assert.equal(recovered.project.revisions.length,2);assert.equal(recovered.feedback.length,1);results.push('restart restores project, versions, artifact and feedback');
  const report={checks:results,binaryBytes:(await stat(binary)).size,wav:{seconds:40,bytes:wav.length,peak:done.result.peak,rms:done.result.rms},errors};
  await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {
  await browser?.close();await httpClient?.close();await client?.close();
  if(existsSync(held))await rename(held,'dist');await rm(root,{recursive:true,force:true});
}
