type AudioBlock={offset:number;pcm:string;fromMix:number;toMix:number};
type Scheduled={offset:number;at:number;levels:number[];labels:readonly [string,string];fromMix:number;toMix:number};
const rate=48000;
const windowSeconds=24;

/** Playback time, style marker and waveform come from the same scheduled PCM. */
export class LiveAudio {
 readonly context:AudioContext;
 private scheduled:Scheduled[]=[];
 private submitted=0;
 private heard=0;
 private readonly sources=new Set<AudioBufferSourceNode>();
 constructor(){this.context=new AudioContext({sampleRate:rate,latencyHint:'interactive'});}
 get end(){return this.submitted;}
 get buffered(){
  const last=this.scheduled.at(-1);
  return last?Math.max(0,last.at+1-this.context.currentTime):0;
 }
 push(block:AudioBlock,labels:readonly [string,string]){
  if(block.offset!==this.submitted)throw Error('实时音频块顺序不连续');
  const bytes=Uint8Array.from(atob(block.pcm),character=>character.charCodeAt(0));
  if(bytes.length!==rate*4)throw Error('实时音频块长度无效');
  const pcm=new DataView(bytes.buffer),buffer=this.context.createBuffer(2,rate,rate),left=buffer.getChannelData(0),right=buffer.getChannelData(1);
  const levels=new Array<number>(10).fill(0);
  for(let i=0;i<rate;i++){
   left[i]=pcm.getInt16(i*4,true)/32768;right[i]=pcm.getInt16(i*4+2,true)/32768;
   const level=Math.floor(i/4800);levels[level]=Math.max(levels[level],Math.abs(left[i]),Math.abs(right[i]));
  }
  const now=this.context.currentTime,last=this.scheduled.at(-1);
  const at=last&&last.at+1>now+.02?last.at+1:now+.085;
  const source=this.context.createBufferSource();source.buffer=buffer;source.connect(this.context.destination);
  this.sources.add(source);
  source.onended=()=>{source.disconnect();this.sources.delete(source);};
  source.start(at);
  this.scheduled.push({offset:block.offset,at,levels,labels,fromMix:block.fromMix,toMix:block.toMix});
  if(this.scheduled.length>windowSeconds)this.scheduled.shift();
  this.submitted+=rate;
 }
 frame(){
  const ctx=this.context,hardware=ctx.getOutputTimestamp?.().contextTime;
  const time=hardware&&Number.isFinite(hardware)?hardware:Math.max(0,ctx.currentTime-(ctx.baseLatency||.05)-(ctx.outputLatency||.04));
  for(const chunk of this.scheduled){
   if(time<chunk.at)break;
   this.heard=Math.max(this.heard,chunk.offset+Math.min(rate,Math.floor((time-chunk.at)*rate)));
  }
  return this.heard;
 }
 visual(){
  const heard=this.frame(),samples:number[]=[];
  let mix=0,labels:Scheduled['labels']|undefined;const trail:number[]=[];
  for(const block of this.scheduled){
   if(block.offset>=heard)break;
   const fraction=Math.min(1,(heard-block.offset)/rate);
   samples.push(...block.levels.slice(0,Math.floor(fraction*10)));
   mix=block.fromMix+(block.toMix-block.fromMix)*fraction;labels=block.labels;
   if(fraction===1&&trail.at(-1)!==mix)trail.push(mix);
  }
  return {heard,mix,labels,trail:trail.slice(-3),levels:samples.slice(-windowSeconds*10)};
 }
 async close(){
  for(const source of this.sources){source.stop();source.disconnect();}
  this.sources.clear();
  if(this.context.state!=='closed')await this.context.close();
 }
}
