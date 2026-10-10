import {Stretch} from '@soundtouchjs/core';
import wavDecoder from 'wav-decoder';
import {FLACDecoder} from '@wasm-audio-decoders/flac';
import {setImmediate} from 'node:timers/promises';
import {encodeWav} from '../../wav.ts';
import {ServiceError} from '../projects/store.ts';

export type SpeedEdit={rate:number;sourceVersionId:string;requestId:string};
export function validateSpeed(rate:number){
 if(!Number.isFinite(rate)||rate<.5||rate>2||rate===1)throw new ServiceError('INVALID_SPEED','请选择 0.5–2.0 倍之间、不同于 1.0 倍的速度');
}

/** WSOLA changes duration without changing sample rate or musical pitch. */
export async function changeAudioSpeed(bytes:Uint8Array,rate:number):Promise<Uint8Array>{
 validateSpeed(rate);
 let decoded:{sampleRate:number;channelData:Float32Array[]};
 if(Buffer.from(bytes.subarray(0,4)).toString()==='fLaC'){
  const decoder=new FLACDecoder();
  try{await decoder.ready;const result=await decoder.decodeFile(bytes);if(result.errors.length)throw new Error('FLAC 音频解码失败');decoded=result;}finally{decoder.free();}
 }else decoded=await wavDecoder.decode(new Uint8Array(bytes).buffer);
 const {sampleRate,channelData}=decoded,frames=channelData[0]?.length??0;
 if(!frames||![1,2].includes(channelData.length)||sampleRate<8000||sampleRate>96000||channelData.some(c=>c.length!==frames))throw new ServiceError('INVALID_AUDIO','暂不支持此音频的声道或采样率');
 const outputFrames=Math.round(frames/rate),channels=channelData.map(()=>new Float32Array(outputFrames));
 const stretch=new Stretch({sampleRate,createBuffers:true});stretch.tempo=rate;
 const input=stretch.inputBuffer!,output=stretch.outputBuffer!;
 const chunkFrames=4096,chunk=new Float32Array(chunkFrames*2);
 let written=0;
 // Feed bounded chunks, then enough silence to drain the algorithm's lookahead.
 // Crop only the padded tail to the requested duration, preserving final words.
 for(let offset=0;written<outputFrames;offset+=chunkFrames){
  if(offset>frames+sampleRate*2)throw new Error('调速处理未能完成');
  chunk.fill(0);
  for(let i=0;i<chunkFrames&&offset+i<frames;i++){
   chunk[i*2]=channelData[0][offset+i];chunk[i*2+1]=(channelData[1]??channelData[0])[offset+i];
  }
  input.putSamples(chunk);stretch.process();
  const count=Math.min(output.frameCount,outputFrames-written),processed=new Float32Array(count*2);
  output.extract(processed,0,count);output.receive(count);
  for(let i=0;i<count;i++)for(let c=0;c<channels.length;c++)channels[c][written+i]=processed[i*2+c];
  written+=count;
  if(offset%(chunkFrames*16)===0)await setImmediate();
 }
 return new Uint8Array(encodeWav(channels,sampleRate));
}
