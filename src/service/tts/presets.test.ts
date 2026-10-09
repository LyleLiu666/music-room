import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {readBuiltinVoices,prepareBuiltinConditioning} from './presets.ts';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {presetVoices} from './preset-manifest.ts';
import {wavInfo} from './speech.ts';

test('the four requested built-in voices have validated dry references and pinned precomputed features',async()=>{
 const voices=await readBuiltinVoices(path=>readFile(resolve('public',path)));
 assert.deepEqual(voices.map(v=>v.name),['迪丽热巴','天津团团记','女网红','示例声音 · 官方样音']);
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
