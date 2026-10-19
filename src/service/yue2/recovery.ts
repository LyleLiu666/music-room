import {existsSync,lstatSync,readFileSync,realpathSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {generationWithEnding} from './input.ts';
import type {YuE2Generate,MusicRecoveryStage} from './contracts.ts';
export const musicRecoveryLabels={plan:'音乐内容生成',semantic:'声音合成',synthesis:'音频导出'};
export const musicRecoveryRank={plan:1,semantic:2,synthesis:3};
const planFiles=['plan/plan.json','plan/plan_manifest.json','plan/abc_tokens.npy','plan/prefix.npy'];
const allowed=new Set([...planFiles,'plan/score.abc','semantic/result.json','synthesis/latents.npy']);
/** Read only verified owned artifacts. Damaged or incomplete saves are never advertised as resumable. */
export function readMusicRecovery(directory:string,id:string):MusicRecoveryStage|undefined{
 try{
  if(!/^[a-f0-9]{32}$/.test(id)||realpathSync(directory)!==directory)return;
  const song=join(directory,'data/songs',id);
  for(const p of [join(directory,'.music-room-yue2.json'),join(directory,'data'),join(directory,'data/songs'),song])if(lstatSync(p).isSymbolicLink())return;
  const owner=JSON.parse(readFileSync(join(directory,'.music-room-yue2.json'),'utf8'));if(owner.format!=='music-room-yue2'||owner.version!==1)return;
  const root=existsSync(join(song,'checkpoints/state.json'))?join(song,'checkpoints'):song;
  const read=(name:string)=>{for(const p of [root,...name.split('/').map((_,i,a)=>join(root,...a.slice(0,i+1)))])if(lstatSync(p).isSymbolicLink())throw Error('linked');const p=join(root,name);if(!lstatSync(p).isFile()||lstatSync(p).size>4*1024*1024)throw Error('invalid');return readFileSync(p);};
  let files:Record<string,string>,stage:MusicRecoveryStage;
  if(root!==song){const state=JSON.parse(read('state.json').toString());stage=state.stage;if(state.version!==1||!Object.hasOwn(musicRecoveryRank,stage)||!state.files||typeof state.files!=='object'||!/^[a-f0-9]{64}$/.test(state.fingerprint))return;files=state.files;
   const required=[...planFiles,...(stage!=='plan'?['semantic/result.json']:[]),...(stage==='synthesis'?['synthesis/latents.npy']:[])];if(required.some(n=>!Object.hasOwn(files,n)))return;
  }else{const manifest=JSON.parse(read('plan/plan_manifest.json').toString());files=Object.fromEntries(Object.entries(manifest).map(([n,v])=>['plan/'+n,v])) as Record<string,string>;if(planFiles.filter(n=>!n.endsWith('plan_manifest.json')).some(n=>!Object.hasOwn(files,n)))return;stage='plan';}
  for(const [name,digest] of Object.entries(files))if(!allowed.has(name)||createHash('sha256').update(read(name)).digest('hex')!==digest)return;
  return stage;
 }catch{return;}
}
export function sameMusicGeneration(a:YuE2Generate,b:YuE2Generate){
 const key=(v:YuE2Generate)=>JSON.stringify({...generationWithEnding(v),seed:v.seed,preset:v.preset,instrumental:v.instrumental,abc:v.abc?.trim()?v.abc:null,targetDuration:v.targetDuration??null});
 try{return key(a)===key(b);}catch{return false;}
}
