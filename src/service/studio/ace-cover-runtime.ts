import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync} from 'node:fs';
import {mkdtemp,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {AssetReader} from '../render/renderer.ts';
import {coverArchives,coverProgramAsset,coverProgramManifest,buildCoverProgram} from './ace-cover-program.ts';
import {ownedCommand} from '../resources/commands.ts';
import {installTask} from '../resources/installation.ts';
import type {ResourceCoordinator} from '../resources/coordinator.ts';
import {userCancelled,type ResourceExecution} from '../resources/contracts.ts';
import {downloadSpeechFile} from '../tts/native-install.ts';
import {coverModel,coverProfile,coverStrengths,type CoverProvenance} from './ace-cover.ts';

const weights=[
 [coverModel,'a241c9a721e3704cb04b17ce6a40c9aa714d3ee5cf49c2219972020eb761f5a4'],
 ['Qwen3-Embedding-0.6B-Q8_0.gguf','972f23255e46adfe744a0eb9a0039f3c63988f65753b0968d776e8b27168c321'],
 ['vae-BF16.gguf','0599862ac5d15cd308e1d2e368373aea6c02e25ebd1737ad4a4562a0901b0ef8'],
] as const;

function directory(path:string){
 if(existsSync(path)&&!lstatSync(path).isDirectory())throw Error('翻唱模型目录必须是普通目录');
 mkdirSync(path,{recursive:true,mode:0o700});
}
function stamp(path:string){
 const s=lstatSync(path);
 if(!s.isFile())throw Error('翻唱模型文件无效');
 return [s.size,s.mtimeMs,s.ctimeMs];
}
async function command(program:string,args:string[],cwd:string,execution:ResourceExecution){
 let log='';
 try{await ownedCommand(program,args,cwd,{...execution,report:part=>{log=(log+part).slice(-6000);}});}
 catch(error){execution.signal.throwIfAborted();throw Error(log.trim().slice(-1600)||String(error));}
 return log;
}
export type CoverDriver={
 installed:()=>boolean;
 prepare:(context:ResourceExecution,report:(message:string)=>void)=>Promise<void>;
 generate:(source:Uint8Array,cover:CoverProvenance,context:ResourceExecution)=>Promise<Uint8Array>;
};
export function createCoverDriver(root:string,embedded?:AssetReader):CoverDriver{
 const models=join(root,'models'),binary=join(root,'ace-synth'),marker=join(root,'installed.json');
 const files=()=>[stamp(binary),...weights.map(([name])=>stamp(join(models,name)))];
 const supported=()=>process.platform==='darwin'&&process.arch==='arm64';
 const installed=()=>{try{
  if(!supported()||!lstatSync(root).isDirectory()||!lstatSync(models).isDirectory())return false;
  stamp(marker);
  const metadata=JSON.parse(readFileSync(marker,'utf8'));
  return metadata.revision===coverProfile.revision&&metadata.weights===coverProfile.weights&&JSON.stringify(metadata.files)===JSON.stringify(files())
   &&metadata.binarySha===createHash('sha256').update(readFileSync(binary)).digest('hex');
 }catch{return false;}};
 return {installed,prepare:async(execution,report)=>{
  if(!supported())throw Error('翻唱模型当前支持 Apple Silicon Mac');
  if(installed())return;
  directory(root);directory(models);
  const context={...execution,report,stage:report};
  if(!embedded)for(const [name,url,sha] of coverArchives)await downloadSpeechFile(url,join(root,name),sha,context);
  for(const [name,sha] of weights){
   report(`准备翻唱模型 · ${name}`);
   await downloadSpeechFile(`https://huggingface.co/Serveurperso/ACE-Step-1.5-GGUF/resolve/${coverProfile.weights}/${name}`,join(models,name),sha,context);
  }
  const staging=await mkdtemp(join(root,'build-'));
  try{
   report('正在准备本机翻唱程序');
   let program:string;
   if(embedded){
    const manifest=JSON.parse(new TextDecoder().decode(await embedded(coverProgramManifest)));
    const data=await embedded(coverProgramAsset);
    if(manifest.revision!==coverProfile.revision||manifest.sha256!==createHash('sha256').update(data).digest('hex'))throw Error('内置翻唱程序校验失败');
    program=join(staging,'ace-synth');
    writeFileSync(program,data,{flag:'wx',mode:0o700});
   }else program=await buildCoverProgram(staging,root,(commandPath,args)=>command(commandPath,args,staging,execution));
   execution.signal.throwIfAborted();
   renameSync(program,binary);
   const metadata={revision:coverProfile.revision,weights:coverProfile.weights,files:files(),binarySha:createHash('sha256').update(readFileSync(binary)).digest('hex')};
   const next=join(staging,'installed.json');
   writeFileSync(next,JSON.stringify(metadata),{flag:'wx',mode:0o600});
   renameSync(next,marker);
  }finally{rmSync(staging,{recursive:true,force:true});}
 },generate:async(source,cover,execution)=>{
  if(!installed())throw Error('翻唱模型尚未准备好或安装文件已变化');
  const task=await mkdtemp(join(root,'cover-'));
  try{
   const duration=cover.endSeconds-cover.startSeconds;
   writeFileSync(join(task,'original.wav'),source,{flag:'wx',mode:0o600});
   writeFileSync(join(task,'cover.json'),JSON.stringify({
    task_type:'cover',synth_model:coverModel,caption:cover.style,
    lyrics:cover.lyrics||'[Instrumental]',duration,bpm:cover.bpm??0,seed:cover.seed,inference_steps:8,
    audio_cover_strength:coverStrengths[cover.strength],output_format:'wav16',
   }),{flag:'wx',mode:0o600});
   await command('/usr/bin/env',['-i','PATH=/usr/bin:/bin',binary,'--models',models,'--device','MTL0','--request','cover.json','--src-audio','original.wav'],task,execution);
   execution.signal.throwIfAborted();
   const path=join(task,'cover0.wav'),[size]=stamp(path);
   if(size>13_000_000)throw Error('翻唱结果大小超出预期');
   return new Uint8Array(await readFile(path,{signal:execution.signal}));
  }finally{rmSync(task,{recursive:true,force:true});}
 }};
}

export class CoverEngine {
 private preparation?:{controller:AbortController;done:Promise<void>};
 private progress?:{state:'preparing'|'failed'|'cancelled';message:string};
 private readonly resources:ResourceCoordinator;
 private readonly directory:string;
 readonly driver:CoverDriver;
 constructor(resources:ResourceCoordinator,directory:string,driver:CoverDriver){
  this.resources=resources;this.directory=directory;this.driver=driver;
  resources.register('ace-cover',{resident:()=>undefined,unload:async()=>{}});
 }
 status(){return {installed:this.driver.installed(),preparation:this.progress};}
 prepare(){
  if(this.preparation||this.driver.installed())return this.status();
  const controller=new AbortController();
  this.progress={state:'preparing',message:'等待准备翻唱模型'};
  const done=installTask(this.resources,{id:'install-ace-cover',signal:controller.signal,directory:this.directory,diskBytes:4_000_000_000,
   execute:execution=>this.driver.prepare(execution,message=>{this.progress={state:'preparing',message};})
  }).then(()=>{this.progress=undefined;}).catch(error=>{
   this.progress={state:userCancelled(controller.signal)?'cancelled':'failed',message:error instanceof Error?error.message:String(error)};
  }).finally(()=>{this.preparation=undefined;});
  this.preparation={controller,done};
  return this.status();
 }
 async cancelPreparation(){
  this.preparation?.controller.abort();
  await this.preparation?.done;
  return this.status();
 }
}
