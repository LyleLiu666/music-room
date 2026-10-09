import {createHash} from 'node:crypto';
import {createReadStream,createWriteStream,existsSync,lstatSync,readFileSync,renameSync,writeFileSync,mkdirSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type {SpeechContext} from './speech.ts';
import type {AssetReader} from '../render/renderer.ts';
import {nativeProgramManifest} from './native-program-manifest.ts';
import {runCommand} from './python-runtime.ts';
export const nativeProgramAsset=nativeProgramManifest.asset;
export type NativeDistribution={version:string;programUrl:string;programSha256:string;modelUrl:string;modelSha256:string;modelBytes:number};
export const nativeDistribution:NativeDistribution={version:nativeProgramManifest.version,programUrl:'https://raw.githubusercontent.com/LyleLiu666/music-room/main/public/'+nativeProgramAsset,programSha256:nativeProgramManifest.archiveSha256,modelUrl:'https://huggingface.co/audio-cpp/audio.cpp-gguf/resolve/a199f1a00ae893af0067caeab51f810de4c728a5/IndexTTS2-GGUF/index-tts2-f16.gguf',modelSha256:'0f7b95d3d32e18bf9352912a7b21a0bd4a8406853a0aaa2c9180f77389c21523',modelBytes:4646898304};
export const nativePaths=(root:string)=>({base:join(root,'audio-cpp'),program:join(root,'audio-cpp','release','audiocpp_server'),model:join(root,'audio-cpp','models','index-tts2-f16.gguf'),metadata:join(root,'audio-cpp','installed.json')});
const stamp=(path:string)=>{const s=lstatSync(path);if(!s.isFile()||s.isSymbolicLink())throw new Error('推理文件不能是符号链接');return {bytes:s.size,mtimeMs:s.mtimeMs};};
export function nativeInstalled(root:string,d=nativeDistribution){
 try{const p=nativePaths(root);if(lstatSync(p.base).isSymbolicLink())return false;for(const path of [join(p.base,'models'),join(p.base,'release'),p.metadata])if(lstatSync(path).isSymbolicLink())return false;const m=JSON.parse(readFileSync(p.metadata,'utf8'));return m.engine==='audio.cpp'&&m.version===d.version&&m.precision==='f16'&&m.programSha256===d.programSha256&&m.modelSha256===d.modelSha256&&JSON.stringify(stamp(p.program))===JSON.stringify(m.program)&&JSON.stringify(stamp(p.model))===JSON.stringify(m.model)&&m.model.bytes===d.modelBytes;}catch{return false;}
}
async function hashFile(path:string,signal?:AbortSignal){const hash=createHash('sha256');for await(const bytes of createReadStream(path)){signal?.throwIfAborted();hash.update(bytes);}return hash.digest('hex');}
/** Stream multi-gigabyte models to disk, never buffer them in application memory. */
async function download(url:string,path:string,sha:string,context:SpeechContext){
 context.signal.throwIfAborted();if(existsSync(path)&&!lstatSync(path).isSymbolicLink()&&await hashFile(path,context.signal)===sha)return;
 const partial=path+'.partial';let start=existsSync(partial)?lstatSync(partial).size:0;
 if(existsSync(partial)&&lstatSync(partial).isSymbolicLink())throw new Error('下载暂存文件不能是符号链接');
 const response=await fetch(url,{signal:context.signal,headers:start?{Range:`bytes=${start}-`}:{}});
 if(!response.ok||!response.body)throw new Error(`模型下载失败：HTTP ${response.status}`);
 if(start&&response.status!==206)start=0;
 if(start&&response.headers.get('content-range')?.split('/')[0]!==`bytes ${start}-${start+Number(response.headers.get('content-length'))-1}`)throw new Error('续传范围与暂存文件不一致');
 let downloaded=start,last=Date.now();const total=start+Number(response.headers.get('content-length')??0);
 const meter=new Transform({transform(chunk,_,callback){downloaded+=chunk.length;if(Date.now()-last>2000){context.stage(`下载语音模型 · ${(downloaded/2**30).toFixed(2)}${total?'/'+(total/2**30).toFixed(2):''} GiB`);last=Date.now();}callback(null,chunk);}});
 await pipeline(Readable.fromWeb(response.body as any),meter,createWriteStream(partial,{flags:start?'a':'w',mode:0o600}),{signal:context.signal});
 if(await hashFile(partial,context.signal)!==sha){rmSync(partial,{force:true});throw new Error('下载文件校验失败');}context.signal.throwIfAborted();renameSync(partial,path);
}
export async function installNative(root:string,context:SpeechContext,d=nativeDistribution,read?:AssetReader){
 const p=nativePaths(root);if(existsSync(p.base)&&lstatSync(p.base).isSymbolicLink())throw new Error('推理安装目录不能是符号链接');mkdirSync(p.base,{recursive:true,mode:0o700});for(const path of [join(p.base,'models'),join(p.base,'release'),p.metadata])if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new Error('推理环境内部路径不能是符号链接');mkdirSync(join(p.base,'models'),{recursive:true,mode:0o700});
 context.stage('准备 audio.cpp F16 推理程序');const archive=join(p.base,'program.tar.gz');
 if(read){const program=await read(nativeProgramAsset);context.signal.throwIfAborted();if(createHash('sha256').update(program).digest('hex')!==d.programSha256)throw new Error('内置推理程序校验失败');const partial=archive+'.partial';for(const path of [archive,partial])if(existsSync(path)&&lstatSync(path).isSymbolicLink())throw new Error('推理程序暂存文件不能是符号链接');writeFileSync(partial,program,{mode:0o600});renameSync(partial,archive);}
 else await download(d.programUrl,archive,d.programSha256,context);
 const staging=join(p.base,'unpack');rmSync(staging,{recursive:true,force:true});mkdirSync(staging,{mode:0o700});
 await runCommand('/usr/bin/tar',['-xzf',archive,'-C',staging],context,p.base);stamp(join(staging,'audiocpp_server'));chmodSync(join(staging,'audiocpp_server'),0o700);
 const release=join(p.base,'release');rmSync(release,{recursive:true,force:true});renameSync(staging,release);
 context.stage('准备 IndexTTS 2.0 F16 模型');await download(d.modelUrl,p.model,d.modelSha256,context);if(stamp(p.model).bytes!==d.modelBytes)throw new Error('模型大小校验失败');
 const metadata={engine:'audio.cpp',version:d.version,precision:'f16',programSha256:d.programSha256,modelSha256:d.modelSha256,program:stamp(p.program),model:stamp(p.model),installedAt:new Date().toISOString()};writeFileSync(p.metadata+'.partial',JSON.stringify(metadata),{mode:0o600});renameSync(p.metadata+'.partial',p.metadata);context.stage('audio.cpp F16 已准备好');
}
