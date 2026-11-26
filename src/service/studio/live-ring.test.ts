import test from 'node:test';
import assert from 'node:assert/strict';
import {LiveRing,liveFramesPerSecond} from './live-ring.ts';
import {audioShape} from './audio-budget.ts';

test('capture uses the playback cursor, including a partial block, and excludes prefetched audio',()=>{
 const ring=new LiveRing(),n=liveFramesPerSecond;
 for(let i=0;i<19;i++){const pcm=new Int16Array(n*2).fill(i+1);ring.append(new Uint8Array(pcm.buffer));}
 const wav=ring.capture(n*16+n/2);
 assert.deepEqual(audioShape(wav),{frames:n*15,channels:2,rate:n});
 const b=Buffer.from(wav);assert.equal(b.readInt16LE(44),2);assert.equal(b.readInt16LE(b.length-2),17);
 assert.throws(()=>ring.capture(14*n),/15 秒/);
 assert.throws(()=>ring.capture(20*n),/播放位置/);
});
test('bounded ring rejects audio that aged out of the last playback window',()=>{
 const ring=new LiveRing(),n=liveFramesPerSecond;
 for(let i=0;i<40;i++)ring.append(new Uint8Array(n*4));
 assert.ok(ring.retainedFrames<=n*24);
 assert.throws(()=>ring.capture(18*n),/超出回留范围/);
});

test('explicit recording retains the selected start beyond the rolling window and excludes future audio',()=>{
 const ring=new LiveRing(),n=liveFramesPerSecond;
 ring.recordFrom(n/2);
 for(let i=0;i<42;i++)ring.append(new Uint8Array(new Int16Array(n*2).fill(i+1).buffer));
 const wav=ring.capture(40*n+n/2,n/2);
 assert.deepEqual(audioShape(wav),{frames:n*40,channels:2,rate:n});
 const b=Buffer.from(wav);assert.equal(b.readInt16LE(44),1);assert.equal(b.readInt16LE(b.length-2),41);
 assert.throws(()=>ring.capture(n/2,n/2),/录制/);
});
