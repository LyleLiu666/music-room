import {existsSync,mkdirSync,readFileSync,openSync,writeFileSync,fsyncSync,closeSync,unlinkSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {setImmediate} from 'node:timers/promises';
import CodecParser,{type CodecFrame} from 'codec-parser';
import {z} from 'zod';
import {ProjectStore,ServiceError,hash,identity} from '../projects/store.ts';
import {readAudioFile} from '../projects/audio-files.ts';
import {audioShape} from './audio-budget.ts';
import type {StudioSound,StudioVersion} from './studio.ts';
export const soundImportLimit=100*1048576;
type ProjectSummary={id:string;title:string;deleted?:boolean;purged?:boolean};
type SoundItem={id:string;title:string;createdAt:string;duration?:number;audioPath:string};
export type CollectedSound=SoundItem&{origin:'generated';projectId:string;projectTitle:string;soundId:string;versionId:string;number:number;final:boolean;kept:boolean;extension:'wav'|'flac'};
export type ImportedSound=SoundItem&{origin:'imported';filename:string;extension:'wav'|'flac';duration:number};
export type LibrarySound=CollectedSound|ImportedSound;
/** Project decisions remain authoritative; collection never duplicates a generated audio file. */
export function collectedSounds(projects:ProjectSummary[],sounds:StudioSound[],versions:StudioVersion[],includeUncollected=false):CollectedSound[]{
 const owners=new Map(projects.filter(p=>!p.deleted&&!p.purged).map(p=>[p.id,p]));
 const active=new Map(sounds.filter(s=>!s.deleted&&!s.purged&&owners.has(s.projectId)).map(s=>[s.id,s]));
 return versions.flatMap(v=>{const s=active.get(v.soundId),final=s?.finalVersionId===v.id;if(!s||v.deleted||v.purged||v.purgePending||v.state!=='succeeded'||!v.audioPath||!(includeUncollected||final||v.kept))return [];
  return [{id:v.id,title:s.title,createdAt:v.createdAt,duration:v.duration,audioPath:v.audioPath,origin:'generated' as const,projectId:s.projectId,projectTitle:owners.get(s.projectId)!.title,soundId:s.id,versionId:v.id,number:v.number,final,kept:v.kept,extension:v.source.kind==='music'?'flac' as const:'wav' as const}];
 });
}
const recordSchema=z.object({id:z.string().regex(/^import-[a-f0-9-]{36}$/),title:z.string().min(1).max(120),filename:z.string().min(1).max(240),extension:z.enum(['wav','flac']),duration:z.number().positive().max(600),createdAt:z.iso.datetime(),sha256:z.string().regex(/^[a-f0-9]{64}$/),bytes:z.number().int().positive().max(soundImportLimit),requestId:z.string().min(1).max(80),requestHash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
type ImportRecord=z.infer<typeof recordSchema>;
const indexSchema=z.object({format:z.literal('music-room-sound-library'),version:z.literal(1),imports:z.array(recordSchema)}).strict();
const invalid=(message:string):never=>{throw new ServiceError('INVALID_AUDIO',message);};
/** Owned copies of external recordings, independent of projects and reference voices. */
export class SoundLibrary{
 private store:ProjectStore;private imports:ImportRecord[];private pending:Promise<unknown>=Promise.resolve();
 constructor(store:ProjectStore){
  this.store=store;const path=store.path('sound-library','index.json');this.imports=existsSync(path)?indexSchema.parse(JSON.parse(readFileSync(path,'utf8'))).imports:[];
  // Only the workspace owner can import. After a crash, an unindexed owned copy
  // was never published; reclaim it without touching unrelated user files.
  const directory=store.path('sound-library'),committed=new Set(this.imports.map(r=>`${r.id}.${r.extension}`));
  if(existsSync(directory))for(const name of readdirSync(directory))if(/^import-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(wav|flac)$/.test(name)&&!committed.has(name))unlinkSync(store.path('sound-library',name));
 }
 private item(r:ImportRecord):ImportedSound{return {id:r.id,title:r.title,filename:r.filename,extension:r.extension,duration:r.duration,createdAt:r.createdAt,origin:'imported',audioPath:`/sound-library/audio/${r.id}`};}
 list(){return this.imports.map(r=>this.item(r));}
 async import(args:{name:string;title?:string;requestId:string;bytes:Uint8Array},signal?:AbortSignal):Promise<ImportedSound>{
  const next=this.pending.then(async()=>{signal?.throwIfAborted();const {bytes,name}=args;
   if(!name.trim()||name.length>240||/[\\/\u0000-\u001f\u007f]/.test(name))invalid('请选择有效的音频文件名');
   const title=(args.title??name.replace(/\.[^.]+$/,'')).trim();if(!title||title.length>120)invalid('声音名称需要 1–120 个字符');identity(args.requestId);
   if(!bytes.length||bytes.length>soundImportLimit)invalid('音频文件不能超过 100 MiB');
   const sha256=hash(bytes),requestHash=hash(JSON.stringify({name,title,sha256})),existing=this.imports.find(r=>r.requestId===args.requestId);
   if(existing){if(existing.requestHash!==requestHash)throw new ServiceError('CONFLICT','重复请求的音频或名称不同，请重新导入');return this.item(existing);}
   const shape=audioShape(bytes),extension=Buffer.from(bytes.subarray(0,4)).toString()==='fLaC'?'flac':'wav';
   if(extension==='flac'){
    const parser=new CodecParser<CodecFrame>('audio/flac',{enableLogging:false});let frames=0,blocks=0;
    const consume=(iterator:Iterator<CodecFrame>)=>{for(let item=iterator.next();!item.done;item=iterator.next()){const frame=item.value;if(!Number.isSafeInteger(frame.samples)||frame.samples<1||frame.header.sampleRate!==shape.rate||frame.header.channels!==shape.channels)invalid('FLAC 音频帧无效');frames+=frame.samples;if(frames>shape.frames)invalid('FLAC 音频长度与声明不同');}};
    for(let at=0;at<bytes.length;at+=65536){signal?.throwIfAborted();consume(parser.parseChunk(bytes.subarray(at,at+65536)));if(++blocks%64===0)await setImmediate();}consume(parser.flush());if(frames!==shape.frames)invalid('FLAC 音频不完整，实际长度与声明不同');
   }
   signal?.throwIfAborted();const r:ImportRecord={id:`import-${randomUUID()}`,title,filename:name,extension,duration:shape.frames/shape.rate,createdAt:new Date().toISOString(),sha256,bytes:bytes.length,requestId:args.requestId,requestHash};
   const dir=this.store.path('sound-library');mkdirSync(dir,{recursive:true,mode:0o700});const path=this.store.path('sound-library',`${r.id}.${extension}`);let fd:number|undefined;
   try{fd=openSync(path,'wx',0o600);writeFileSync(fd,bytes);fsyncSync(fd);closeSync(fd);fd=undefined;signal?.throwIfAborted();this.store.atomicJSON(this.store.path('sound-library','index.json'),{format:'music-room-sound-library',version:1,imports:[...this.imports,r]});this.imports.push(r);return this.item(r);}
   catch(e){if(fd!==undefined)closeSync(fd);if(existsSync(path))unlinkSync(path);throw e;}
  });this.pending=next.catch(()=>{});return next;
 }
 async audio(id:string){const r=this.imports.find(r=>r.id===identity(id));if(!r)throw new ServiceError('NOT_FOUND','声音不存在');const bytes=await readAudioFile(this.store.path('sound-library',`${r.id}.${r.extension}`),soundImportLimit,r.bytes);if(hash(bytes)!==r.sha256)invalid('音频文件已被修改，请重新导入完整文件');return bytes;}
 contentType(id:string){const r=this.imports.find(r=>r.id===identity(id));if(!r)throw new ServiceError('NOT_FOUND','声音不存在');return r.extension==='flac'?'audio/flac':'audio/wav';}
 async close(){await this.pending;}
}
