import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkbenchService} from './service.ts';
const bootstrap={token:'old',url:'http://127.0.0.1:5174',workspace:'/music',mcp:{}};
test('concurrent stale requests renew once and retry with the new token',async t=>{
 let renewals=0,executions=0;
 t.mock.method(globalThis,'fetch',async(path:string,init?:RequestInit)=>{
  if(path==='/local-session'){renewals++;await new Promise(r=>setTimeout(r,10));return Response.json({...bootstrap,token:'new'});}
  if(new Headers(init?.headers).get('authorization')!=='Bearer new')return Response.json({}, {status:401});
  executions++;return Response.json({projects:[]});
 });
 const api=new WorkbenchService({...bootstrap});
 await Promise.all([api.call('list_projects',{}),api.call('list_projects',{})]);
 assert.equal(renewals,1);assert.equal(executions,2);assert.equal(api.bootstrap.token,'new');
});
test('401 recovery preserves an upload body and retries at most once',async t=>{
 const bytes=new Uint8Array([1,2,3]);let requests=0;
 t.mock.method(globalThis,'fetch',async(path:string,init?:RequestInit)=>{
  if(path==='/local-session')return Response.json({...bootstrap,token:'new'});
  requests++;assert.equal(init?.body,bytes);return Response.json({}, {status:401});
 });
 const api=new WorkbenchService({...bootstrap});
 await assert.rejects(()=>api.request('/speech/voices',{method:'POST',body:bytes}),/重新连接/);
 await assert.rejects(()=>api.call('list_projects',{}),/重新连接/);
 assert.equal(requests,2);
});
test('never retries an ambiguous network failure or server failure',async t=>{
 let calls=0;
 t.mock.method(globalThis,'fetch',async()=>{calls++;throw Error('network down');});
 const api=new WorkbenchService({...bootstrap});
 await assert.rejects(()=>api.call('create_project',{projectId:'one',title:'one'}),/network down/);
 assert.equal(calls,1);
});
test('a different workspace cannot receive an old page operation',async t=>{
 let requests=0;
 t.mock.method(globalThis,'fetch',async(path:string)=>{
  if(path==='/local-session')return Response.json({...bootstrap,token:'new',workspace:'/other'});
  requests++;return Response.json({}, {status:401});
 });
 const api=new WorkbenchService({...bootstrap});
 await assert.rejects(()=>api.call('create_project',{projectId:'one',title:'one'}),/工作目录/);
 assert.equal(requests,1);assert.equal(api.bootstrap.token,'old');
});
test('server errors are returned without credential renewal or replay',async t=>{
 let calls=0;t.mock.method(globalThis,'fetch',async()=>{calls++;return Response.json({message:'server unavailable'},{status:503});});
 await assert.rejects(()=>new WorkbenchService({...bootstrap}).call('list_projects',{}),/server unavailable/);
 assert.equal(calls,1);
});
test('failed renewal pauses rejected polling then recovers on the next attempt',async t=>{
 let now=1000,requests=0,renewals=0,available=false;
 t.mock.method(Date,'now',()=>now);
 t.mock.method(globalThis,'fetch',async(path:string,init?:RequestInit)=>{
  if(path==='/local-session'){renewals++;return available?Response.json({...bootstrap,token:'new'}):new Response('',{status:503});}
  requests++;return new Headers(init?.headers).get('authorization')==='Bearer new'?Response.json({projects:[]}):new Response('',{status:401});
 });
 const api=new WorkbenchService({...bootstrap});
 await assert.rejects(()=>api.call('list_projects',{}),/重新连接/);
 await assert.rejects(()=>api.call('list_projects',{}),/重新连接/);
 assert.equal(requests,1);assert.equal(renewals,1);
 now+=10001;available=true;assert.deepEqual(await api.call('list_projects',{}),{projects:[]});
 assert.equal(requests,3);assert.equal(renewals,2);
});

for(const operation of ['studio_library','resource_status'] as const)test(`${operation} has a deadline through body consumption and recovers after timeout`,async t=>{
 const deadline=new AbortController();let attempts=0;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,10000);return deadline.signal.aborted?new AbortController().signal:deadline.signal;});
 t.mock.method(globalThis,'fetch',async(_path:string,init?:RequestInit)=>{
  attempts++;assert.ok(init?.signal,'status requests must be bounded');
  if(attempts>1)return Response.json({projects:[]});
  return {ok:true,status:200,json:()=>new Promise((_resolve,reject)=>{
   init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true});
   deadline.abort(new DOMException('Timed out','TimeoutError'));
  })} as Response;
 });
 const api=new WorkbenchService({...bootstrap});
 await assert.rejects(api.call(operation,{}),/超时/);
 assert.equal(attempts,1,'a timeout must not replay a request implicitly');
 assert.deepEqual(await api.call(operation,{}),{projects:[]});
});

test('long running save operations do not inherit the status query deadline',async t=>{
 t.mock.method(AbortSignal,'timeout',()=>{throw Error('unexpected status deadline');});
 t.mock.method(globalThis,'fetch',async()=>Response.json({id:'saved'}));
 assert.deepEqual(await new WorkbenchService({...bootstrap}).call('studio_save_speed',{versionId:'v',rate:1.2,requestId:'r'}),{id:'saved'});
});

for(const operation of ['yue2_inspect_input','yue2_score'] as const)test(`${operation} times out without replaying and permits a later retry`,async t=>{
 const deadline=new AbortController();let attempts=0;
 t.mock.method(AbortSignal,'timeout',(ms:number)=>{assert.equal(ms,10000);return deadline.signal.aborted?new AbortController().signal:deadline.signal;});
 t.mock.method(globalThis,'fetch',async(_path:string,init?:RequestInit)=>{
  attempts++;assert.ok(init?.signal,'music inspection reads must be bounded');
  if(attempts>1)return Response.json({});
  return {ok:true,status:200,json:()=>new Promise((_resolve,reject)=>{
   init.signal!.addEventListener('abort',()=>reject(init.signal!.reason),{once:true});
   deadline.abort(new DOMException('Timed out','TimeoutError'));
  })} as Response;
 });
 const api=new WorkbenchService({...bootstrap});
 const args=operation==='yue2_score'?{jobId:'a'.repeat(32)}:{style:'piano',lyrics:'[instrumental]',instrumental:true};
 await assert.rejects(api.call(operation,args),/超时/);
 assert.equal(attempts,1);
 assert.deepEqual(await api.call(operation,args),{});
});
