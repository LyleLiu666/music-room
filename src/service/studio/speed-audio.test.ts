import {audioShape} from './audio-budget.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import decoder from 'wav-decoder';
import {changeAudioSpeed} from './speed.ts';
import {encodeWav} from '../../wav.ts';
import {readFile} from 'node:fs/promises';

test('production half-speed uses the R3 signal path selected in the listening comparison', {skip:process.platform!=='darwin'}, async()=>{
 const fixture=JSON.parse(await readFile(new URL('./fixtures/r3-vocal-050.json',import.meta.url),'utf8'));
 const sampleRate=fixture.sampleRate;
 const source=Float32Array.from({length:sampleRate},(_,i)=>{
  const t=i/sampleRate,phase=2*Math.PI*(140*t+25*t*t),envelope=Math.sin(Math.PI*t)**2;
  return envelope*(.4*Math.sin(phase)+.2*Math.sin(phase*2)+.1*Math.sin(phase*3));
 });
 const bytes=await changeAudioSpeed(new Uint8Array(encodeWav([source],sampleRate)),.5);
 const actual=(await decoder.decode(new Uint8Array(bytes).buffer)).channelData[0];
 assert.equal(actual.length,fixture.outputFrames);
 let error=0,energy=0;
 for(const [frame,value] of fixture.samples){error+=(actual[frame]-value)**2;energy+=value**2;}
 assert.ok(Math.sqrt(error/energy)<.001,'saved output must match the independently rendered R3 fixture');
});

test('speed processing reserves peak headroom instead of clipping loud material', {skip:process.platform!=='darwin'}, async()=>{
 const sampleRate=22050,samples=Float32Array.from({length:sampleRate*2},(_,i)=>.98*Math.sin(2*Math.PI*440*i/sampleRate));
 const output=await changeAudioSpeed(new Uint8Array(encodeWav([samples],sampleRate)),.5);
 const channel=(await decoder.decode(new Uint8Array(output).buffer)).channelData[0];
 let peak=0;for(const x of channel)peak=Math.max(peak,Math.abs(x));
 assert.ok(peak<=.9801,`output peak ${peak} exceeds headroom`);
 assert.ok(peak>.9,'headroom protection must not excessively attenuate the audio');
});

test('saved speech tempo preserves short sounds and their timing', {skip:process.platform!=='darwin'}, async()=>{
 // Separated 40 ms syllable-like sounds expose repeats/skips hidden by a steady tone.
 const sampleRate=24000,starts=Array.from({length:7},(_,i)=>.2+i*.4);
 const source=Float32Array.from({length:sampleRate*3},(_,i)=>{
  const t=i/sampleRate,start=starts.find(start=>t>=start&&t<start+.04);
  return start===undefined?0:.3*Math.sin(Math.PI*(t-start)/.04)**2*Math.sin(2*Math.PI*440*t);
 });
 for(const rate of [.8,.85,.5,1.2,2]){
  const bytes=await changeAudioSpeed(new Uint8Array(encodeWav([source],sampleRate)),rate);
  const samples=(await decoder.decode(new Uint8Array(bytes).buffer)).channelData[0];
  const onsets:number[]=[];let last=-sampleRate;
  for(let i=0;i<samples.length;i++)if(Math.abs(samples[i])>.04){
   if(i-last>sampleRate*.02)onsets.push(i/sampleRate);
   last=i;
  }
  assert.equal(onsets.length,starts.length,`${rate}x must not repeat or drop short sounds`);
  onsets.forEach((onset,i)=>assert.ok(Math.abs(onset-starts[i]/rate)<.025,`${rate}x sound ${i}: ${onset} vs ${starts[i]/rate}`));
 }
});

test('tempo changes preserve mono/stereo, sample rate, pitch, leading audio and the last phrase',async()=>{
 for(const sampleRate of [22050,48000])for(const rate of [.5,.8,1.2,2]){
  const frames=sampleRate*2;
  const left=Float32Array.from({length:frames},(_,i)=>.3*Math.sin(2*Math.PI*440*i/sampleRate));
  const right=Float32Array.from({length:frames},(_,i)=>i>frames-sampleRate*.15?.4*Math.sin(2*Math.PI*660*i/sampleRate):0);
  const bytes=await changeAudioSpeed(new Uint8Array(encodeWav([left,right],sampleRate)),rate);
  const result=await decoder.decode(new Uint8Array(bytes).buffer);
  assert.equal(result.channelData.length,2);assert.equal(result.sampleRate,sampleRate);assert.equal(result.channelData[0].length,Math.round(frames/rate));
  const [a,b]=result.channelData;
  const rms=(samples:Float32Array)=>Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);
  assert.ok(rms(a.subarray(0,Math.round(sampleRate*.03)))>.1,'initial audio is retained');
  assert.ok(rms(b.subarray(-Math.round(sampleRate*.2/rate)))>.1,'final phrase is retained');
  assert.equal(rms(b.subarray(0,sampleRate/2)),0,'stereo channels are not mixed');
  const start=Math.round(sampleRate*.2),end=Math.round(sampleRate*.7);let cycles=0;
  for(let i=start;i<end;i++)if(a[i]>=0&&a[i-1]<0)cycles++;
  assert.ok(Math.abs(cycles*2-440)<5,`pitch at ${sampleRate} / ${rate}: ${cycles*2}`);
 }
});

test('short clips and silence finish without NaN, empty output or dropped ending',async()=>{
 for(const duration of [.03,.1])for(const rate of [.5,.8,2]){
  const samples=Float32Array.from({length:Math.round(24000*duration)},(_,i)=>.2*Math.sin(i*.15));
  const result=await decoder.decode(new Uint8Array(await changeAudioSpeed(new Uint8Array(encodeWav([samples],24000)),rate)).buffer);
  assert.equal(result.channelData[0].length,Math.round(samples.length/rate));
  assert.ok(result.channelData[0].some(x=>Math.abs(x)>.05));assert.ok(result.channelData[0].every(Number.isFinite));
 }
 const silent=await changeAudioSpeed(new Uint8Array(encodeWav([new Float32Array(24000)],24000)),.8);
 assert.ok((await decoder.decode(new Uint8Array(silent).buffer)).channelData[0].every(x=>x===0));
 await assert.rejects(changeAudioSpeed(new Uint8Array([1,2,3]),.8));
});
test('FLAC declared frames cannot hide a larger decoded stream',async()=>{
 const {readFile}=await import('node:fs/promises');const bytes=Buffer.from(await readFile(new URL('./fixtures/tone-440hz.flac',import.meta.url)));bytes.writeUInt32BE(bytes.readUInt32BE(18)&0xfffffff0,18);bytes.writeUInt32BE(1,22);await assert.rejects(changeAudioSpeed(bytes,.8),/长度|帧/);
});

test('WAV preflight rejects mismatched codec block sizes and multiple data chunks',()=>{
 const valid=Buffer.from(encodeWav([new Float32Array(8000)],8000)),bad=Buffer.from(valid);bad.writeUInt16LE(1,32);assert.throws(()=>audioShape(bad),/WAV/);const extra=Buffer.concat([valid,valid.subarray(36)]);extra.writeUInt32LE(extra.length-8,4);assert.throws(()=>audioShape(extra),/WAV/);
});
