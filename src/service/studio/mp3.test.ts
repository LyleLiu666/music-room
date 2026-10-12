import CodecParser,{type CodecFrame} from 'codec-parser';
import {readFile} from 'node:fs/promises';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MPEGDecoder} from 'mpg123-decoder';
import {encodeWav} from '../../wav.ts';
import {exportMp3} from './mp3.ts';
for(const channels of [1,2])test(`MP3 ${channels} channels preserves duration and audible ending`,async()=>{
 const rate=44100,n=rate*2+731,pcm=Array.from({length:channels},(_,c)=>Float32Array.from({length:n},(_,i)=>.35*Math.sin(2*Math.PI*(440+c*220)*i/rate)));
 const wav=new Uint8Array(encodeWav(pcm,rate)),original=wav.slice(),mp3=await exportMp3(wav);
 assert.deepEqual(wav,original);assert.ok(mp3.length<wav.length);
 const decoder=new MPEGDecoder();await decoder.ready;try{const result=decoder.decode(mp3);assert.equal(result.errors.length,0);const frames=[...new CodecParser<CodecFrame>('audio/mpeg',{enableLogging:false}).parseAll(mp3)];assert.equal(frames[0].header.channels,channels);assert.ok(Math.abs(result.samplesDecoded/result.sampleRate-n/rate)<.1);const tail=result.channelData[0].slice(-5000,-2000);assert.ok(tail.some(x=>Math.abs(x)>.1));}finally{decoder.free();}
});
test('invalid audio and cancelled exports fail',async()=>{await assert.rejects(exportMp3(new Uint8Array(44)));const c=new AbortController();c.abort();await assert.rejects(exportMp3(new Uint8Array(44),c.signal));});

test('FLAC exports playable MP3 with matching duration',async()=>{const flac=new Uint8Array(await readFile(new URL('./fixtures/tone-440hz.flac',import.meta.url)));const mp3=await exportMp3(flac);const decoder=new MPEGDecoder();await decoder.ready;try{const result=decoder.decode(mp3);assert.equal(result.errors.length,0);assert.ok(Math.abs(result.samplesDecoded/result.sampleRate-2)<.1);}finally{decoder.free();}});

for(const rate of [24000,48000,96000])test(`MP3 accepts ${rate} Hz input`,async()=>{const wav=new Uint8Array(encodeWav([Float32Array.from({length:rate},(_,i)=>.2*Math.sin(i*440*2*Math.PI/rate))],rate));const decoder=new MPEGDecoder();await decoder.ready;try{const result=decoder.decode(await exportMp3(wav));assert.equal(result.errors.length,0);assert.ok(Math.abs(result.samplesDecoded/result.sampleRate-1)<.15);}finally{decoder.free();}});
test('in-flight encoding yields and honours cancellation',async()=>{const wav=new Uint8Array(encodeWav([new Float32Array(44100*3)],44100)),controller=new AbortController(),pending=exportMp3(wav,controller.signal);setTimeout(()=>controller.abort(),0);await assert.rejects(pending);});
