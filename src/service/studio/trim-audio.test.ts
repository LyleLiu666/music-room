import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeWav} from '../../wav.ts';
import {decodeAudio} from './decode-audio.ts';
import {trimAudio} from './trim-audio.ts';

test('a stereo segment has sample-accurate boundaries, smooth ends and unchanged interior',async()=>{
 const rate=44100,source=new Uint8Array(encodeWav([new Float32Array(rate*3).fill(.4),new Float32Array(rate*3).fill(-.2)],rate));
 const result=await trimAudio(source,{startSeconds:1,endSeconds:3,fadeInMs:30,fadeOutMs:30,requestId:'trim-stereo'}),decoded=await decodeAudio(result.bytes),[left,right]=decoded.channelData;
 assert.equal(result.duration,2);assert.equal(decoded.sampleRate,rate);assert.equal(left.length,rate*2);assert.equal(right.length,left.length);
 for(const samples of [left,right]){assert.ok(Math.abs(samples[0])<1/32768);assert.ok(Math.abs(samples.at(-1)!)<1/32768);assert.ok(Math.abs(samples[400])<Math.abs(samples[800]));assert.ok(Math.abs(samples.at(-400)!)<Math.abs(samples.at(-800)!));}
 assert.ok(Math.abs(left[rate]-.4)<.0001);assert.ok(Math.abs(right[rate]+.2)<.0001);
});

test('trimming rejects out-of-range boundaries and fades that do not fit the selected segment',async()=>{
 const source=new Uint8Array(encodeWav([new Float32Array(8000).fill(.2)],8000)),base={startSeconds:0,endSeconds:1,fadeInMs:30,fadeOutMs:30,requestId:'trim-bounds'};
 for(const patch of [{startSeconds:-.1},{startSeconds:.8,endSeconds:.2},{endSeconds:1.00001},{endSeconds:.01},{fadeInMs:-1}])await assert.rejects(()=>trimAudio(source,{...base,...patch}));
 const unchanged=await trimAudio(source,{...base,fadeInMs:0,fadeOutMs:0}),decoded=await decodeAudio(unchanged.bytes);assert.ok(decoded.channelData[0][0]>.1);assert.ok(decoded.channelData[0].at(-1)!>.1);
});
