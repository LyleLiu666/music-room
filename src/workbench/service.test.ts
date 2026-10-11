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
