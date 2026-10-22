import type {LyricJob} from './lyrics-generation.ts';
import {existsSync,readFileSync,lstatSync} from 'node:fs';
import {join} from 'node:path';
import {identity,ServiceError} from '../projects/store.ts';
export type LyricLine={text:string;start:number;end:number};
export type LyricsResult={canGenerate?:boolean;available?:boolean;unavailableReason?:string;job?:LyricJob;kind:'none'|'plain'|'synced';reference:string;lines:LyricLine[];draft:boolean};
export function referenceLyrics(input?:{instrumental?:boolean;lyrics?:string}){return input?.instrumental===true?'':input?.lyrics??'';}
/** Sidecars belong to one immutable audio version; input lyrics never imply a timeline. */
export function readLyrics(directory:string,v:{id:string;audioPath?:string;input?:{instrumental?:boolean;lyrics?:string};audioHash?:string}):LyricsResult{
 const file=join(directory,identity(v.id)+'.json'),reference=referenceLyrics(v.input);
 const fallback:LyricsResult={kind:reference.trim()?'plain':'none',reference,lines:[],draft:false};
 if(v.input?.instrumental===true||!existsSync(file))return fallback;
 if(lstatSync(file).isSymbolicLink()||lstatSync(file).size>1024*1024)throw new ServiceError('INVALID_LYRICS','歌词文件无效');
 const doc=JSON.parse(readFileSync(file,'utf8'));
 if(doc.versionId!==v.id||doc.audioPath!==v.audioPath||v.audioHash&&doc.audioSha256!==v.audioHash)return fallback;
 if(doc.format!=='music-room-lyrics'||doc.version!==1||!Number.isFinite(doc.duration)||doc.duration<=0||!Array.isArray(doc.lines)||!doc.lines.length||doc.lines.length>5000)throw new ServiceError('INVALID_LYRICS','歌词格式无效');
 let previous=-1;
 const lines:LyricLine[]=doc.lines.map((line:LyricLine)=>{
  if(typeof line.text!=='string'||!line.text.trim()||line.text.length>2000||/[\r\n]/.test(line.text)||!Number.isFinite(line.start)||!Number.isFinite(line.end)||line.start<previous||line.start<0||line.end<=line.start||line.end>doc.duration)throw new ServiceError('INVALID_LYRICS','歌词时间轴无效');
  previous=line.start;return {text:line.text,start:line.start,end:line.end};
 });
 return {kind:'synced',reference,lines,draft:doc.draft!==false};
}
export function lyricsLrc(lines:LyricLine[]):string{return lines.map(line=>{const t=Math.round(line.start*100);return `[${String(Math.floor(t/6000)).padStart(2,'0')}:${String(Math.floor(t/100)%60).padStart(2,'0')}.${String(t%100).padStart(2,'0')}]${line.text}`;}).join('\n')+'\n';}
