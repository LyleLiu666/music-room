import test from 'node:test';
import assert from 'node:assert/strict';
import {audioShape,speedPeak} from './audio-budget.ts';
import {ServiceError} from '../projects/store.ts';
function wav(rate=8000,channels=1,bits=16,frames=1,format=1){
 const block=channels*bits/8,data=frames*block,b=Buffer.alloc(44+data+(data%2));
 b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(format,20);b.writeUInt16LE(channels,22);b.writeUInt32LE(rate,24);b.writeUInt32LE(rate*block,28);b.writeUInt16LE(block,32);b.writeUInt16LE(bits,34);b.write('data',36);b.writeUInt32LE(data,40);return b;
}
test('WAV format boundary matrix: rates, channels, integer/float encodings and one-frame input',()=>{
 for(const rate of [8000,44100,48000,96000])for(const channels of [1,2])for(const [format,bits] of [[1,8],[1,16],[1,24],[1,32],[3,32],[3,64]]){
  const b=wav(rate,channels,bits,1,format);assert.deepEqual(audioShape(b),{rate,channels,frames:1});assert.ok(speedPeak(b,.5)>speedPeak(b,2));
 }
 for(const args of [[7999,1],[96001,1],[8000,3],[8000,1,16,0],[8000,1,12],[8000,1,16,1,3],[8000,1,16,1,6]])assert.throws(()=>audioShape(wav(...args)),ServiceError);
 assert.equal(audioShape(wav(8000,1,16,8000*600)).frames,8000*600);
 assert.throws(()=>audioShape(wav(8000,1,16,8000*600+1)),ServiceError);
});
test('WAV malformed containers reject partial headers, contradictory lengths and missing padding',()=>{
 const base=wav();for(let end=0;end<base.length;end++)assert.throws(()=>audioShape(base.subarray(0,end)),ServiceError);
 const badRate=Buffer.from(base);badRate.writeUInt32LE(1,28);assert.throws(()=>audioShape(badRate),ServiceError);
 for(let extra=1;extra<8;extra++){const b=Buffer.concat([base,Buffer.alloc(extra)]);b.writeUInt32LE(b.length-8,4);assert.throws(()=>audioShape(b),ServiceError);}
 const odd=wav(8000,1,8).subarray(0,45);odd.writeUInt32LE(odd.length-8,4);assert.throws(()=>audioShape(odd),ServiceError);
});
test('seeded header corruption is bounded and never leaks a raw parser exception',()=>{
 let seed=20261023;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
 for(let n=0;n<500;n++){
  const b=wav(44100,2,16,4);for(let i=0;i<1+n%5;i++)b[random()%44]=random()%256;
  try{const shape=audioShape(b);assert.ok(shape.frames>0&&shape.frames/shape.rate<=600&&[1,2].includes(shape.channels));}
  catch(error){assert.ok(error instanceof ServiceError,`unexpected parser exception: ${error}`);}
 }
});
