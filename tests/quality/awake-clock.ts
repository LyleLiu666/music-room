import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

/** Node/libuv's Darwin clock includes sleep; model acceptance needs awake elapsed time. */
export async function createAwakeClock(){
 if(process.platform!=='darwin')throw Error('Real-model awake clock currently requires macOS');
 const directory=await mkdtemp(join(tmpdir(),'music-room-awake-clock-')),path=join(directory,'clock'),run=promisify(execFile);
 try{
  await run('/usr/bin/clang',['-O2',fileURLToPath(new URL('./awake-clock.c',import.meta.url)),'-o',path],{timeout:60000});
  const now=async()=>{
   const {stdout}=await run(path,[],{timeout:10000});const value=Number(stdout.trim());
   if(!Number.isFinite(value)||value<0)throw Error('Invalid macOS awake clock');
   return value;
  };
  await now();return {now,close:()=>rm(directory,{recursive:true,force:true})};
 }catch(error){await rm(directory,{recursive:true,force:true});throw error;}
}
