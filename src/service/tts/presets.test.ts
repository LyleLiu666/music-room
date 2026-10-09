import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readBuiltinVoices,prepareBuiltinConditioning} from './presets.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {presetVoices} from './preset-manifest.ts';
import {wavInfo,SpeechService,type SpeechDriver} from './speech.ts';
import {ProjectStore} from '../projects/store.ts';

test('the five requested built-in voices have validated dry references and pinned precomputed features',async()=>{
 const voices=await readBuiltinVoices(path=>readFile(resolve('public',path)));
 assert.deepEqual(voices.map(v=>v.name),['迪丽热巴','天津团团记','女网红','示例声音 · 官方样音','沈腾']);
 for(const voice of voices){
  const info=wavInfo(voice.audio);assert.ok(info.duration>=.3&&info.duration<=15.1&&info.peak>=.001);
  const preset=presetVoices.find(v=>v.id===voice.id)!;
  const features=await readFile(resolve('public/tts-presets',voice.id+'.npz'));
  assert.equal(createHash('sha256').update(features).digest('hex'),preset.featuresSha256);
  assert.equal(features.subarray(0,2).toString(),'PK','speaker features must be a NumPy archive');
 }
});
test('damaged bundled audio cannot silently become a built-in voice',async()=>{
 await assert.rejects(readBuiltinVoices(async path=>{
  const bytes=await readFile(resolve('public',path));bytes[bytes.length-1]^=1;return bytes;
 }),/内置音色校验失败/);
});
test('only the exact built-in reference gets its verified conditioning; names never select a cache',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'tts-conditioning-'));
 try{
  const read=(path:string)=>readFile(resolve('public',path));
  const audio=await read('tts-presets/official.wav');
  assert.equal(await prepareBuiltinConditioning(root,new Uint8Array([1,2,3]),read),undefined);
  const result=await prepareBuiltinConditioning(root,audio,read);
  assert.ok(result);assert.equal(createHash('sha256').update(await readFile(result.conditioningPath)).digest('hex'),result.conditioningSha256);
  const repeat=await prepareBuiltinConditioning(root,audio,read);assert.deepEqual(repeat,result);
  await assert.rejects(prepareBuiltinConditioning(root,audio,async path=>{const bytes=await read(path);if(path.endsWith('.npz'))bytes[bytes.length-1]^=1;return bytes;}),/特征校验失败/);
 }finally{await rm(root,{recursive:true,force:true});}
});


test('Shenteng keeps the approved one-second zero insert and matching pinned features',async()=>{
 const read=(path:string)=>readFile(resolve('public',path)),voices=await readBuiltinVoices(read),voice=voices.find(v=>v.id==='shenteng');assert.ok(voice,'fifth builtin must be registered');
 const b=Buffer.from(voice.audio);assert.equal(wavInfo(b).sampleRate,22050);assert.equal(b.readUInt16LE(22),1);let pcm:Buffer|undefined;
 for(let offset=12;offset+8<=b.length;){const length=b.readUInt32LE(offset+4);if(b.toString('ascii',offset,offset+4)==='data')pcm=b.subarray(offset+8,offset+8+length);offset+=8+length+(length%2);}assert.ok(pcm);
 const start=87470,samples=22050;assert.equal(pcm.subarray(start*2,(start+samples)*2).length,44100);assert.ok(pcm.subarray(start*2,(start+samples)*2).every(byte=>byte===0));assert.ok(pcm.subarray(0,start*2).some(byte=>byte!==0));assert.ok(pcm.subarray((start+samples)*2).some(byte=>byte!==0));
 assert.equal(createHash('sha256').update(voice.audio).digest('hex'),'85ac96cc74f9138b13db862301cca06efea29477931d22e9598cfddf917c2501');
 const root=await mkdtemp(resolve(tmpdir(),'tts-shenteng-features-'));try{const conditioning=await prepareBuiltinConditioning(root,voice.audio,read);assert.ok(conditioning);assert.equal(conditioning.conditioningSha256,'c6018c294a73e8073e7f4bcf15d36eb5c7c7007c3a7abda0bc3502bb1a32ca1f');}finally{await rm(root,{recursive:true,force:true});}
});
test('registering Shenteng matches a previously saved reference by SHA and preserves its ID over full restarts',async()=>{
 const root=await mkdtemp(resolve(tmpdir(),'tts-shenteng-upgrade-')),read=(path:string)=>readFile(resolve('public',path));let store:ProjectStore|undefined,speech:SpeechService|undefined;
 const base:SpeechDriver={installed:()=>false,prepare:async()=>{},generate:async()=>{throw Error('unused');}};
 try{store=await ProjectStore.open(root);speech=await SpeechService.open(store,base);const saved=speech.addVoice('沈腾',await read('tts-presets/shenteng.wav'));
  await speech.close();await store.close();
  for(let restart=0;restart<2;restart++){store=await ProjectStore.open(root);speech=await SpeechService.open(store,{...base,builtinVoices:()=>readBuiltinVoices(read)});const voices=speech.snapshot().voices;assert.equal(voices.length,5);assert.equal(voices.filter(v=>v.builtinId==='shenteng').length,1);assert.equal(voices.find(v=>v.builtinId==='shenteng')!.id,saved.id);assert.equal(voices.find(v=>v.builtinId==='shenteng')!.name,'沈腾');assert.deepEqual(speech.voiceAudio(saved.id),new Uint8Array(await read('tts-presets/shenteng.wav')));await speech.close();await store.close();}
 }finally{await speech?.close();await store?.close();await rm(root,{recursive:true,force:true});}
});
