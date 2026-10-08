import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderScore, validateMix } from './renderer.ts';
const example = JSON.parse(await readFile(new URL('../../music/authoring/example.json',import.meta.url),'utf8'));
const samples = (path:string)=>readFile(new URL(`../../../public/${path}`,import.meta.url));
test('backend renders actual stereo samples without DOM, with exact duration and safe peak', async ()=> {
  const result = await renderScore(example.score,samples);
  const bytes = result.wav, view = new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  assert.equal(Buffer.from(bytes.subarray(0,4)).toString(),'RIFF');
  assert.equal(bytes.length,44+20*44100*4); assert.equal(view.getUint16(22,true),2);
  assert.ok(result.peak>.01 && result.peak<=.891); assert.ok(result.rms>.003);
  assert.equal(result.engine,'sample-pcm-v1');
  let energy=0; for(let i=44;i<bytes.length;i+=2)energy+=Math.abs(view.getInt16(i,true)); assert.ok(energy>1e6);
});
test('single known piano note has correct pitch, muted renders stay silent; invalid mix rejected', async()=> {
  const score = {...example.score, notes:[{track:'melody',pitch:69,beat:0,duration:4,velocity:.8}]};
  const output = await renderScore(score,samples,{volume:.85,lead:'piano',levels:{},muted:[],solo:[]});
  const view = new DataView(output.wav.buffer), rate=44100;
  const at=(i:number)=>view.getInt16(44+i*4,true)/32768;
  // Autocorrelation near A4: verify source/pitch ratio, not a synthetic metadata assertion.
  let best=0,lag=0; for(let l=95;l<=105;l++) {let sum=0;for(let i=rate*.3;i<rate*.6;i++)sum+=at(i)*at(i+l); if(sum>best){best=sum;lag=l;} }
  assert.ok(Math.abs(rate/lag-440)<8,`measured ${rate/lag} Hz`);
  const muted = await renderScore(score,samples,{volume:.85,lead:'piano',levels:{},muted:['melody'],solo:[]});
  assert.equal(muted.peak,0); assert.equal(muted.rms,0);
  for (const x of [{volume:3},{levels:{evil:1}},{muted:['voice']},{lead:'unknown'}]) assert.throws(()=>validateMix(x));
});
