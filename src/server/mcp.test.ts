import {testResources} from '../service/resources/testing.ts';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {MusicService} from '../service/service.ts';
import {processRenderer} from '../service/render/process.ts';
import {serveHttp} from './http.ts';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readRuntime,remoteCall} from './main.ts';
const stop=(root:string)=>promisify(execFile)(process.execPath,[fileURLToPath(new URL('./fixtures/test-server.ts',import.meta.url)),'stop','--workspace',root]);
const example=JSON.parse(await readFile(new URL('../music/authoring/example.json',import.meta.url),'utf8'));
const rootAssets=new URL('../../dist/',import.meta.url);
const assets={read:(path:string)=>readFile(new URL(path,rootAssets)),has:()=>true,embedded:false};
async function wait(client:Client,id:string){for(let i=0;i<150;i++){const x=await client.callTool({name:'get_job',arguments:{jobId:id}});const value=JSON.parse((x.content as any)[0].text);if(!['queued','running'].includes(value.state))return value;await new Promise(r=>setTimeout(r,30));}throw new Error('timeout');}
test('official HTTP MCP client authors, renders, reads artifacts/resources and rejects bad calls',async t=>{
  const root=await mkdtemp(join(tmpdir(),'music-http-'));const service=await MusicService.open(root,processRenderer(),assets.read,false,undefined,undefined,undefined,testResources()),http=await serveHttp(service,assets);
  const client=new Client({name:'integration',version:'1'});t.after(async()=>{await client.close();await service.jobs.close();await http.close();await service.store.close();await rm(root,{recursive:true,force:true});});
  await client.connect(new StreamableHTTPClientTransport(new URL(http.runtime.url+'/mcp'),{requestInit:{headers:{authorization:`Bearer ${http.runtime.token}`}}}));
  assert.ok((await client.listTools()).tools.some(x=>x.name==='render_revision'));
  const guide=await client.readResource({uri:'music-room://authoring/guide'});assert.ok((guide.contents[0] as any).text.includes('music-room-score'));
  const invoke=async(name:string,args:Record<string,unknown>={})=>{const result=await client.callTool({name,arguments:args});assert.ok(!result.isError,JSON.stringify(result));return JSON.parse((result.content as any)[0].text);};
  for(const projectId of ['123','a'.repeat(65)])assert.ok((await client.callTool({name:'create_project',arguments:{projectId,title:'窗边练习'}})).isError);
  assert.equal((await invoke('list_projects')).projects.length,0);
  const boundaryId='a'.repeat(64);
  await invoke('create_project',{projectId:boundaryId,title:example.work.title});
  await invoke('import_revision',{compositionJson:JSON.stringify({...example,work:{...example.work,id:boundaryId},revision:{...example.revision,id:boundaryId}})});
  await invoke('create_project',{projectId:example.work.id,title:example.work.title});
  await invoke('validate_score',{compositionJson:JSON.stringify(example)});
  await invoke('import_revision',{compositionJson:JSON.stringify(example)});
  const ctx=await invoke('get_authoring_context',{projectId:example.work.id,stage:'expand'});assert.equal(ctx.revision.composition.revision.id,example.revision.id);
  const job=await invoke('render_revision',{projectId:example.work.id,revisionId:example.revision.id,idempotencyKey:'mcp-render'});
  const done=await wait(client,job.id);assert.equal(done.state,'succeeded',done.error??'');
  const wav=await fetch(`${http.runtime.url}/artifacts/${example.work.id}/${example.revision.id}/${job.id}`,{headers:{authorization:`Bearer ${http.runtime.token}`}});
  assert.equal(wav.headers.get('content-disposition'),`attachment; filename="${job.id}.wav"`);
  assert.equal((await wav.arrayBuffer()).byteLength,44+20*44100*4);
  await invoke('add_feedback',{projectId:example.work.id,revisionId:example.revision.id,text:'主题保留'});
  assert.equal((await invoke('get_project',{projectId:example.work.id})).feedback[0].text,'主题保留');
  assert.ok((await client.callTool({name:'import_revision',arguments:{compositionJson:JSON.stringify(example)}})).isError);
  assert.equal((await fetch(http.runtime.url+'/api/status',{method:'POST'})).status,401);
  assert.equal((await fetch(http.runtime.url+'/api/status',{method:'POST',headers:{origin:'https://evil.invalid',authorization:`Bearer ${http.runtime.token}`}})).status,403);
});
test('stdio MCP starts one independent service and tasks survive closing all connections',async t=>{
  const root=await mkdtemp(join(tmpdir(),'music-stdio-'));t.after(async()=>{await stop(root);await rm(root,{recursive:true,force:true});});
  const connect=async()=>{const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./fixtures/test-server.ts',import.meta.url)),'mcp','--workspace',root],stderr:'pipe'});const c=new Client({name:'stdio-integration',version:'1'});await c.connect(transport);return c;};
  const a=await connect();t.after(()=>a.close());
  await a.callTool({name:'import_revision',arguments:{compositionJson:JSON.stringify(example)}});
  const b=await connect();t.after(()=>b.close());const result=await b.callTool({name:'get_revision',arguments:{projectId:example.work.id,revisionId:example.revision.id}});
  assert.ok(!result.isError);assert.equal(JSON.parse((result.content as any)[0].text).composition.revision.id,example.revision.id);
  await b.close(); assert.ok(!(await a.callTool({name:'status',arguments:{}})).isError);
  const resultJob=await a.callTool({name:'render_revision',arguments:{projectId:example.work.id,revisionId:example.revision.id,idempotencyKey:'mcp-window-close'}});
  const job=JSON.parse((resultJob.content as any)[0].text),runtime=readRuntime(root)!;
  await a.close();
  for(let i=0;i<200;i++){const value=await remoteCall(runtime,'get_job',{jobId:job.id});if(!['queued','running'].includes(value.state)){assert.equal(value.state,'succeeded',value.error??'');return;}await new Promise(r=>setTimeout(r,30));}throw Error('task did not finish after MCP clients closed');
});

test('concurrent stdio startup shares one owner rather than failing its second agent',async t=>{
  const root=await mkdtemp(join(tmpdir(),'music-racing-'));t.after(async()=>{await stop(root);await rm(root,{recursive:true,force:true});});
  const start=async()=>{const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('./fixtures/test-server.ts',import.meta.url)),'mcp','--workspace',root],stderr:'pipe'});const client=new Client({name:'racing-agent',version:'1'});t.after(()=>client.close());try{await client.connect(transport);return {client,transport};}catch(e){await transport.close();throw e;}};
  const connections=await Promise.all([start(),start()]);
  t.after(async()=>{for(const x of connections)await x.client.close();});
  const runtime=JSON.parse(await readFile(join(root,'.music-room.runtime.json'),'utf8'));
  for(const x of connections)assert.ok(!(await x.client.callTool({name:'status',arguments:{}})).isError);
  for(const connection of connections)assert.notEqual(connection.transport.pid,runtime.pid);
  await connections[0].client.close();assert.ok(!(await connections[1].client.callTool({name:'status',arguments:{}})).isError);await connections[1].client.close();
  assert.equal((await remoteCall(runtime,'status',{})).workspace,runtime.workspace);
});

