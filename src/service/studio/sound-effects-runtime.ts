import {createHash,randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,readdirSync,readFileSync,writeFileSync,renameSync,rmSync,copyFileSync,chmodSync,linkSync} from 'node:fs';
import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {join,relative} from 'node:path';
import {homedir} from 'node:os';
import {ownedCommand} from '../resources/commands.ts';
import {downloadSpeechFile} from '../tts/native-install.ts';
import type {ResourceExecution} from '../resources/contracts.ts';
import type {EffectDriver} from './sound-effects.ts';
import {effectArchiveSha,effectProfile,effectRequirements,effectRevision,effectSourceSha,effectWeights,effectWeightsRevision,effectWorker} from './sound-effects-assets.ts';

const uvUrl='https://github.com/astral-sh/uv/releases/download/0.12.23/uv-aarch64-apple-darwin.tar.gz';
const uvSha='50487ae565ccd96e499056b4674d438f4c53170202617b4c759defe0c6a1b544';
const sha=(bytes:Uint8Array|string)=>createHash('sha256').update(bytes).digest('hex');
const fileStamp=(path:string)=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink())throw Error('音效模型文件不能是符号链接');return {bytes:s.size,mtimeMs:s.mtimeMs};};
const assertDirectory=(path:string)=>{if(existsSync(path)&&(!lstatSync(path).isDirectory()||lstatSync(path).isSymbolicLink()))throw Error('音效模型目录无效或是符号链接');};
/** The worker writes its final measurement after all prompt/model output. */
export function parseEffectPeak(logs:string){const matches=[...logs.matchAll(/^SFX_PEAK_BYTES (\d+)\s*$/gm)];const value=matches.length?Number(matches.at(-1)![1]):NaN;if(!Number.isSafeInteger(value)||value<0)throw Error('音效模型未返回有效进程峰值');return value;}
/** Every executable upstream Python module is tied to the fixed source archive. */
export function effectSourceIdentity(root:string){
 const paths:string[]=[];
 const visit=(path:string,recursive:boolean)=>{assertDirectory(path);for(const entry of readdirSync(path,{withFileTypes:true})){const next=join(path,entry.name);if(entry.isSymbolicLink())throw Error('音效运行目录不能包含符号链接');if(entry.isDirectory()){if(recursive&&entry.name!=='mlx'&&entry.name!=='__pycache__')visit(next,true);}else if(entry.isFile()&&entry.name.endsWith('.py'))paths.push(relative(root,next).split('\\').join('/'));}};
 visit(join(root,'models'),true);visit(join(root,'scripts'),false);paths.sort();
 return sha(paths.map(path=>`${path}\0${sha(readFileSync(join(root,path)))}\n`).join(''));
}
function installed(root:string){try{
 if(process.platform!=='darwin'||process.arch!=='arm64')return false;
 for(const part of ['', 'source','source/models','source/models/mlx','source/models/defs','source/scripts','venv'])assertDirectory(join(root,part));
 const marker=join(root,'installed.json');fileStamp(marker);const metadata=JSON.parse(readFileSync(marker,'utf8'));
 if(metadata.profile!==JSON.stringify(effectProfile)||!existsSync(join(root,'venv','bin','python'))||effectSourceIdentity(join(root,'source'))!==effectSourceSha)return false;
 return effectWeights.every(w=>{const stat=fileStamp(join(root,'source','models','mlx',w.name));return stat.bytes===w.bytes&&JSON.stringify(stat)===JSON.stringify(metadata.files[w.name]);});
 }catch{return false;}}
const contextFor=(execution:ResourceExecution,report:(message:string)=>void)=>({signal:execution.signal,lease:execution.lease,trackProcess:execution.trackProcess,report,stage:report});
function command(command:string,args:string[],cwd:string,execution:ResourceExecution,report:(message:string)=>void){return ownedCommand(command,args,cwd,contextFor(execution,report));}

