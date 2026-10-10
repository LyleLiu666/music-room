import {groupMembers} from '../resources/processes.ts';
import {yue2JobSchema} from './contracts.ts';
import {createHash,randomBytes} from 'node:crypto';
import {mkdirSync,existsSync,readFileSync,writeFileSync,renameSync,lstatSync,readdirSync,statSync,unlinkSync} from 'node:fs';
import {open} from 'node:fs/promises';
import {spawn,execFile} from 'node:child_process';
import {createServer} from 'node:net';
import {join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {AssetReader} from '../render/renderer.ts';
import type {YuE2Driver,YuE2Context,YuE2Process} from './engine.ts';
import type {YuE2Task} from './worker.ts';
const revision='f696147a985081848d4b0310cbe9b10b16259be6';
const archives={
  uv:{url:'https://github.com/astral-sh/uv/releases/download/0.12.23/uv-aarch64-apple-darwin.tar.gz',hash:'50487ae565ccd96e499056b4674d438f4c53170202617b4c759defe0c6a1b544'},
  source:{url:`https://codeload.github.com/ianiv/YuE2/tar.gz/${revision}`,hash:'d71535dbbb6e7fc79c5cd8f8fa93e247b0176391649c7c719482c59e915afc3b'},
  mlx:{url:'https://codeload.github.com/ianiv/mlx-Yue/tar.gz/1332b148bf5588c357a14323a03c9b9e9f2b2737',hash:'6781272d227d3f7010b76cfd2a9d2a960a8021fe6b41909c361361e23ba2f749'},
};
function installationReady(root:string){try{const value=JSON.parse(readFileSync(join(root,'installed.json'),'utf8'));return value.revision===revision&&value.directory===root&&existsSync(join(root,'.venv','bin','python'))&&existsSync(join(root,'source','yue2_studio','main.py'));}catch{return false;}}
export function startWorker(command:string,args:string[],task:YuE2Task,context:YuE2Context) {
  const child=spawn(command,args,{stdio:['pipe','pipe','pipe'],detached:!!context.lease});let ended=false;
  let failure:Error|undefined;
  const exited=new Promise<number|null>(resolve=>{child.once('error',error=>{failure=error;resolve(1);});child.once('close',code=>{ended=true;resolve(code);});});
  child.stdin.on('error',()=>{});
  try{
    const lockPath=join(task.directory,'.music-room-yue2.lock'),lock=JSON.parse(readFileSync(lockPath,'utf8'));
    if(lock.owner!==task.owner)throw new Error('YuE2 安装目录的所属工作台已改变');
    // Publish the supervisor PID before granting its stdin lease; recovery cannot race an orphan.
    writeFileSync(lockPath+'.tmp',JSON.stringify({...lock,workerPid:child.pid}));renameSync(lockPath+'.tmp',lockPath);
    if(child.pid)context.trackProcess?.(child.pid);
    child.stdin.write(JSON.stringify({...task,resourceLease:context.lease,budget:context.budget})+'\n');
  }catch(error){child.stdin.end();throw error;}
  for(const output of [child.stdout,child.stderr]){let pending='';output.on('data',chunk=>{pending+=chunk.toString();const lines=pending.split(/[\r\n]/);pending=lines.pop()??'';for(const line of lines)context.report(line);if(pending.length>2000){context.report(pending);pending='';}});output.on('end',()=>{if(pending)context.report(pending);});}
  const stop=async()=>{if(ended)return;child.stdin.end();const term=setTimeout(()=>child.kill('SIGTERM'),7000),kill=setTimeout(()=>{if(child.pid&&context.lease){for(const pid of groupMembers(child.pid))try{process.kill(pid,'SIGKILL');}catch{}}else child.kill('SIGKILL');},14000);try{await exited;}finally{clearTimeout(term);clearTimeout(kill);}};
  const abort=()=>{void stop();};context.signal.addEventListener('abort',abort,{once:true});
  void exited.then(()=>context.signal.removeEventListener('abort',abort));
  return {exited,stop,ended:()=>ended,error:()=>failure};
}
async function stage(command:string,args:string[],task:YuE2Task,context:YuE2Context) {
  context.signal.throwIfAborted();const worker=startWorker(command,args,task,context),code=await worker.exited;
  context.signal.throwIfAborted();if(code!==0)throw worker.error()??new Error(`YuE2 ${task.step} 失败（退出码 ${code}），请查看安装日志后重试`);
}
async function download(path:string,spec:{url:string;hash:string},context:YuE2Context) {
  const valid=async()=>{if(!existsSync(path))return false;const hash=createHash('sha256'),f=await open(path,'r');try{for await(const part of f.createReadStream())hash.update(part);}finally{await f.close().catch(()=>{});}return hash.digest('hex')===spec.hash;};
  if(await valid())return;
  context.report(`下载 ${spec.url.split('/').at(-1)}`);
  const response=await fetch(spec.url,{signal:context.signal});if(!response.ok||!response.body)throw new Error(`下载失败：HTTP ${response.status}`);
  const temporary=path+'.partial',f=await open(temporary,'w',0o600),hash=createHash('sha256');let bytes=0,last=0;
  try{for await(const part of response.body){await f.write(part);hash.update(part);bytes+=part.length;if(Date.now()-last>2000){context.report(`已下载 ${(bytes/1048576).toFixed(1)} MB`);last=Date.now();}}}finally{await f.close();}
  if(hash.digest('hex')!==spec.hash)throw new Error('安装文件校验失败，请重新下载');renameSync(temporary,path);
}
async function untar(archive:string,target:string,context:YuE2Context) {
  await new Promise<void>((resolve,reject)=>{
    const child=spawn('/usr/bin/tar',['-xzf',archive,'--strip-components=1','-C',target],{stdio:['ignore','ignore','pipe']});let error='';
    child.stderr.on('data',chunk=>error+=chunk);const abort=()=>child.kill('SIGTERM');context.signal.addEventListener('abort',abort,{once:true});
    child.once('error',reject);child.once('close',code=>{context.signal.removeEventListener('abort',abort);if(context.signal.aborted)reject(context.signal.reason);else if(code!==0)reject(new Error(`解压失败：${error.slice(-1000)}`));else resolve();});
  });
}
async function freePort(){const server=createServer();return new Promise<number>((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{const port=(server.address() as {port:number}).port;server.close(error=>error?reject(error):resolve(port));});});}
function writtenBytes(directory:string):number {let total=0;try{for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())total+=writtenBytes(path);else if(entry.isFile())total+=statSync(path).blocks*512;}}catch{}return total;}
/** The pinned HF version uses unique temporary names; interrupted files cannot be reused. */
export function cleanDownloadPartials(root:string) {
  if(!existsSync(join(root,'models'))||lstatSync(join(root,'models')).isSymbolicLink())return;
  const visit=(directory:string)=>{if(!existsSync(directory)||lstatSync(directory).isSymbolicLink())return;for(const entry of readdirSync(directory,{withFileTypes:true})){const path=join(directory,entry.name);if(entry.isDirectory())visit(path);else if(entry.isFile()&&entry.name.endsWith('.incomplete'))unlinkSync(path);}};
  for(const model of ['converted','vae','loras']){
    const path=join(root,'models',model);if(!existsSync(path)||lstatSync(path).isSymbolicLink())continue;
    let directory=path;for(const name of ['.cache','huggingface','download']){directory=join(directory,name);if(!existsSync(directory)||lstatSync(directory).isSymbolicLink()){directory='';break;}}if(directory)visit(directory);
  }
}
export function createYuE2Driver(read:AssetReader,command=process.execPath,args=[fileURLToPath(new URL('./worker-entry.ts',import.meta.url))]):YuE2Driver {
  let choosing=false;
  return {
    unsupported:()=>process.platform!=='darwin'||process.arch!=='arm64'?'当前自动安装支持 Apple Silicon Mac；此电脑仍可使用乐谱创作与音频渲染。':undefined,
    installed:installationReady,
    modelsReady:root=>['converted/conversion.json','converted/ar-8bit.safetensors','converted/nar-bf16.safetensors','vae/config.json','vae/model.safetensors'].every(name=>{try{const path=join(root,'models',name);return !lstatSync(path).isSymbolicLink()&&statSync(path).isFile()&&statSync(path).size>0;}catch{return false;}}),
    history:async root=>{
      const path=join(root,'data','app.db');if(!existsSync(path))return [];
      if(lstatSync(path).isSymbolicLink()||lstatSync(join(root,'data')).isSymbolicLink())throw new Error('音乐任务数据库不能是符号链接');
      const script="import sqlite3,json,sys\nc=sqlite3.connect('file:'+sys.argv[1]+'?mode=ro',uri=True)\nc.row_factory=sqlite3.Row\nprint(json.dumps([dict(r) for r in c.execute('SELECT id,kind,status,error,params_json,created_at FROM jobs ORDER BY created_at DESC LIMIT 10000')]))";
      const text=await new Promise<string>((resolve,reject)=>execFile(join(root,'.venv/bin/python'),['-c',script,path],{timeout:10000,maxBuffer:16*1024*1024},(error,stdout)=>error?reject(error):resolve(stdout)));
      return JSON.parse(text).map((row:any)=>yue2JobSchema.parse({...row,title:JSON.parse(row.params_json).title}));
    },
    chooseDirectory:async()=>{
      if(choosing)throw new Error('文件夹选择窗口已经打开');choosing=true;
      try{return await new Promise<string|undefined>((resolve,reject)=>execFile('/usr/bin/osascript',['-e','POSIX path of (choose folder with prompt "选择 YuE2 专用空文件夹：程序、模型及缓存将全部保存在这里")'],{timeout:300000,maxBuffer:16384},(error,stdout,stderr)=>{if(error){if(stderr.includes('(-128)'))resolve(undefined);else reject(new Error('无法打开文件夹选择窗口，请直接填写安装目录'));}else resolve(stdout.trim());}));}finally{choosing=false;}
    },
    prepare:async(root,models,context)=>{
      for(const name of ['bin','downloads','source','cache','tmp','python','models','data','config','state']){const path=join(root,name);if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new Error(`YuE2 ${name} 不能是符号链接`);mkdirSync(path,{recursive:true});}
      const run=(step:YuE2Task['step'])=>stage(command,args,{directory:root,owner:context.owner,step},context);
      const installed=installationReady(root);
      if(!installed){
        const uv=join(root,'downloads','uv.tar.gz'),source=join(root,'downloads','source.tar.gz');
        await download(uv,archives.uv,context);await untar(uv,join(root,'bin'),context);
        await download(source,archives.source,context);await untar(source,join(root,'source'),context);
        const mlx=join(root,'downloads','mlx-yue.tar.gz');await download(mlx,archives.mlx,context);
        writeFileSync(join(root,'requirements.txt'),new TextDecoder().decode(await read('yue2-runtime/requirements.txt')).replace('MUSIC_ROOM_MLX_YUE_ARCHIVE',pathToFileURL(mlx).href));
        context.report('安装专用 Python 3.12');await run('venv');context.report('安装已锁定版本的 YuE2 依赖');await run('dependencies');await run('studio');await run('check');
        const marker=join(root,'installed.json');writeFileSync(marker+'.tmp',JSON.stringify({version:1,revision,directory:root}));renameSync(marker+'.tmp',marker);
      }
      if(models){
        cleanDownloadPartials(root);context.report('下载并校验 YuE2 生成模型（约 10 GB，保留已完成文件）');
        const progress=setInterval(()=>context.report(`模型下载 / 校验进行中 · 模型目录已写入 ${(writtenBytes(join(root,'models'))/1073741824).toFixed(2)} GB`),10000);
        try{await run('models');context.report('下载纯器乐适配器');await run('instrumental');}finally{clearInterval(progress);cleanDownloadPartials(root);}
      }
    },
    launch:async(root,context):Promise<YuE2Process>=>{
      const port=await freePort(),nonce=randomBytes(32).toString('hex'),url=`http://127.0.0.1:${port}`;
      const credential=randomBytes(32).toString('hex'),worker=startWorker(command,args,{directory:root,owner:context.owner,step:'serve',port,nonce,credential},context);
      const status=async()=>{const response=await fetch(url+'/api/status',{signal:AbortSignal.timeout(2000)});if(!response.ok||response.headers.get('x-music-room-engine')!==nonce)throw new Error('YuE2 服务身份或状态无效');const body=await response.json() as {models?:{present?:boolean};fake?:boolean};if(typeof body.fake!=='boolean')throw new Error('YuE2 状态格式无效');return {modelsPresent:body.models?.present===true,fake:body.fake};};
      try{
        const deadline=Date.now()+120000;
        while(Date.now()<deadline){context.signal.throwIfAborted();if(worker.ended())throw worker.error()??new Error('YuE2 启动时退出，请查看日志');try{await status();return {url,headers:{'x-music-room-execution':credential},status,exited:worker.exited,stop:worker.stop};}catch{}await new Promise(r=>setTimeout(r,500));}
        throw new Error('YuE2 启动超时，请查看日志');
      }catch(error){await worker.stop();throw error;}
    },
  };
}
