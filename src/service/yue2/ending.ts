import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {musicTruncationSchema,type MusicTruncation} from './contracts.ts';

export {generationWithEnding} from './input.ts';

/** Upstream sometimes omits truncation in its API even though summary.json contains it.
 * Call only beneath the already validated artifact directory. Missing evidence is not success.
 */
export function readTruncation(path:string):MusicTruncation|undefined{
 let fd:number|undefined;
 try{
  fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const info=fstatSync(fd);
  if(!info.isFile()||info.size>65536)return;
  const bytes=Buffer.alloc(info.size);let at=0;
  while(at<bytes.length){const count=readSync(fd,bytes,at,bytes.length-at,at);if(!count)return;at+=count;}
  if(fstatSync(fd).size!==info.size)return;
  const parsed=musicTruncationSchema.safeParse(JSON.parse(bytes.toString('utf8')).truncated);
  return parsed.success?parsed.data:undefined;
 }catch{return undefined;}finally{if(fd!==undefined)closeSync(fd);}
}
