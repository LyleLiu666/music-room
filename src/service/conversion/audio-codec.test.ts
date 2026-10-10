import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeNativeWav } from './audio-codec.ts';
import { encodeWav } from '../../wav.ts';
function extensible(float = false) {
  const bits = float ? 32 : 16, size = bits / 8 * 4, b = Buffer.alloc(68 + size);
  b.write('RIFF'); b.writeUInt32LE(b.length - 8, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(40, 16);
  b.writeUInt16LE(0xfffe, 20); b.writeUInt16LE(2, 22); b.writeUInt32LE(44100, 24); b.writeUInt32LE(44100 * bits / 4, 28); b.writeUInt16LE(bits / 4, 32); b.writeUInt16LE(bits, 34);
  b.writeUInt16LE(22, 36); b.writeUInt16LE(bits, 38); b.writeUInt32LE(3, 40); Buffer.from(`${float ? '03' : '01'}00000000001000800000aa00389b71`, 'hex').copy(b, 44);
  b.write('data', 60); b.writeUInt32LE(size, 64);
  [.25,-.5,.75,-.25].forEach((x,i) => float ? b.writeFloatLE(x,68+i*4) : b.writeInt16LE(Math.round(x*32768),68+i*2));
  return b;
}
test('Core Audio extensible PCM preserves distinct stereo channels and canonical reencoding',async()=>{
  const a=await decodeNativeWav(extensible());assert.equal(a.sampleRate,44100);assert.equal(a.channelData.length,2);
  assert.ok(Math.abs(a.channelData[0][0]-.25)<.0001);assert.equal(a.channelData[1][0],-.5);assert.ok(a.channelData[0][1]>.74);assert.equal(a.channelData[1][1],-.25);
  const canonical=Buffer.from(encodeWav(a.channelData,a.sampleRate));assert.equal(canonical.readUInt16LE(20),1);assert.equal((await decodeNativeWav(canonical)).channelData[0].length,2);
});
test('extensible float accepts only the IEEE float subtype GUID',async()=>{
  const a=await decodeNativeWav(extensible(true));assert.equal(a.channelData[0][0],.25);assert.equal(a.channelData[1][0],-.5);
  const unsupported=extensible();unsupported[59]^=1;await assert.rejects(decodeNativeWav(unsupported),/GUID/);
});
test('reject damaged chunks, incomplete frames, and mismatched extension fields',async()=>{
  for(const mutate of [(b:Buffer)=>b.writeUInt32LE(10000,64),(b:Buffer)=>b.writeUInt32LE(7,64),(b:Buffer)=>b.writeUInt16LE(21,36),(b:Buffer)=>b.writeUInt16LE(15,38),(b:Buffer)=>b.writeUInt16LE(3,32)]){const b=extensible();mutate(b);await assert.rejects(decodeNativeWav(b));}
  await assert.rejects(decodeNativeWav(extensible().subarray(0,70)));
});
test('odd-sized ancillary chunks respect RIFF padding',async()=>{
  const original=extensible(),b=Buffer.concat([original.subarray(0,60),Buffer.from([74,85,78,75,1,0,0,0,123,0]),original.subarray(60)]);b.writeUInt32LE(b.length-8,4);
  assert.equal((await decodeNativeWav(b)).channelData[1][0],-.5);
});
