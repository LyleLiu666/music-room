import {createHash,randomUUID} from 'node:crypto';
import {createReadStream,existsSync,lstatSync,mkdirSync,readFileSync,writeFileSync,copyFileSync,renameSync,unlinkSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {homedir} from 'node:os';
import type {SpeechDriver,SpeechContext,SpeechRequest} from './speech.ts';
import {checkedDirectory,lock,runCommand} from './python-runtime.ts';
import {downloadSpeechFile} from './native-install.ts';
import {breezeFiles,breezeRequirements,breezeRevision,breezeWorker} from './breeze-assets.ts';
import {speechSegments} from './segments.ts';
import {emotionStrengthLabels} from './emotion.ts';
const hash=(text:string)=>createHash('sha256').update(text).digest('hex');
export const breezeProfile={id:'breeze-4bit-stream1s-sequential140-v1',revision:breezeRevision,program:hash(breezeWorker),requirements:hash(breezeRequirements),weights:hash(JSON.stringify(breezeFiles))};
const stamp=(path:string)=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink())throw Error('Breeze 模型文件不能是符号链接');return {bytes:s.size,mtimeMs:s.mtimeMs};};
const base=(root:string)=>join(root,'breeze');
function checkPaths(root:string){const directory=base(root);for(const part of ['', 'model','model/audio_tokenizer','.venv','requirements.txt','installed.json','installed.json.partial']){try{if(lstatSync(join(directory,part)).isSymbolicLink())throw Error('Breeze 安装路径不能是符号链接');}catch(error:any){if(error.code!=='ENOENT')throw error;}}}
export function breezeInstalled(root:string){try{
 checkPaths(root);const directory=base(root),m=JSON.parse(readFileSync(join(directory,'installed.json'),'utf8'));
 if(lstatSync(directory).isSymbolicLink()||lstatSync(join(directory,'model')).isSymbolicLink())return false;
 return m.requirements===breezeProfile.requirements&&m.revision===breezeRevision&&existsSync(join(directory,'.venv','bin','python'))&&breezeFiles.every(f=>JSON.stringify(stamp(join(directory,'model',f.path)))===JSON.stringify(m.files[f.path])&&m.files[f.path].bytes===f.bytes);
}catch{return false;}}
async function shaFile(path:string,signal:AbortSignal){const h=createHash('sha256');for await(const bytes of createReadStream(path)){signal.throwIfAborted();h.update(bytes);}return h.digest('hex');}
export function breezeInstruction(request:Pick<SpeechRequest,'emotion'|'emotionStrength'>){
 const description=request.emotion?.trim();
 if(!description&&!request.emotionStrength)return undefined;
 return [description,request.emotionStrength?`表达程度：${emotionStrengthLabels[request.emotionStrength]}。`:undefined].filter(Boolean).join('\n');
}
export async function prepareBreeze(directory:string,context:SpeechContext,modelSource?:string){
 if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('Breeze 4bit 当前仅支持 Apple Silicon');
 const root=checkedDirectory(directory),lease=lock(root);
 try{checkPaths(root);if(breezeInstalled(root))return;
  const target=base(root);for(const path of [target,join(target,'model'),join(target,'.venv')])if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('Breeze 安装目录不能是符号链接');
  mkdirSync(target,{recursive:true,mode:0o700});
  let uv=[join(root,'bin','uv'),join(homedir(),'.local','bin','uv')].find(existsSync);
  if(!uv){const archive=join(root,'tmp','breeze-uv.tar.gz');await downloadSpeechFile('https://github.com/astral-sh/uv/releases/download/0.12.23/uv-aarch64-apple-darwin.tar.gz',archive,'50487ae565ccd96e499056b4674d438f4c53170202617b4c759defe0c6a1b544',context);await runCommand('/usr/bin/tar',['-xzf',archive,'-C',join(root,'tmp')],context,root);uv=join(root,'tmp','uv-aarch64-apple-darwin','uv');}
  context.stage('准备 Breeze 专用 Python 和固定依赖');
  const python=join(target,'.venv','bin','python');
  if(!existsSync(python))await runCommand(uv,['venv','--python','3.12.12',join(target,'.venv')],context,target);
  writeFileSync(join(target,'requirements.txt'),breezeRequirements,{mode:0o600});
  await runCommand(uv,['pip','sync','--python',python,join(target,'requirements.txt')],context,target);
  for(const f of breezeFiles){context.signal.throwIfAborted();context.stage('准备 Breeze 4bit · '+f.path);const path=join(target,'model',f.path);mkdirSync(dirname(path),{recursive:true,mode:0o700});
   const source=modelSource&&join(modelSource,f.path);
   if(source&&existsSync(source)&&await shaFile(source,context.signal)===f.sha256){if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw Error('模型文件不能是符号链接');copyFileSync(source,path);}
   else await downloadSpeechFile(f.url,path,f.sha256,context);
   if(stamp(path).bytes!==f.bytes)throw Error('Breeze 模型大小不符');
  }
  const marker=join(target,'installed.json');writeFileSync(marker+'.partial',JSON.stringify({revision:breezeRevision,requirements:breezeProfile.requirements,files:Object.fromEntries(breezeFiles.map(f=>[f.path,stamp(join(target,'model',f.path))]))}),{mode:0o600});renameSync(marker+'.partial',marker);context.stage('Breeze 4bit 已准备好');
 }finally{lease.release();}
}
export function createBreezeSpeechDriver():SpeechDriver{return {engineName:'Breeze TTS 2',engineLabel:'MLX 4bit',resourceProfile:breezeProfile,installed:breezeInstalled,prepare:(root,context)=>prepareBreeze(root,context),generate:async(directory,request,context)=>{
 if(!request.referenceText?.trim())throw Error('Breeze 克隆需要参考录音的完整文字稿');
 if(!breezeInstalled(directory))throw Error('请先准备 Breeze 4bit 模型');
 const root=checkedDirectory(directory),lease=lock(root),target=base(root),task=join(target,`request-${randomUUID()}.json`);
 try{context.signal.throwIfAborted();writeFileSync(task,JSON.stringify({...request,instruction:breezeInstruction(request),segments:speechSegments(request.text),model:join(target,'model')}),{flag:'wx',mode:0o600});context.stage('Breeze 4bit 正在生成');
  await runCommand(join(target,'.venv','bin','python'),['-c',breezeWorker,task],{...context,report:line=>{context.report(line);if(line.startsWith('Breeze 合成'))context.stage(line.trim());}},target);
 }finally{if(existsSync(task))unlinkSync(task);lease.release();}
}};}
