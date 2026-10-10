import test from 'node:test';
import assert from 'node:assert/strict';
import decoder from 'wav-decoder';
import {changeAudioSpeed} from './speed.ts';
import {encodeWav} from '../../wav.ts';

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
