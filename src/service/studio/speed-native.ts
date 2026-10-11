import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {encodeWav} from '../../wav.ts';
import {audioShape} from './audio-budget.ts';

export type SpeedAssetReader=(path:string)=>Promise<Uint8Array>;
const sourceAssets:SpeedAssetReader=path=>readFile(new URL(`../../../public/${path}`,import.meta.url));

/** R3 two-pass offline render, supervised by the existing speed worker. */
export async function renderNativeSpeed(channels:Float32Array[],sampleRate:number,rate:number,signal?:AbortSignal,read:SpeedAssetReader=sourceAssets){
 signal?.throwIfAborted();
 const asset=`speed-native/rubberband-darwin-${process.arch}`;
 const program=await read(asset).catch(()=>{throw new Error('原生调速程序缺失，请重新构建应用（npm run build）');});
 const directory=await mkdtemp(join(tmpdir(),'music-room-speed-native-'));
 try{
  const executable=join(directory,'render'),input=join(directory,'input.wav'),output=join(directory,'output.wav');
  await writeFile(executable,program,{mode:0o700});
  await writeFile(input,new Uint8Array(encodeWav(channels,sampleRate)),{mode:0o600});
  signal?.throwIfAborted();
  await new Promise<void>((resolve,reject)=>{
   // Keep stdin open until completion. The native child exits on EOF if we die.
   const child=spawn(executable,[input,output,String(rate)],{stdio:['pipe','ignore','pipe']});
   let error='',failure:unknown,timer:ReturnType<typeof setTimeout>|undefined;
   const stop=()=>{child.stdin.end();child.kill('SIGTERM');timer??=setTimeout(()=>child.kill('SIGKILL'),1500);};
   const timeout=setTimeout(()=>{failure=new Error('原生调速处理超时');stop();},120000);
   child.stdin.on('error',()=>{});
   child.stderr.on('data',chunk=>error=(error+chunk).slice(-2000));
   child.once('error',e=>failure=e);
   signal?.addEventListener('abort',stop,{once:true});
   child.once('close',code=>{
    clearTimeout(timeout);if(timer)clearTimeout(timer);signal?.removeEventListener('abort',stop);
    if(signal?.aborted)reject(signal.reason);
    else if(failure||code!==0)reject(failure??new Error(error||'原生调速处理失败'));
    else resolve();
   });
   if(signal?.aborted)stop();
  });
  signal?.throwIfAborted();
  const bytes=new Uint8Array(await readFile(output)),shape=audioShape(bytes);
  if(shape.rate!==sampleRate||shape.channels!==channels.length||shape.frames!==Math.round(channels[0].length/rate))throw new Error('原生调速输出格式或长度无效');
  return bytes;
 }finally{await rm(directory,{recursive:true,force:true});}
}
