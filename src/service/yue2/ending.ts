import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {musicTruncationSchema,type MusicEnding,type MusicTruncation} from './contracts.ts';

/** Explicit preference, never inferred from words in the user's creative description. */
export function generationWithEnding(input:{style:string;lyrics:string;instrumental:boolean;ending?:MusicEnding}){
 if(input.ending==='as-described')return {style:input.style,lyrics:input.lyrics};
 const guidance='Ending arrangement: plan a complete outro. Finish the final musical phrase and resolve the harmony; gradually thin the accompaniment, sustain the final chord, and allow its natural decay before ending. Do not introduce a new phrase at the end or stop mid-phrase.';
 return {
  style:input.style+'\n\n'+guidance+(input.instrumental?'':' Finish singing all supplied lyrics before the instrumental outro. Do not sing these arrangement instructions.'),
  // [instrumental] is the API's explicit default protocol; custom structures and lyrics stay intact.
  lyrics:input.instrumental&&input.lyrics.trim()==='[instrumental]'?'[instrumental]\n[intro]\n[verse]\n[outro]':input.lyrics,
 };
}

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
