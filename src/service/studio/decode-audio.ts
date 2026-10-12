import CodecParser,{type CodecFrame} from 'codec-parser';
import {audioShape} from './audio-budget.ts';
import wavDecoder from 'wav-decoder';
import {FLACDecoder} from '@wasm-audio-decoders/flac';
import {setImmediate} from 'node:timers/promises';
import {ServiceError} from '../projects/store.ts';

export async function decodeAudio(bytes:Uint8Array,signal?:AbortSignal,maxSeconds=600){
 signal?.throwIfAborted();
 const shape=audioShape(bytes,maxSeconds);let decoded:{sampleRate:number;channelData:Float32Array[]};
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
 return {sampleRate,channelData};
}