export function createEffectDriver(root:string):EffectDriver{
 return {directory:root,profile:effectProfile,installed:()=>installed(root),prepare:async(execution,report)=>{
  if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('音效模型当前仅支持 Apple Silicon Mac');
  assertDirectory(root);mkdirSync(root,{recursive:true,mode:0o700});if(installed(root))return;
  for(const part of ['downloads','weights','venv','source']){assertDirectory(join(root,part));}
  for(const part of ['downloads','weights'])mkdirSync(join(root,part),{recursive:true,mode:0o700});
  const context=contextFor(execution,message=>report(message.replace('下载语音模型','下载音效模型'))),archive=join(root,'downloads','source.tar.gz');
  const prepareCommand=async(program:string,args:string[],cwd:string)=>{let logs='';try{await command(program,args,cwd,execution,line=>{logs=(logs+line).slice(-4000);});}catch(error){if(execution.signal.aborted)throw error;throw Error(logs.trim().slice(-2000)||String(error));}};
  report('下载固定版本的音效程序');await downloadSpeechFile(`https://codeload.github.com/Stability-AI/stable-audio-3/tar.gz/${effectRevision}`,archive,effectArchiveSha,context);
  let uv=[join(homedir(),'.local','bin','uv'),join(homedir(),'Music','YuE2','bin','uv'),join(root,'bin','uv')].find(path=>existsSync(path));
  if(!uv){report('准备模型安装工具');const uvArchive=join(root,'downloads','uv.tar.gz');await downloadSpeechFile(uvUrl,uvArchive,uvSha,context);const unpack=await mkdtemp(join(root,'uv-unpack-'));try{await prepareCommand('/usr/bin/tar',['-xzf',uvArchive,'-C',unpack],root);assertDirectory(join(root,'bin'));mkdirSync(join(root,'bin'),{recursive:true,mode:0o700});copyFileSync(join(unpack,'uv-aarch64-apple-darwin','uv'),join(root,'bin','uv'));chmodSync(join(root,'bin','uv'),0o700);uv=join(root,'bin','uv');}finally{await rm(unpack,{recursive:true,force:true});}}
  report('准备音效专用 Python 环境');const python=join(root,'venv','bin','python');if(!existsSync(python))await prepareCommand(uv,['venv','--python','3.11.9',join(root,'venv')],root);
  const req=join(root,'requirements.txt');if(existsSync(req)&&lstatSync(req).isSymbolicLink())throw Error('依赖文件不能是符号链接');writeFileSync(req,effectRequirements,{mode:0o600});
  await prepareCommand(uv,['pip','sync','--python',python,req],root);
  for(const weight of effectWeights){execution.signal.throwIfAborted();report(`准备音效模型 · ${weight.name}`);const target=join(root,'weights',weight.name);
   await downloadSpeechFile(`https://huggingface.co/stabilityai/stable-audio-3-optimized/resolve/${effectWeightsRevision}/MLX/${weight.name}`,target,weight.sha256,context);
   if(fileStamp(target).bytes!==weight.bytes)throw Error('音效模型文件大小不符');
  }
  const stage=await mkdtemp(join(root,'source-stage-'));let staged=true;try{
   report('校验音效程序');await prepareCommand('/usr/bin/tar',['-xzf',archive,'--strip-components','3','-C',stage,`stable-audio-3-${effectRevision}/optimized/mlx`],root);
   if(effectSourceIdentity(stage)!==effectSourceSha)throw Error('音效程序校验失败');
   const modelDirectory=join(stage,'models','mlx');assertDirectory(modelDirectory);mkdirSync(modelDirectory,{recursive:true,mode:0o700});
   for(const w of effectWeights)linkSync(join(root,'weights',w.name),join(modelDirectory,w.name));
   execution.signal.throwIfAborted();const target=join(root,'source'),old=join(root,`source-old-${randomUUID()}`);if(existsSync(target))renameSync(target,old);
   try{renameSync(stage,target);staged=false;}catch(error){if(existsSync(old))renameSync(old,target);throw error;}
   if(existsSync(old))rmSync(old,{recursive:true,force:true});
   const files=Object.fromEntries(effectWeights.map(w=>[w.name,fileStamp(join(target,'models','mlx',w.name))]));const marker=join(root,'installed.json');for(const path of [marker,marker+'.partial'])if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('安装记录不能是符号链接');writeFileSync(marker+'.partial',JSON.stringify({profile:JSON.stringify(effectProfile),files}),{mode:0o600});renameSync(marker+'.partial',marker);report('音效模型已准备好');
  }finally{if(staged)await rm(stage,{recursive:true,force:true});}
 },generate:async(request,execution,reportPeak)=>{
  if(!installed(root))throw Error('音效模型未准备好或运行文件已变化，请重新准备');
  const temporary=await mkdtemp(join(root,'task-'));try{
   const requestPath=join(temporary,'request.json'),output=join(temporary,'output.wav');await writeFile(requestPath,JSON.stringify({script:join(root,'source','scripts','sa3_mlx.py'),prompt:request.prompt,seconds:request.seconds,seed:request.seed,output}),{mode:0o600});
   let logs='';const report=(line:string)=>{logs=(logs+line).slice(-5000);};
   try{await command('/usr/bin/env',['-i',`HOME=${homedir()}`,'PATH=/usr/bin:/bin:/usr/sbin:/sbin','HF_HUB_OFFLINE=1','PYTHONNOUSERSITE=1','PYTHONDONTWRITEBYTECODE=1',join(root,'venv','bin','python'),'-c',effectWorker,requestPath],root,execution,report);}catch(error){if(execution.signal.aborted)throw error;throw Error(logs.trim().slice(-2000)||String(error));}
   execution.signal.throwIfAborted();reportPeak(parseEffectPeak(logs));const stamp=fileStamp(output);if(stamp.bytes>2_000_000)throw Error('生成音效文件过大');return new Uint8Array(await readFile(output));
  }finally{await rm(temporary,{recursive:true,force:true});}
 }};
}
