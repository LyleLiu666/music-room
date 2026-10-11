import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {renderNativeSpeed} from './speed-native.ts';
import {encodeWav} from '../../wav.ts';

test('missing native renderer fails explicitly instead of silently reverting to WSOLA',async()=>{
 await assert.rejects(renderNativeSpeed([new Float32Array(24000)],24000,.8,undefined,async()=>{throw Error('missing');}),/原生调速程序缺失/);
});

test('native speed observes cancellation during rendering', {skip:process.platform!=='darwin'}, async()=>{
 const controller=new AbortController(),reason=new Error('cancel native render');
 const samples=new Float32Array(96000*10).fill(.1);
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{
  await assert.rejects(renderNativeSpeed([samples],96000,.5,controller.signal,async path=>{
   const bytes=await readFile(new URL(`../../../public/${path}`,import.meta.url));
   timer=setTimeout(()=>controller.abort(reason),100);return bytes;
  }),error=>error===reason);
 }finally{if(timer)clearTimeout(timer);}
});

test('native renderer exits when the worker pipe closes', {skip:process.platform!=='darwin'}, async()=>{
 const directory=await mkdtemp(join(tmpdir(),'native-speed-eof-'));
 try{
  const input=join(directory,'input.wav');
  await writeFile(input,new Uint8Array(encodeWav([new Float32Array(24000*60)],24000)));
  const executable=fileURLToPath(new URL(`../../../public/speed-native/rubberband-darwin-${process.arch}`,import.meta.url));
  const child=spawn(executable,[input,join(directory,'output.wav'),'.5'],{stdio:['pipe','ignore','pipe']});
  child.stderr.resume();child.stdin.on('error',()=>{});
  const timer=setTimeout(()=>child.kill('SIGKILL'),5000);
  try{
   const closed=new Promise<number|null>((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
   child.stdin.end();assert.equal(await closed,1,'EOF must stop the owned renderer');
  }finally{clearTimeout(timer);child.kill('SIGKILL');}
 }finally{await rm(directory,{recursive:true,force:true});}
});
