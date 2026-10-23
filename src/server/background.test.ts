import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {remoteCall,readRuntime} from './main.ts';
import type {Job} from '../service/jobs/jobs.ts';
const command=process.env.MUSIC_ROOM_BINARY??process.execPath;
const selfArgs=process.env.MUSIC_ROOM_BINARY?[]:[fileURLToPath(new URL('./fixtures/test-server.ts',import.meta.url))],run=promisify(execFile);
const example=JSON.parse(await readFile(new URL('../music/authoring/example.json',import.meta.url),'utf8'));
async function waitFor<T>(read:()=>Promise<T|undefined>,timeout=15000):Promise<T>{const until=Date.now()+timeout;while(Date.now()<until){const value=await read();if(value)return value;await new Promise(r=>setTimeout(r,50));}throw Error('timeout');}
test('background startup survives closing its launching terminal while queued and running jobs complete',async t=>{
 const root=await mkdtemp(join(tmpdir(),'music-background-'));
 // A terminal owns a process group. Closing it sends SIGHUP to that group.
 const terminal=spawn('/bin/sh',['-c','music_workspace=$1; shift; "$@" start --workspace "$music_workspace"; printf "launcher-ready\\n"; sleep 60','music-terminal',root,command,...selfArgs],{detached:true,stdio:['ignore','pipe','pipe']});
 let output='',errors='';terminal.stdout.on('data',chunk=>output+=chunk);terminal.stderr.on('data',chunk=>errors+=chunk);
 t.after(async()=>{try{process.kill(-terminal.pid!,'SIGKILL');}catch{}const runtime=readRuntime(root);if(runtime){process.kill(runtime.pid,'SIGTERM');await waitFor(async()=>!readRuntime(root)?true:undefined);}await rm(root,{recursive:true,force:true});});
 await waitFor(async()=>output.includes('launcher-ready')?true:undefined);
 const runtime=readRuntime(root);assert.ok(runtime,errors);assert.notEqual(runtime.pid,terminal.pid);
 await remoteCall(runtime,'import_revision',{compositionJson:JSON.stringify(example)});
 const request={projectId:example.work.id,revisionId:example.revision.id,idempotencyKey:'window-close'};
 const first=await remoteCall(runtime,'render_revision',request);
 await waitFor<Job>(async()=>{const job=await remoteCall(runtime,'get_job',{jobId:first.id});return job.state==='running'?job:undefined;});
 const second=await remoteCall(runtime,'render_revision',{...request,idempotencyKey:'window-close-queued'});
 assert.equal(second.state,'queued');
 process.kill(-terminal.pid!,'SIGHUP');
 await waitFor(async()=>terminal.signalCode==='SIGHUP'?true:undefined);
 assert.equal((await remoteCall(runtime,'status',{})).workspace,runtime.workspace);
 for(const job of [first,second]){const done:Job=await waitFor<Job>(async()=>{const value:Job=await remoteCall(runtime,'get_job',{jobId:job.id});return ['queued','running'].includes(value.state)?undefined:value;});assert.equal(done.state,'succeeded',done.error??'');}
 const reused=JSON.parse((await run(command,[...selfArgs,'start','--workspace',root])).stdout);assert.equal(reused.reused,true);assert.equal(reused.background,true);assert.equal(readRuntime(root)?.pid,runtime.pid);
 await run(command,[...selfArgs,'stop','--workspace',root]);assert.equal(readRuntime(root),undefined);
 await run(command,[...selfArgs,'stop','--workspace',root]);
});
test('reusing an explicit foreground service reports its lifetime without interrupting it',async t=>{
 const root=await mkdtemp(join(tmpdir(),'music-foreground-'));
 const foreground=spawn(command,[...selfArgs,'serve','--workspace',root],{stdio:'ignore'});
 t.after(async()=>{await run(command,[...selfArgs,'stop','--workspace',root]);await rm(root,{recursive:true,force:true});});
 const runtime=await waitFor(async()=>readRuntime(root));
 const result=await run(command,[...selfArgs,'start','--workspace',root]);
 assert.equal(JSON.parse(result.stdout).background,false);assert.match(result.stderr,/前台或旧版服务/);
 assert.equal(readRuntime(root)?.pid,foreground.pid);assert.equal((await remoteCall(runtime,'status',{})).workspace,runtime.workspace);
});
test('failed background startup reports its log and does not claim success',async t=>{
 const root=await mkdtemp(join(tmpdir(),'music-background-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));
 const listener=await import('node:net').then(({createServer})=>createServer());await new Promise<void>(resolve=>listener.listen(0,'127.0.0.1',resolve));t.after(()=>listener.close());
 const port=(listener.address() as {port:number}).port;
 await assert.rejects(run(command,[...selfArgs,'start','--workspace',root,'--port',String(port)]),error=>error instanceof Error&&/EADDRINUSE|Address already in use|port .* in use/.test(error.message)&&/music-room.log/.test(error.message));
 assert.equal(readRuntime(root),undefined);
});
