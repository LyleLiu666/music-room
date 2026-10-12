import {Mp3Encoder} from '@breezystack/lamejs';
import {setImmediate} from 'node:timers/promises';
import {decodeAudio} from './decode-audio.ts';
/** Encode in bounded blocks and yield so playback, cancellation and other requests remain responsive. */
export async function exportMp3(bytes:Uint8Array,signal?:AbortSignal):Promise<Uint8Array>{
 const {sampleRate,channelData}=await decodeAudio(bytes,signal,1200);
 const encoder=new Mp3Encoder(channelData.length,sampleRate,192),parts:Uint8Array[]=[];
 for(let at=0;at<channelData[0].length;at+=1152){
  signal?.throwIfAborted();
  const pcm=channelData.map(c=>Int16Array.from(c.subarray(at,at+1152),x=>Math.round(Math.max(-1,Math.min(1,x))*(x<0?32768:32767))));
  const part=encoder.encodeBuffer(pcm[0],pcm[1]);if(part.length)parts.push(new Uint8Array(part));
  if(at%(1152*16)===0)await setImmediate();
 }
 signal?.throwIfAborted();parts.push(new Uint8Array(encoder.flush()));return Buffer.concat(parts);
}
