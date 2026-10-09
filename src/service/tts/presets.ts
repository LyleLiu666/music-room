import {createHash} from 'node:crypto';
import {mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {join} from 'node:path';
import type {AssetReader} from '../render/renderer.ts';
import {presetVoices} from './preset-manifest.ts';
import {wavInfo,type BuiltinVoice} from './speech.ts';

/** Bundled dry references and their precomputed conditioning share pinned hashes. */
export async function readBuiltinVoices(read:AssetReader):Promise<BuiltinVoice[]> {
 return Promise.all(presetVoices.map(async preset=>{
  const audio=await read(`tts-presets/${preset.id}.wav`);
  if(createHash('sha256').update(audio).digest('hex')!==preset.audioSha256)throw new Error(`内置音色校验失败：${preset.name}`);
  wavInfo(audio);
  return {id:preset.id,name:preset.name,audio};
 }));
}

/** Match immutable reference bytes, never a display name or a free-text intent. */
export async function prepareBuiltinConditioning(root:string,audio:Uint8Array,read:AssetReader){
 const hash=createHash('sha256').update(audio).digest('hex');
 const preset=presetVoices.find(voice=>voice.audioSha256===hash);
 if(!preset)return;
 const features=await read(`tts-presets/${preset.id}.npz`);
 if(createHash('sha256').update(features).digest('hex')!==preset.featuresSha256)throw new Error(`内置音色特征校验失败：${preset.name}`);
 const directory=join(root,'cache','voice-conditioning');await mkdir(directory,{recursive:true,mode:0o700});
 const conditioningPath=join(directory,`${preset.id}-${preset.featuresSha256}.npz`),partial=conditioningPath+`.${process.pid}.partial`;
 try{await writeFile(partial,features,{mode:0o600});await rename(partial,conditioningPath);}finally{await rm(partial,{force:true});}
 return {conditioningPath,conditioningSha256:preset.featuresSha256};
}
