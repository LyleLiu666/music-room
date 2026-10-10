import test from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {ConversionService} from './conversion.ts';import {ProjectStore} from '../projects/store.ts';import {encodeWav} from '../../wav.ts';import {parseOperation} from '../operations.ts';
const wav=new Uint8Array(encodeWav([new Float32Array(44100).fill(.1)],44100)),voice={id:'voice-test',name:'参考',audio:wav};
test('paged history orders latest first, clamps boundaries, preserves unpaged clients and reflects cancel/retry',async()=>{
 const root=await mkdtemp(join(tmpdir(),'conversion-pages-')),store=await ProjectStore.open(root),driver={status:()=>({ready:true,message:'ready'}),run:async()=>{throw Error('must not run');}};let service=ConversionService.open(store,driver,()=>true);
 try{
  const empty=service.snapshot({page:9});assert.deepEqual(empty.pagination,{page:1,pageSize:10,total:0,totalPages:1});
  const ids=[];for(let i=0;i<23;i++)ids.push(service.add(`song${i}.wav`,wav,voice,`request${i}`).id);
  // Force equal timestamps independently of clock resolution to verify insertion-order tie breaking.
  await service.close();const file=store.path('conversion','library.json'),data=JSON.parse(await readFile(file,'utf8'));for(const j of data.jobs)j.createdAt='2025-10-10T00:00:00.000Z';data.jobs[0].createdAt='2025-10-11T00:00:00.000Z';await writeFile(file,JSON.stringify(data));service=ConversionService.open(store,driver,()=>true);
  const ordered=[ids[0],...ids.slice(1).reverse()];
  assert.deepEqual(service.snapshot().jobs.map(j=>j.id),ids);assert.equal(service.snapshot().pagination,undefined);assert.equal(service.snapshot({pageSize:2}).jobs.length,23);
  assert.deepEqual(service.snapshot({page:1}).jobs.map(j=>j.id),ordered.slice(0,10));assert.deepEqual(service.snapshot({page:2}).jobs.map(j=>j.id),ordered.slice(10,20));
  const last=service.snapshot({page:999});assert.deepEqual(last.pagination,{page:3,pageSize:10,total:23,totalPages:3});assert.deepEqual(last.jobs.map(j=>j.id),ordered.slice(20));assert.deepEqual(service.snapshot({page:1,pageSize:50}).pagination,{page:1,pageSize:50,total:23,totalPages:1});
  const retry=service.retry(ids[22]);await service.cancel(retry.id);const page=service.snapshot({page:1,pageSize:1});assert.equal(page.jobs[0].id,retry.id);assert.equal(page.jobs[0].state,'cancelled');assert.equal(page.pagination?.total,24);assert.equal(page.pagination?.totalPages,24);assert.equal(page.status.ready,true);const boundary=service.snapshot({page:3,pageSize:12});assert.deepEqual(boundary.pagination,{page:2,pageSize:12,total:24,totalPages:2});assert.equal(boundary.jobs.length,12);assert.throws(()=>service.snapshot({page:0}));assert.throws(()=>service.snapshot({page:1,pageSize:51}));
 }finally{await service.close();await store.close();await rm(root,{recursive:true,force:true});}
});
test('pagination protocol accepts positive integer options only, with a bounded page size',()=>{
 for(const args of [{page:0},{page:-1},{page:1.5},{page:'1'},{pageSize:0},{pageSize:51},{pageSize:1.5},{page:1,extra:true}])assert.throws(()=>parseOperation('svc_library',args));
 assert.deepEqual(parseOperation('svc_library',{}),{});assert.deepEqual(parseOperation('svc_library',{page:2,pageSize:10}),{page:2,pageSize:10});
});
