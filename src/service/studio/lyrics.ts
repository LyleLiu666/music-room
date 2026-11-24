import type {LyricJob} from './lyrics-generation.ts';
import {createHash} from 'node:crypto';
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {identity,ServiceError} from '../projects/store.ts';
export type LyricLine={text:string;start:number;end:number};
export type UnlocatedLyric={text:string;window?:[number,number];reason?:string};
export type LyricsReview={revision:string;lines:LyricLine[];pending:{index:number;text:string}[]};
type LyricsBase={canGenerate?:boolean;available?:boolean;unavailableReason?:string;job?:LyricJob;reference:string;lines:LyricLine[];draft:boolean};
export type LyricsResult=LyricsBase&({kind:'none'|'plain'}|{kind:'synced';duration:number;revision:string;unresolved:UnlocatedLyric[];manuallyEdited:boolean});
type LyricVersion={id:string;audioPath?:string;input?:{instrumental?:boolean;lyrics?:string};audioHash?:string};
const sidecarLimit=1024*1024;
const validText=(text:unknown):text is string=>typeof text==='string'&&!!text.trim()&&text.length<=2000&&!/[\r\n]/.test(text);
function validateLines(lines:unknown,duration:number):LyricLine[]{
 if(!Array.isArray(lines)||!lines.length||lines.length>5000)throw new ServiceError('INVALID_LYRICS','请至少保留一句有起止时间的歌词');
 let previous=-1;
 return lines.map((line:LyricLine)=>{
  if(!line||!validText(line.text)||!Number.isFinite(line.start)||!Number.isFinite(line.end)||line.start<previous||line.start<0||line.end<=line.start||line.end>duration)throw new ServiceError('INVALID_LYRICS','歌词时间轴无效，请检查起止时间和音频时长');
  previous=line.start;return {text:line.text,start:line.start,end:line.end};
 });
}
export function referenceLyrics(input?:{instrumental?:boolean;lyrics?:string}){return input?.instrumental===true?'':input?.lyrics??'';}
/** Sidecars belong to one immutable audio version; input lyrics never imply a timeline. */
function readSidecar(directory:string,v:LyricVersion){
 const file=join(directory,identity(v.id)+'.json');
 if(v.input?.instrumental===true||!existsSync(file))return;
 const stat=lstatSync(file);
 if(!stat.isFile()||stat.size>sidecarLimit)throw new ServiceError('INVALID_LYRICS','歌词文件无效');
 const content=readFileSync(file,'utf8'),doc=JSON.parse(content);
 if(doc.versionId!==v.id||doc.audioPath!==v.audioPath||v.audioHash&&doc.audioSha256!==v.audioHash)return;
 const duration:number=doc.duration;
 if(doc.format!=='music-room-lyrics'||doc.version!==1||!Number.isFinite(duration)||duration<=0)throw new ServiceError('INVALID_LYRICS','歌词格式无效');
 const lines=validateLines(doc.lines,duration),unresolved:UnlocatedLyric[]=[];
 if(Array.isArray(doc.unresolved)){
  for(const item of doc.unresolved){
   if(!item||!validText(item.text))continue;
   const issue:UnlocatedLyric={text:item.text};
   if(Array.isArray(item.window)&&item.window.length===2){
    const [start,end]=item.window;
    if(Number.isFinite(start)&&Number.isFinite(end)&&start>=0&&start<end&&end<=duration)issue.window=[start,end];
   }
   if(validText(item.reason))issue.reason=item.reason;
   unresolved.push(issue);
  }
 }
 const result:Extract<LyricsResult,{kind:'synced'}>={kind:'synced',reference:referenceLyrics(v.input),lines,draft:doc.draft!==false,duration,
  revision:createHash('sha256').update(content).digest('hex'),unresolved,manuallyEdited:doc.source==='manual'};
 return {file,doc,result};
}
export function readLyrics(directory:string,v:LyricVersion):LyricsResult{
 const stored=readSidecar(directory,v),reference=referenceLyrics(v.input);
 return stored?.result??{kind:reference.trim()?'plain':'none',reference,lines:[],draft:false};
}
export function saveLyricsReview(directory:string,v:LyricVersion,update:LyricsReview,write:(path:string,value:unknown)=>void){
 const current=readSidecar(directory,v);
 if(!current)throw new ServiceError('NOT_FOUND','此版本没有可校对的同步歌词');
 if(update?.revision!==current.result.revision)throw new ServiceError('CONFLICT','歌词已更新，请重新打开校对后再保存');
 const {duration,unresolved}=current.result;
 const lines=validateLines(update.lines,duration);
 if(!Array.isArray(update.pending)||update.pending.length>unresolved.length)throw new ServiceError('INVALID_LYRICS','待定位的歌词无效');
 const remaining:UnlocatedLyric[]=[],seen=new Set<number>();
 for(const item of update.pending){
  if(!item||!Number.isInteger(item.index)||!unresolved[item.index]||seen.has(item.index)||!validText(item.text))throw new ServiceError('INVALID_LYRICS','待定位的歌词无效');
  seen.add(item.index);remaining.push({...unresolved[item.index],text:item.text});
 }
 const doc={...current.doc,lines,unresolved:remaining,draft:remaining.length>0,source:'manual',editedAt:new Date().toISOString()};
 if(Buffer.byteLength(JSON.stringify(doc,null,2))>sidecarLimit)throw new ServiceError('TOO_LARGE','校对后的歌词超过保存上限');
 write(current.file,doc);
 return readLyrics(directory,v);
}
export function lyricsLrc(lines:LyricLine[]):string{return lines.map(line=>{const t=Math.round(line.start*100);return `[${String(Math.floor(t/6000)).padStart(2,'0')}:${String(Math.floor(t/100)%60).padStart(2,'0')}.${String(t%100).padStart(2,'0')}]${line.text}`;}).join('\n')+'\n';}
