import {z} from 'zod';
import {decodeAudio} from './decode-audio.ts';
import {encodeWav} from '../../wav.ts';
import {ServiceError} from '../projects/store.ts';

export const trimOptions={startSeconds:z.number().finite().nonnegative(),endSeconds:z.number().finite().positive(),fadeInMs:z.number().finite().min(0).max(500).default(30),fadeOutMs:z.number().finite().min(0).max(500).default(30),requestId:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/)};
export type TrimOptions={startSeconds:number;endSeconds:number;fadeInMs:number;fadeOutMs:number;requestId:string};

/** Sample-accurate WAV output with independent, bounded fades and no change to the source. */
export async function trimAudio(bytes:Uint8Array,options:TrimOptions,signal?:AbortSignal,maxSeconds=30){
 const {sampleRate,channelData}=await decodeAudio(bytes,signal,maxSeconds),length=channelData[0].length;
 const start=Math.round(options.startSeconds*sampleRate),end=Math.round(options.endSeconds*sampleRate);
 const fadeIn=Math.round(options.fadeInMs*sampleRate/1000),fadeOut=Math.round(options.fadeOutMs*sampleRate/1000),frames=end-start;
 if(!Number.isFinite(options.startSeconds)||!Number.isFinite(options.endSeconds)||options.startSeconds<0||options.endSeconds>length/sampleRate||end>length||frames<1)throw new ServiceError('INVALID_AUDIO','请选择音频范围内有效的起止时间');
 if(!Number.isFinite(options.fadeInMs)||!Number.isFinite(options.fadeOutMs)||fadeIn<0||fadeOut<0||fadeIn+fadeOut>frames)throw new ServiceError('INVALID_AUDIO','淡入与淡出总时长不能超过截取长度');
 const result=channelData.map(source=>{
  const samples=source.slice(start,end);
  if(samples.some(value=>!Number.isFinite(value)))throw new ServiceError('INVALID_AUDIO','音频包含无效采样');
  for(let i=0;i<fadeIn;i++)samples[i]*=fadeIn===1?0:i/(fadeIn-1);
  for(let i=0;i<fadeOut;i++)samples[frames-fadeOut+i]*=fadeOut===1?0:(fadeOut-1-i)/(fadeOut-1);
  return samples;
 });
 return {bytes:new Uint8Array(encodeWav(result,sampleRate)),duration:frames/sampleRate};
}
