import {encodeWav} from '../../wav.ts';
import {ServiceError} from '../projects/store.ts';

export const liveFramesPerSecond=48000;
const bytesPerFrame=4;
const captureFrames=15*liveFramesPerSecond;
const capacity=24*liveFramesPerSecond;

export type LiveBlock={offset:number;pcm:Uint8Array;fromMix:number;toMix:number};
export class LiveRing {
 private blocks:LiveBlock[]=[];
 private nextOffset=0;
 get end(){return this.nextOffset;}
 get retainedFrames(){return this.end-(this.blocks[0]?.offset??this.end);}
 append(pcm:Uint8Array,fromMix=0,toMix=0){
  if(pcm.byteLength!==liveFramesPerSecond*bytesPerFrame)throw Error('实时推理的 PCM 长度无效');
  const block={offset:this.nextOffset,pcm:pcm.slice(),fromMix,toMix};
  this.blocks.push(block);
  this.nextOffset+=pcm.length/bytesPerFrame;
  while(this.retainedFrames>capacity)this.blocks.shift();
  return block;
 }
 get(offset:number){return this.blocks.find(block=>block.offset===offset);}
 capture(heardFrame:number){
  if(!Number.isSafeInteger(heardFrame)||heardFrame>this.end)throw new ServiceError('INVALID_AUDIO','播放位置还没有生成');
  const start=heardFrame-captureFrames;
  if(start<0)throw new ServiceError('INVALID_AUDIO','听满 15 秒后即可留下刚才这段');
  if(start<this.end-this.retainedFrames)throw new ServiceError('CAPTURE_EXPIRED','播放位置已超出回留范围');
  const stereo=[new Float32Array(captureFrames),new Float32Array(captureFrames)];
  for(const block of this.blocks){
   const from=Math.max(start,block.offset),to=Math.min(heardFrame,block.offset+block.pcm.length/4);
   if(to<=from)continue;
   const pcm=new DataView(block.pcm.buffer,block.pcm.byteOffset,block.pcm.byteLength);
   for(let i=from;i<to;i++)for(let c=0;c<2;c++){
    const value=pcm.getInt16((i-block.offset)*4+c*2,true);
    stereo[c][i-start]=value/(value<0?32768:32767);
   }
  }
  return new Uint8Array(encodeWav(stereo,liveFramesPerSecond));
 }
}
