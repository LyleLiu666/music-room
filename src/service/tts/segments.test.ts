import test from 'node:test';
import assert from 'node:assert/strict';
import {speechSegments,joinSpeechWaves} from './segments.ts';
import {encodeWav} from '../../wav.ts';
import {wavInfo} from './speech.ts';
test('segmentation preserves long text, punctuation, and Unicode without splitting surrogate pairs',()=>{
 for(const text of ['句子。'.repeat(600),'文'.repeat(139)+'😀'+'文'.repeat(800),'文'.repeat(8000),'a'.repeat(140)+'\n']){const parts=speechSegments(text);assert.equal(parts.join(''),text);assert.ok(parts.every(p=>p.length<=140));assert.ok(parts.every(p=>!/[\uD800-\uDBFF]$/.test(p)&&! /^[\uDC00-\uDFFF]/.test(p)));}
 assert.throws(()=>speechSegments('文'.repeat(8001)));assert.throws(()=>speechSegments('  '));
});
test('PCM concatenation preserves samples and rejects mixed formats',()=>{
 const wave=(rate:number)=>new Uint8Array(encodeWav([new Float32Array([.1,.2])],rate));
 const joined=joinSpeechWaves([wave(22050),wave(22050)]);assert.equal(wavInfo(joined).duration,4/22050);assert.deepEqual(joined.subarray(44,48),joined.subarray(48));assert.throws(()=>joinSpeechWaves([wave(22050),wave(44100)]));
});
