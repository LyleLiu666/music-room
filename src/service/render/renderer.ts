import { MPEGDecoder } from 'mpg123-decoder';
import wavDecoder from 'wav-decoder';
import { SAMPLE_GROUPS, synthesizeVoice } from '../../audio/voices.ts';
import { TRACKS, type TrackId, type Score } from '../../music/score.ts';
import { encodeWav } from '../../wav.ts';
import { ServiceError } from '../projects/store.ts';
export type RenderMix = { volume:number; lead:'piano'|'rhodes'|'flute'; levels:Partial<Record<TrackId,number>>; muted:TrackId[]; solo:TrackId[] };
export type AssetReader = (path:string)=>Promise<Uint8Array>;
const ids = new Set(TRACKS.map(t=>t.id));
export function validateMix(input: unknown = {}): RenderMix {
  const x = input as Partial<RenderMix>;
  const invalid = ()=>{throw new ServiceError('INVALID_MIX','混音参数无效（音量 0–1、轨道增益 0–2、现有音色与轨道）');};
  if (!x || typeof x!=='object' || Array.isArray(x) || Object.keys(x).some(k=>!['volume','lead','levels','muted','solo'].includes(k))) invalid();
  const m: RenderMix = {volume:x.volume??.85,lead:x.lead??'piano',levels:x.levels??{},muted:x.muted??[],solo:x.solo??[]};
  if (!Number.isFinite(m.volume) || m.volume<0 || m.volume>1 || !['piano','rhodes','flute'].includes(m.lead)
    || !m.levels || typeof m.levels!=='object' || Array.isArray(m.levels)
    || Object.entries(m.levels).some(([k,v])=>!ids.has(k as TrackId) || typeof v!=='number' || !Number.isFinite(v) || v<0 || v>2)
    || [m.muted,m.solo].some(a=>!Array.isArray(a)||a.some(id=>!ids.has(id)))) invalid();
  return structuredClone(m);
}
type Sample = {root:number;rate:number;channels:Float32Array[]};
async function loadBank(read:AssetReader) {
  const bank = new Map<string,Sample[]>(), decoder = new MPEGDecoder(); await decoder.ready;
  try {
    for (const [kind,entries] of Object.entries(SAMPLE_GROUPS)) {
      const samples: Sample[]=[];
      for (const [name,root] of entries) {
        const bytes = await read(`samples/${kind}-${name}.${kind==='piano'?'mp3':'wav'}`);
        if (kind==='piano') {
          const value = decoder.decode(bytes);
          if (value.errors.length || !value.samplesDecoded) throw new Error(`MP3 音色解码失败：${name}`);
          samples.push({root,rate:value.sampleRate,channels:value.channelData}); await decoder.reset();
        } else {
          const value = await wavDecoder.decode(Uint8Array.from(bytes).buffer);
          samples.push({root,rate:value.sampleRate,channels:value.channelData});
        }
      }
      bank.set(kind,samples);
    }
  } finally { decoder.free(); }
  return bank;
}
/** Sample-based PCM renderer. No browser globals/native binaries. DSP differs from Web Audio. */
export async function renderScore(score: Score, read:AssetReader, input:unknown = {}, progress:(stage:string)=>void = ()=>{}) {
  const mix = validateMix(input), rate=44100, frames=Math.round(score.duration*rate);
  const cost = score.notes.reduce((sum,n)=>sum+Math.min(n.duration*60/score.bpm+1.25,12)*rate,0);
  if (cost>1_000_000_000) throw new ServiceError('RENDER_LIMIT','该编曲计算量超过基础渲染器上限，请拆分片段或减少长音重叠');
  progress('加载音色'); const bank=await loadBank(read), synth=new Map<string,Sample>();
  const left=new Float32Array(frames),right=new Float32Array(frames),wetL=new Float32Array(frames),wetR=new Float32Array(frames);
  for (const track of TRACKS) {
    if (mix.muted.includes(track.id) || mix.solo.length && !mix.solo.includes(track.id)) continue;
    progress(`渲染 ${track.name}`);
    const a=new Float32Array(frames),b=new Float32Array(frames);
    const pL=Math.cos((track.pan+1)*Math.PI/4),pR=Math.sin((track.pan+1)*Math.PI/4),fader=track.gain*(mix.levels[track.id]??1);
    for (const note of score.notes.filter(n=>n.track===track.id)) {
      const kind=track.id==='melody'?mix.lead:track.id;
      const group=bank.get(kind); let sample: Sample;
      if (group) sample=group.reduce((a,b)=>Math.abs(a.root-note.pitch)<=Math.abs(b.root-note.pitch)?a:b);
      else {
        const key=`${kind}:${note.pitch}`;
        if (!synth.has(key)) synth.set(key,{root:note.pitch,rate,channels:[synthesizeVoice(kind,note.pitch,rate)]}); sample=synth.get(key)!;
      }
      const ratio=2**((note.pitch-sample.root)/12)*sample.rate/rate;
      const duration=note.duration*60/score.bpm;
      const release=kind==='piano'?.7:kind==='strings'?.38:kind==='flute'?.09:kind==='rhodes'?.26:kind==='pluck'?.6:kind==='cymbal'?1.25:.055;
      const attack=kind==='strings'?.15:kind==='flute'?.035:.003;
      const start=Math.round(note.beat*60/score.bpm*rate),length=Math.min(Math.ceil((duration+release)*rate),Math.floor((sample.channels[0].length-1)/ratio),frames-start);
      const velocity=note.velocity**1.35*fader;
      const chL=sample.channels[0],chR=sample.channels[1]??chL;
      for(let i=0;i<length;i++) {
        const t=i/rate,pos=i*ratio,index=Math.floor(pos),fraction=pos-index;
        const envelope=velocity*Math.min(1,t/attack)*(t<=duration?1:Math.exp(-6*(t-duration)/release));
        a[start+i]+=(chL[index]+(chL[index+1]-chL[index])*fraction)*envelope*pL;
        b[start+i]+=(chR[index]+(chR[index+1]-chR[index])*fraction)*envelope*pR;
      }
    }
    // Lowpass and sends in a bounded linear pass, preserving a separate stereo wet bus.
    const cutoff=track.id==='bass'?1600:track.id==='rhodes'?6000:15500,alpha=1-Math.exp(-2*Math.PI*cutoff/rate);
    let loL=0,loR=0;
    for(let i=0;i<frames;i++) {loL+=alpha*(a[i]-loL);loR+=alpha*(b[i]-loR);left[i]+=loL;right[i]+=loR;wetL[i]+=loL*track.send;wetR[i]+=loR*track.send;}
  }
  progress('混音与编码');
  // Four damped comb delays give deterministic room ambience without a convolution engine.
  for(const [channel,wet] of [[left,wetL],[right,wetR]]) {
    for(const delay of [.0297,.0371,.0411,.0437]) {
      const size=Math.round(delay*rate),ring=new Float32Array(size); let low=0;
      for(let i=0;i<frames;i++) {const at=i%size,v=ring[at];low+=.35*(v-low);ring[at]=wet[i]*.14+low*.69;channel[i]+=v;}
    }
  }
  let peak=0,sum=0;
  const hp=Math.exp(-2*Math.PI*28/rate),fade=Math.min(1.5,score.duration/4);
  for(const channel of [left,right]) {
    let prev=0,state=0;
    for(let i=0;i<frames;i++) {const raw=channel[i];state=hp*(state+raw-prev);prev=raw;const gain=mix.volume*Math.min(1,(frames-i)/(fade*rate));channel[i]=Math.tanh(state*.85)/.85*gain;peak=Math.max(peak,Math.abs(channel[i]));}
  }
  const attenuation=peak>.89?.89/peak:1;
  for(const channel of [left,right]) for(let i=0;i<frames;i++) {channel[i]*=attenuation;sum+=channel[i]**2;}
  return {wav:new Uint8Array(encodeWav([left,right],rate)),peak:peak*attenuation,rms:Math.sqrt(sum/(2*frames)),attenuation,engine:'sample-pcm-v1'};
}