test('MCP onboarding discovers one music creation guide through instructions, tools and resources without starting generation',async t=>{
 const root=await mkdtemp(join(tmpdir(),'music-guide-'));const service=await MusicService.open(root,processRenderer(),assets.read,false,undefined,undefined,undefined,testResources()),http=await serveHttp(service,assets);
 const client=new Client({name:'new-music-agent',version:'1'});t.after(async()=>{await client.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});});
 await client.connect(new StreamableHTTPClientTransport(new URL(http.runtime.url+'/mcp'),{requestInit:{headers:{authorization:`Bearer ${http.runtime.token}`}}}));
 assert.match(client.getInstructions()??'',/get_music_creation_guide/);
 const tools=(await client.listTools()).tools,tool=tools.find(x=>x.name==='get_music_creation_guide');assert.ok(tool);assert.equal(tool.annotations?.readOnlyHint,true);
 for(const name of ['studio_generate','yue2_generate'])assert.match(tools.find(x=>x.name===name)!.description!,/get_music_creation_guide/);
 const result=await client.callTool({name:'get_music_creation_guide',arguments:{}});assert.ok(!result.isError);const guide=JSON.parse((result.content as any)[0].text);assert.match(guide.guide,/不保证减少重复/);assert.doesNotMatch(guide.guide,/由 Agent 编写完整 YuE2 ABC 乐谱与编曲，再交给 YuE2/);assert.equal(guide.version,2);assert.match(guide.guide,/轮番/);assert.match(guide.guide,/riff/);assert.match(guide.guide,/不能直接重复/);assert.match(guide.guide,/不强制.*短样/);assert.match(guide.example.abc,/V: Ins/);assert.equal(guide.example.instrumental,true);
 assert.ok((await client.listResources()).resources.some(x=>x.uri==='music-room://music/creation-guide'));
 const resource=await client.readResource({uri:'music-room://music/creation-guide'});assert.deepEqual(JSON.parse((resource.contents[0] as any).text),guide);
 assert.equal((await service.store.projects()).length,0);assert.equal(service.resources.snapshot().active,undefined);assert.equal(service.resources.snapshot().queued.length,0);
 assert.ok((await client.callTool({name:'get_music_creation_guide',arguments:{generate:true}})).isError);
});

