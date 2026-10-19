import {execFile} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import type {AssetReader} from '../render/renderer.ts';
export type ScoreSummary={bpm:number;nominal_duration_seconds:number;sections:{start:string;label:string}[];voices:Record<string,{sounding_notes:number;measures:number;notes:{onset_quarters:string;midi_pitch:number;duration_quarters:string}[];chords:unknown[]}>};
const files=['score.py','vendor/abc_tools.py','vendor/compile_score.py','vendor/instrumentalize.py','vendor/common.py'];
const sourceAssets:AssetReader=p=>readFile(new URL('../../../public/'+p,import.meta.url));
/** Pure notation operations: packaged with the app; no model weights or trial server. */
export async function scoreOperation(data:unknown,read:AssetReader=sourceAssets,python='python3'):Promise<any>{
 const directory=await mkdtemp(join(tmpdir(),'music-room-score-'));
 try{
  await Promise.all(files.map(async file=>{const path=join(directory,file);await mkdir(dirname(path),{recursive:true});await writeFile(path,await read('yue2-score/'+file));}));
  return await new Promise((resolve,reject)=>{
   const child=execFile(python,['-B',join(directory,'score.py')],{maxBuffer:4*1024*1024,timeout:10000},(error,out,err)=>{if(error)reject(new Error(err.trim()||error.message));else try{resolve(JSON.parse(out));}catch{reject(new Error('乐谱检查返回无效结果'));}});
   child.stdin?.on('error',()=>{});child.stdin?.end(JSON.stringify(data));
  });
 }finally{await rm(directory,{recursive:true,force:true});}
}
