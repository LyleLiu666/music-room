import type {ResourceDemand} from './contracts.ts';
import {referenceModels} from '../tts/reference-models.ts';
import {cleanReferenceScript} from '../tts/reference-python.ts';
import {referenceRequirements} from '../tts/reference-requirements.ts';
import {createHash} from 'node:crypto';
export const profileVersion=2;
export const referenceProfile={id:'reference-uvr-cpu-v2',requirements:'b040bc4b52b83688072ecba398702e4d4cbe945e6abd53a07607807f96e8f8ae',models:'2dc3699abc54e84c488d4175a7fc5e9fc73ade2d3f480dadf914565e6030e974',program:'5736ca461f9d82d7ffa9f3f2c95203e13fb8f7536485cd758cfc3cb25313f835'};
export function referenceIdentity(){const hash=(value:string)=>createHash('sha256').update(value).digest('hex');return {...referenceProfile,requirements:hash(referenceRequirements),models:hash(JSON.stringify(referenceModels)),program:hash(cleanReferenceScript)};}
export const ttsProfile={id:'tts-native-f16-tail2',version:'0.9.1-music-room-tail2',program:'dfb8bc3a9d409757cc36a3cad9fa7686a2e1909fe9617aadfa11ee7b268a7d01',weights:'0f7b95d3d32e18bf9352912a7b21a0bd4a8406853a0aaa2c9180f77389c21523'};
export const yueProfile={id:'yue2-mlx-low-memory',revision:'f696147a985081848d4b0310cbe9b10b16259be6',mlx:'6781272d227d3f7010b76cfd2a9d2a960a8021fe6b41909c361361e23ba2f749',program:'cb1114b9a1cf3ad100622f78b9db783a4a87061914a02faedbdecea737cacbb2'};
export const conversionProfile={id:'seed-vc-native-f16',commit:'bd88e6eaa1d25a1ee1513e19e72e72a5de757187',program:'8d799aaf44ac2dc75db2a64e3444132b00e20d1dd3db8ba2a4144461000641ab'};
const match=(a:unknown,b:Record<string,unknown>)=>!!a&&typeof a==='object'&&Object.entries(b).every(([k,v])=>(a as any)[k]===v);
/** Evidence supports these envelopes, not arbitrary models or unbounded input. */
export function estimateResources(engine:string,input:any):ResourceDemand{
 let peak=0,verified=false;
 if(engine==='import'&&Number.isSafeInteger(input?.bytes)&&input.bytes>=0&&input.bytes<=200*2**20){peak=input.bytes*3+64*2**20;verified=true;}
 if(engine==='installation'){peak=2**30;verified=true;}
 if(engine==='render'){const seconds=input?.composition?.score?.duration;if(Number.isFinite(seconds)&&seconds>0&&seconds<=600){peak=Math.ceil(512*2**20+seconds*44100*64);verified=true;}}
 if(engine==='speed'){const seconds=input?.duration,rate=input?.rate;if(Number.isFinite(seconds)&&seconds>0&&seconds<=600&&Number.isFinite(rate)&&rate>=.5&&rate<=2){peak=Math.ceil(512*2**20+seconds*96000*2*(12+10/rate));verified=true;}}
 if(engine==='tts'&&match(input?.resourceProfile,ttsProfile)&&typeof input?.text==='string'&&input.text.length<=140){peak=6*2**30;verified=true;}
 // Fixed runtime measurements and bounded input contracts: see docs/design/model-resource-evidence.json.
 if(engine==='yue2'&&match(input?.resourceProfile,yueProfile)&&['fast','quality'].includes(input?.preset)&&typeof input?.instrumental==='boolean'&&typeof input?.style==='string'&&input.style.length<=1000&&typeof input?.lyrics==='string'&&input.lyrics.length<=2000){peak=14*2**30;verified=true;}
 if(engine==='reference'&&match(input?.resourceProfile,referenceProfile)&&Number.isFinite(input?.duration)&&input.duration>=.3&&input.duration<=15.1){peak=8*2**30;verified=true;}
 if(engine==='conversion'&&match(input?.resourceProfile,conversionProfile)){peak=10*2**30;verified=true;}
 return {verified,peak:{memory:peak}};
}
