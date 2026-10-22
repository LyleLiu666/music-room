import test from 'node:test';
import assert from 'node:assert/strict';
import {readAudioBlob} from './audio-response.ts';

test('audio reads preserve exact bytes and media type without using browser response Blob storage',async()=>{
 const response=new Response(new Uint8Array([1,2,3]),{headers:{'content-type':'audio/flac'}});
 response.blob=async()=>{throw new TypeError('Failed to fetch');};
 const blob=await readAudioBlob(response);assert.equal(blob.type,'audio/flac');assert.deepEqual(new Uint8Array(await blob.arrayBuffer()),new Uint8Array([1,2,3]));
});
test('declared or streamed overflow is cancelled before retaining a complete oversized audio file',async()=>{
 for(const declared of [false,true]){
  let cancelled=false;const response=new Response(new ReadableStream({start(controller){controller.enqueue(new Uint8Array(8));},cancel(){cancelled=true;}}),{headers:declared?{'content-length':'8'}:{}});
  await assert.rejects(readAudioBlob(response,4),/超出/);assert.equal(cancelled,true);
 }
 await assert.rejects(readAudioBlob(new Response()),/为空/);
 await assert.rejects(readAudioBlob(new Response(new Uint8Array())),/为空/);
});
