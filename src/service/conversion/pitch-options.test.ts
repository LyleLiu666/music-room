import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';import {join} from 'node:path';import {tmpdir} from 'node:os';import {ProjectStore} from '../projects/store.ts';import {ConversionService} from './conversion.ts';import {parseOperation} from '../operations.ts';import {encodeWav} from '../../wav.ts';
const wav=new Uint8Array(encodeWav([new Float32Array(44100).fill(.1)],44100)),voice={id:'voice-test',name:'目标',audio:wav};
test('pitch options persist, preserve retry and reject invalid/idempotency-conflicting values without new jobs',async()=>{
 const root=await mkdtemp(join(tmpdir(),'conversion-pitch-')),store=await ProjectStore.open(root),driver={status:()=>({ready:true,message:''}),run:async()=>{throw Error('must not run');}};let s=ConversionService.open(store,driver,()=>true);
 try{for(const value of [-13,13,1.5,NaN,Infinity,'3'])assert.throws(()=>s.add('song.wav',wav,voice,'bad',undefined,value as number));assert.equal(s.snapshot().jobs.length,0);
  const zero=s.add('song.wav',wav,voice,'zero');assert.equal(zero.pitchShiftSemitones,0);assert.equal(s.add('song.wav',wav,voice,'zero',undefined,0).id,zero.id);
  for(const pitch of [-12,4,12]){const j=s.add('song.wav',wav,voice,`pitch-${pitch}`,undefined,pitch);assert.equal(j.pitchShiftSemitones,pitch);assert.equal(JSON.parse(await readFile(store.path('conversion',j.id,'meta.json'),'utf8')).pitchShiftSemitones,pitch);await s.cancel(j.id);const retry=s.retry(j.id);assert.equal(retry.pitchShiftSemitones,pitch);assert.equal(retry.sourceSha256,j.sourceSha256);}
  assert.throws(()=>s.add('song.wav',wav,voice,'zero',undefined,1),/不同|移调/);
  await s.close();const file=store.path('conversion','library.json'),data=JSON.parse(await readFile(file,'utf8'));delete data.jobs[0].pitchShiftSemitones;await writeFile(file,JSON.stringify(data));s=ConversionService.open(store,driver,()=>true);assert.equal(s.get(zero.id).pitchShiftSemitones,0);assert.equal(s.retry(zero.id).pitchShiftSemitones,0);
 }finally{await s.close();await store.close();await rm(root,{recursive:true,force:true});}
});
test('reuse API validates integer semitone boundaries without coercing strings',()=>{
 const base={soundId:'sound-test',sourceJobId:'conversion-test',voiceId:'voice-test',requestId:'new'};
 for(const pitchShiftSemitones of [-13,13,.5,'2',null])assert.throws(()=>parseOperation('svc_create_version',{...base,pitchShiftSemitones}));
 for(const pitchShiftSemitones of [-12,0,12])assert.equal(parseOperation('svc_create_version',{...base,pitchShiftSemitones}).pitchShiftSemitones,pitchShiftSemitones);
});
