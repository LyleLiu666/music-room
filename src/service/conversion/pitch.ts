import {SoundTouch} from '@soundtouchjs/core';
import {setImmediate} from 'node:timers/promises';
import {SR} from './audio.ts';

/** Shift melodic stems at fixed tempo. Drum samples bypass the processor unchanged. */
export async function shiftBackingStem(stem:'drums'|'bass'|'other',channels:Float32Array[],semitones:number,signal?:AbortSignal):Promise<Float32Array[]>{
 if(!Number.isInteger(semitones)||Math.abs(semitones)>12)throw Error('升降调必须为 -12 至 12 之间的整数半音');
 signal?.throwIfAborted();
 const frames=channels[0]?.length??0;
 if(!frames||![1,2].includes(channels.length)||channels.some(c=>c.length!==frames))throw Error('伴奏声道或长度无效');
 if(stem==='drums'||semitones===0)return channels;
 const processor=new SoundTouch({sampleRate:SR});processor.pitchSemitones=semitones;
 processor.setStretchParameters({sequenceMs:40,seekWindowMs:8,overlapMs:8,quickSeek:false});
 const output=channels.map(()=>new Float32Array(frames)),chunkFrames=4096,chunk=new Float32Array(chunkFrames*2);
 let written=0;
 try{
  // Pad lookahead with silence, then keep precisely the original number of frames.
  for(let offset=0;written<frames;offset+=chunkFrames){
   signal?.throwIfAborted();if(offset>frames+SR*2)throw Error('伴奏升降调处理未能完成');
   chunk.fill(0);
   for(let i=0;i<chunkFrames&&offset+i<frames;i++){chunk[i*2]=channels[0][offset+i];chunk[i*2+1]=(channels[1]??channels[0])[offset+i];}
   processor.inputBuffer.putSamples(chunk);processor.process();
   const count=Math.min(processor.outputBuffer.frameCount,frames-written),processed=new Float32Array(count*2);
   processor.outputBuffer.extract(processed,0,count);processor.outputBuffer.receive(count);
   for(let i=0;i<count;i++)for(let c=0;c<output.length;c++){const sample=processed[i*2+c];if(!Number.isFinite(sample))throw Error('升降调产生无效采样');output[c][written+i]=sample;}
   written+=count;
   if(offset%(chunkFrames*16)===0)await setImmediate();
  }
  return output;
 }finally{processor.clear();}
}
