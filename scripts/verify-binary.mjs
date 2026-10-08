import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {chromium} from 'playwright';
import {mkdtemp,copyFile,chmod,mkdir,readFile,writeFile,rm,rename,stat,realpath} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
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
  const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));assert.equal(runtime.command,await realpath(binary));
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
  await tool('add_feedback',{projectId:example.work.id,revisionId:long.revision.id,text:'主题保留，下一版加一点变化。'});
  httpClient=new Client({name:'binary-http-agent',version:'1'});await httpClient.connect(new StreamableHTTPClientTransport(new URL(runtime.url+'/mcp'),{requestInit:{headers:{authorization:`Bearer ${runtime.token}`}}}));
  assert.ok((await httpClient.listTools()).tools.some(t=>t.name==='render_revision'));results.push('embedded HTTP MCP interoperates with official client');
  assert.equal((await fetch(runtime.url+'/api/status',{method:'POST'})).status,401);
  assert.equal((await fetch(runtime.url+'/api/status',{method:'POST',headers:{origin:'https://other.invalid',authorization:`Bearer ${runtime.token}`}})).status,403);
  browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));await page.goto(`${runtime.url}/#${long.revision.id}`);await page.locator('#service-state').filter({hasText:'已连接'}).waitFor();
  assert.equal(await page.locator('#song-title').textContent(),example.work.title);assert.equal(await page.locator('#service-feedback-list').textContent(),'主题保留，下一版加一点变化。');
  await page.click('#play');await page.waitForFunction(()=>window.musicRoom.engine.context?.currentTime>.05 && window.musicRoom.engine.ready);
  // Browser preview must also fetch its actual sound bank from the embedded executable.
  await page.click('#play');const listen=page.locator('#service-jobs button').filter({hasText:'试听后台 WAV'}).first();await listen.click();await page.waitForFunction(()=>document.querySelector('#service-audio audio')?.currentTime>.05);
  assert.equal(await page.$eval('#service-audio audio',a=>a.duration),40);
  await page.screenshot({path:join(out,'desktop.png')});await page.locator('.service-panel').screenshot({path:join(out,'tasks.png')});assert.deepEqual(errors,[]);results.push('embedded page previews real samples, plays saved WAV, shows feedback');
  await browser.close();browser=undefined;await httpClient.close();httpClient=undefined;
  await client.close();client=undefined;
  // stdio-owned service exits; reopen the same workspace from the copied binary.
  client=await connect();const recovered=await tool('get_project',{projectId:example.work.id});assert.equal(recovered.project.revisions.length,2);assert.equal(recovered.feedback.length,1);results.push('restart restores project, versions, artifact and feedback');
  const report={checks:results,binaryBytes:(await stat(binary)).size,wav:{seconds:40,bytes:wav.length,peak:done.result.peak,rms:done.result.rms},errors};
  await writeFile(join(out,'verification.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
} finally {
  await browser?.close();await httpClient?.close();await client?.close();
  if(existsSync(held))await rename(held,'dist');await rm(root,{recursive:true,force:true});
}
