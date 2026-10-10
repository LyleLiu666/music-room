import test from 'node:test';import assert from 'node:assert/strict';import {readReferenceWav} from './reference-file.ts';import {encodeWav} from '../../wav.ts';
test('reference preflight rejects compression and excessive decoded duration before reading the full source',async()=>{
 const valid=Buffer.from(encodeWav([Float32Array.from({length:8000},()=>.2)],8000));assert.equal((await readReferenceWav(new Blob([valid]))).byteLength,valid.length);const compressed=Buffer.from(valid);compressed.writeUInt16LE(17,20);await assert.rejects(readReferenceWav(new Blob([compressed])),/PCM WAV/);const long=Buffer.from(valid);long.writeUInt32LE(100_000_036,4);long.writeUInt32LE(100_000_000,40);let fullReads=0;const fake={size:100_000_044,slice:()=>new Blob([long]),arrayBuffer:async()=>{fullReads++;return long.buffer;}} as unknown as Blob;await assert.rejects(readReferenceWav(fake),/50 MiB/);assert.equal(fullReads,0);
 const padded=Buffer.from(valid);padded.writeUInt32LE(10_000_036,4);padded.writeUInt32LE(10_000_000,40);const longPCM={size:10_000_044,slice:()=>new Blob([padded]),arrayBuffer:async()=>{fullReads++;return padded.buffer;}} as unknown as Blob;await assert.rejects(readReferenceWav(longPCM),/10 分钟/);assert.equal(fullReads,0);
});

test('reference preflight rejects extra data and duplicate format chunks before full browser decode',async()=>{
 const valid=Buffer.from(encodeWav([Float32Array.from({length:8000},()=>.2)],8000)),extra=Buffer.concat([valid,valid.subarray(36)]);extra.writeUInt32LE(extra.length-8,4);let reads=0;const file={size:extra.length,slice:()=>new Blob([extra]),arrayBuffer:async()=>{reads++;return extra.buffer;}} as unknown as Blob;await assert.rejects(readReferenceWav(file),/PCM WAV/);assert.equal(reads,0);
 const duplicate=Buffer.concat([valid.subarray(0,36),valid.subarray(12,36),valid.subarray(36)]);duplicate.writeUInt32LE(duplicate.length-8,4);await assert.rejects(readReferenceWav(new Blob([duplicate])),/PCM WAV/);
});
