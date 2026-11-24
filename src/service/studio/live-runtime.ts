import {existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,renameSync,rmSync,chmodSync,copyFileSync} from 'node:fs';
import {mkdtemp,readFile} from 'node:fs/promises';
import {setTimeout} from 'node:timers/promises';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import {ownedCommand} from '../resources/commands.ts';
import type {ResourceExecution} from '../resources/contracts.ts';
import {downloadSpeechFile} from '../tts/native-install.ts';
import {liveProfile,liveAssets,liveRequirements,liveWorker} from './live-assets.ts';

export type LiveStyle={left:string;right:string;mix:number};
export type LiveStream={next:(style:LiveStyle)=>Promise<Uint8Array>;done:Promise<void>};
export type LiveDriver={
 installed:()=>boolean;
 prepare:(context:ResourceExecution,report:(message:string)=>void)=>Promise<void>;
 open:(execution:ResourceExecution,seed:number)=>Promise<LiveStream>;
};
function directory(path:string){
 mkdirSync(path,{recursive:true,mode:0o700});
 if(!lstatSync(path).isDirectory())throw Error('Magenta 目录无效');
}
const stamp=(path:string)=>{
 const stat=lstatSync(path);if(!stat.isFile())throw Error('Magenta 模型文件无效');
 return [stat.size,stat.mtimeMs,stat.ctimeMs];
};
const sha=(data:string|Uint8Array)=>createHash('sha256').update(data).digest('hex');
const supported=()=>process.platform==='darwin'&&process.arch==='arm64';

async function command(program:string,args:string[],cwd:string,execution:ResourceExecution){
 let log='';
 try{await ownedCommand(program,args,cwd,{...execution,report:part=>{log=(log+part).slice(-5000);}});}
 catch(error){execution.signal.throwIfAborted();throw Error(log.trim().slice(-1600)||String(error));}
 return log;
}

export function createLiveDriver(root:string):LiveDriver{
 const python=join(root,'venv','bin','python'),requirements=join(root,'requirements.txt'),marker=join(root,'installed.json'),assetsRoot=join(root,'magenta-rt-v2');
 const metadata=()=>({
  profile:liveProfile,requirements:sha(liveRequirements),worker:sha(liveWorker),
  assets:liveAssets.map(([path])=>stamp(join(assetsRoot,path))),
 });
 const installed=()=>{try{
  if(!supported()||!lstatSync(root).isDirectory()||!lstatSync(assetsRoot).isDirectory()||!existsSync(python))return false;
  stamp(marker);stamp(requirements);
  return readFileSync(requirements,'utf8')===liveRequirements&&JSON.stringify(metadata())===readFileSync(marker,'utf8');
 }catch{return false;}};
 return {installed,prepare:async(execution,report)=>{
  if(!supported())throw Error('玩一段当前支持 Apple Silicon Mac');
  if(installed())return;
  directory(root);directory(assetsRoot);
  const context={...execution,report,stage:report};
  let uv=[join(homedir(),'.local','bin','uv'),join(homedir(),'Music','YuE2','bin','uv'),join(root,'bin','uv')].find(path=>existsSync(path));
  if(!uv){
   const archive=join(root,'uv.tar.gz');
   await downloadSpeechFile('https://github.com/astral-sh/uv/releases/download/0.12.23/uv-aarch64-apple-darwin.tar.gz',archive,'50487ae565ccd96e499056b4674d438f4c53170202617b4c759defe0c6a1b544',context);
   const stage=await mkdtemp(join(root,'uv-'));
   try{
    await command('/usr/bin/tar',['-xzf',archive,'-C',stage],stage,execution);
    directory(join(root,'bin'));uv=join(root,'bin','uv');
    copyFileSync(join(stage,'uv-aarch64-apple-darwin','uv'),uv);chmodSync(uv,0o700);
   }finally{rmSync(stage,{recursive:true,force:true});}
  }
  report('准备 Magenta 专用环境');
  const uvCommand=(args:string[])=>command('/usr/bin/env',['-u','VIRTUAL_ENV','-u','PYTHONPATH',`UV_CACHE_DIR=${join(root,'uv-cache')}`,
   `UV_PYTHON_INSTALL_DIR=${join(root,'python')}`,uv!,...args],root,execution);
  if(!existsSync(python))await uvCommand(['venv','--python','3.12.12',join(root,'venv')]);
  const stage=await mkdtemp(join(root,'install-'));
  try{
   const req=join(stage,'requirements.txt');
   writeFileSync(req,liveRequirements,{flag:'wx',mode:0o600});
   await uvCommand(['pip','sync','--python',python,req]);
   renameSync(req,requirements);
   for(const part of ['resources','resources/musiccoca','resources/spectrostream','models','models/mrt2_small'])directory(join(assetsRoot,part));
   for(const [path,size,digest] of liveAssets){
    const file=join(assetsRoot,path);
    report(`准备 Magenta 模型 · ${path.split('/').at(-1)}`);
    await downloadSpeechFile(`https://huggingface.co/google/magenta-realtime-2/resolve/${liveProfile.revision}/${path}`,file,digest,context);
    if(stamp(file)[0]!==size)throw Error('Magenta 权重长度错误');
   }
   execution.signal.throwIfAborted();
   const next=join(stage,'installed.json');
   writeFileSync(next,JSON.stringify(metadata()),{flag:'wx',mode:0o600});renameSync(next,marker);
  }finally{rmSync(stage,{recursive:true,force:true});}
 },open:async(execution,seed)=>{
  if(!installed())throw Error('Magenta 模型未准备或文件已变化');
  const work=await mkdtemp(join(root,'session-')),script=join(work,'worker.py');
  const local=new AbortController(),signal=AbortSignal.any([execution.signal,local.signal]);
  writeFileSync(script,liveWorker,{flag:'wx',mode:0o600});
  let terminal:Error|undefined;
  const done=command('/usr/bin/env',['-i',`HOME=${homedir()}`,'PATH=/usr/bin:/bin','PYTHONNOUSERSITE=1','PYTHONDONTWRITEBYTECODE=1',
   'HF_HUB_OFFLINE=1',`MAGENTA_HOME=${root}`,python,'-u',script,work,String(execution.budgets.memory),String(seed)],work,{...execution,signal})
   .then(()=>{terminal=new Error('Magenta 进程意外退出');throw terminal;},error=>{terminal=error;throw error;})
   .finally(()=>rmSync(work,{recursive:true,force:true}));
  void done.catch(()=>{});
  const waitFor=async(file:string,ms:number)=>{
   const deadline=Date.now()+ms;
   for(;;){
    signal.throwIfAborted();
    if(terminal)throw terminal;
    if(existsSync(file))return;
    if(Date.now()>=deadline)throw Error('Magenta 生成响应超时');
    await setTimeout(15,undefined,{signal});
   }
  };
  try{await waitFor(join(work,'ready'),45000);}
  catch(error){local.abort(error);await Promise.allSettled([done]);throw error;}
  return {done,next:async style=>{
   const staging=join(work,'request.partial'),request=join(work,'request.json'),response=join(work,'response.pcm');
   signal.throwIfAborted();if(terminal)throw terminal;
   writeFileSync(staging,JSON.stringify(style),{flag:'wx',mode:0o600});renameSync(staging,request);
   await waitFor(response,12000);
   const pcm=await readFile(response,{signal});rmSync(response);
   return pcm;
  }};
 }};
}
