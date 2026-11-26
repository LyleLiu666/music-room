import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {musicDurationCheckSchema,musicTruncationSchema,type MusicDurationCheck,type MusicTruncation} from './contracts.ts';
import {musicDurationTolerance} from './duration.ts';

export {generationWithEnding} from './input.ts';

function readBoundedJson(path:string):unknown{
 let fd:number|undefined;
 try{
  fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const info=fstatSync(fd);
  if(!info.isFile()||info.size>65536)return;
  const bytes=Buffer.alloc(info.size);let at=0;
  while(at<bytes.length){const count=readSync(fd,bytes,at,bytes.length-at,at);if(!count)return;at+=count;}
  if(fstatSync(fd).size!==info.size)return;
  return JSON.parse(bytes.toString('utf8'));
 }catch{return undefined;}finally{if(fd!==undefined)closeSync(fd);}
}

/** Upstream sometimes omits truncation in its API even though summary.json contains it.
 * Call only beneath the already validated artifact directory. Missing evidence is not success.
 */
export function readTruncation(path:string):MusicTruncation|undefined{
 const raw=readBoundedJson(path) as {truncated?:unknown}|undefined;
 const parsed=musicTruncationSchema.safeParse(raw?.truncated);
 return parsed.success?parsed.data:undefined;
}

/** Read duration.json beneath a validated song directory without following symlinks. */
export function readDurationCheck(path:string):MusicDurationCheck|undefined{
 const raw=readBoundedJson(path) as {targetSeconds?:unknown;audioSeconds?:unknown;audioWithinTarget?:unknown;tolerance?:unknown}|undefined;
 if(!raw)return;
 const parsed=musicDurationCheckSchema.safeParse({targetSeconds:raw.targetSeconds,actualSeconds:raw.audioSeconds,withinTarget:raw.audioWithinTarget,tolerance:raw.tolerance??musicDurationTolerance});
 return parsed.success?parsed.data:undefined;
}