test('MCP sound effect jobs preserve inputs, queue independently of client, and expose the saved WAV',async t=>{
 const {encodeWav}=await import('../wav.ts');const root=await mkdtemp(join(tmpdir(),'music-sfx-mcp-'));const resources=testResources();
 const driver={profile:{id:'fixture'},installed:()=>true,prepare:async()=>{},generate:async(req:any)=>Buffer.from(encodeWav([Float32Array.from({length:req.seconds*24000},(_,i)=>Math.sin(i*.1)*.1)],24000))};
 const service=await MusicService.open(root,processRenderer(),assets.read,false,undefined,undefined,undefined,resources,undefined,{effects:driver}),http=await serveHttp(service,assets),client=new Client({name:'sfx-test',version:'1'});
 t.after(async()=>{await client.close();await http.close();await service.close();await rm(root,{recursive:true,force:true});});
 await client.connect(new StreamableHTTPClientTransport(new URL(http.runtime.url+'/mcp'),{requestInit:{headers:{authorization:`Bearer ${http.runtime.token}`}}}));
 for(const name of ['sound_effect_status','sound_effect_prepare','sound_effect_generate','sound_effect_job','sound_effect_cancel','studio_attach_sound','studio_trim_audio','sound_library_trim'])assert.ok((await client.listTools()).tools.some(x=>x.name===name),name);
 const invoke=async(name:string,args:Record<string,unknown>={})=>{const r=await client.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return JSON.parse((r.content as any)[0].text);};
 const args={requestId:'mcp-effect-1',title:'碎纸机',prompt:'Paper shredder',seconds:3,seed:42};const job=await invoke('sound_effect_generate',args);assert.equal((await invoke('sound_effect_generate',args)).id,job.id);
 let result:any;for(let i=0;i<200;i++){result=await invoke('sound_effect_job',{jobId:job.id});if(!['queued','running'].includes(result.state))break;await new Promise(r=>setTimeout(r,10));}
 assert.equal(result.state,'succeeded',result.message);assert.equal(result.item.origin,'sound-effect');assert.equal(result.item.source.kind,'sound-effect');assert.equal(result.item.source.prompt,args.prompt);
 const response=await fetch(http.runtime.url+result.item.audioPath,{headers:{authorization:`Bearer ${http.runtime.token}`}});assert.equal(response.status,200);assert.ok((await response.arrayBuffer()).byteLength>44);
 assert.ok((await client.callTool({name:'sound_effect_generate',arguments:{...args,requestId:'invalid',seconds:6}})).isError);
 await invoke('create_project',{projectId:'office',title:'办公室'});const attached=await invoke('studio_attach_sound',{itemId:result.item.id,projectId:'office',title:'碎纸机',requestId:'mcp-attach'});
 const projectJob=await invoke('sound_effect_generate',{...args,requestId:'mcp-project-effect',soundId:attached.soundId,parentId:attached.id});let projectResult:any;for(let i=0;i<200;i++){projectResult=await invoke('sound_effect_job',{jobId:projectJob.id});if(!['queued','running'].includes(projectResult.state))break;await new Promise(r=>setTimeout(r,10));}assert.equal(projectResult.state,'succeeded',projectResult.message);
 const snapshot=await invoke('studio_library');assert.ok(snapshot.versions.some((v:any)=>v.id===projectJob.id&&v.soundId===attached.soundId&&v.number===2));
 const clipped=await invoke('studio_trim_audio',{versionId:projectJob.id,startSeconds:1,endSeconds:3,requestId:'mcp-trim'});assert.equal(clipped.duration,2);assert.equal(clipped.parentId,projectJob.id);const clippedResponse=await fetch(http.runtime.url+clipped.audioPath,{headers:{authorization:`Bearer ${http.runtime.token}`}});assert.equal(clippedResponse.status,200);assert.equal(clippedResponse.headers.get('content-type'),'audio/wav');
});
