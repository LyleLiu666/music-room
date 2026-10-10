import CodecParser,{type CodecFrame} from 'codec-parser';
import {audioShape,speedPeak} from './audio-budget.ts';
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
export async function changeAudioSpeed(bytes:Uint8Array,rate:number,signal?:AbortSignal,budget=Number.MAX_SAFE_INTEGER):Promise<Uint8Array>{
 validateSpeed(rate);signal?.throwIfAborted();if(speedPeak(bytes,rate)>budget)throw new ServiceError('INSUFFICIENT_CAPACITY','调速音频超过内存预算');
 const shape=audioShape(bytes);let decoded:{sampleRate:number;channelData:Float32Array[]};
 if(Buffer.from(bytes.subarray(0,4)).toString()==='fLaC'){
  const decoder=new FLACDecoder();
  try{await decoder.ready;const parser=new CodecParser<CodecFrame>('audio/flac',{enableLogging:false}),channelData=Array.from({length:shape.channels},()=>new Float32Array(shape.frames));let frames=0,blocks=0;
   const consume=async(iterator:Iterator<CodecFrame>)=>{for(let item=iterator.next();!item.done;item=iterator.next()){signal?.throwIfAborted();const frame=item.value;if(!Number.isSafeInteger(frame.samples)||frame.samples<1||frame.samples>65535||frames+frame.samples>shape.frames||frame.header.channels!==shape.channels||frame.header.sampleRate!==shape.rate)throw new ServiceError('INVALID_AUDIO','FLAC 帧长度或格式与声明不一致');const result=await decoder.decodeFrames([frame.data]);if(result.errors.length||result.samplesDecoded!==frame.samples||result.channelData.length!==shape.channels||result.sampleRate!==shape.rate)throw new ServiceError('INVALID_AUDIO','FLAC 帧解码长度或格式无效');for(let c=0;c<shape.channels;c++){if(result.channelData[c].length!==frame.samples)throw new ServiceError('INVALID_AUDIO','FLAC 帧长度无效');channelData[c].set(result.channelData[c],frames);}frames+=frame.samples;if(++blocks%64===0)await setImmediate();}};
   for(let at=0;at<bytes.length;at+=65536)await consume(parser.parseChunk(bytes.subarray(at,at+65536)));await consume(parser.flush());if(frames!==shape.frames)throw new ServiceError('INVALID_AUDIO','FLAC 实际长度与声明不一致');decoded={sampleRate:shape.rate,channelData};
  }finally{decoder.free();}
 }else decoded=await wavDecoder.decode(new Uint8Array(bytes).buffer);
 signal?.throwIfAborted();
 const {sampleRate,channelData}=decoded,frames=channelData[0]?.length??0;
 if(frames!==shape.frames||sampleRate!==shape.rate||channelData.length!==shape.channels||!frames||![1,2].includes(channelData.length)||sampleRate<8000||sampleRate>96000||channelData.some(c=>c.length!==frames))throw new ServiceError('INVALID_AUDIO','暂不支持此音频的声道或采样率');
 const outputFrames=Math.round(frames/rate),channels=channelData.map(()=>new Float32Array(outputFrames));
 const stretch=new Stretch({sampleRate,createBuffers:true});stretch.tempo=rate;
 const input=stretch.inputBuffer!,output=stretch.outputBuffer!;
 const chunkFrames=4096,chunk=new Float32Array(chunkFrames*2);
 let written=0;
 // Feed bounded chunks, then enough silence to drain the algorithm's lookahead.
 // Crop only the padded tail to the requested duration, preserving final words.
 for(let offset=0;written<outputFrames;offset+=chunkFrames){
  if(offset>frames+sampleRate*2)throw new Error('调速处理未能完成');
  signal?.throwIfAborted();chunk.fill(0);
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
 signal?.throwIfAborted();return new Uint8Array(encodeWav(channels,sampleRate));
}
