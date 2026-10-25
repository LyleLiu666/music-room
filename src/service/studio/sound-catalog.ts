import {existsSync,mkdirSync,readFileSync} from 'node:fs';
import {z} from 'zod';
import {ProjectStore,ServiceError,hash,identity} from '../projects/store.ts';
import type {LibrarySound} from './sound-library.ts';
const key=z.string().min(1).max(80).regex(/^[a-z0-9][a-z0-9-]*$/);
export const catalogQuery={query:z.string().max(240).optional(),filter:z.enum(['all','final','kept','imported']).optional(),sort:z.enum(['newest','oldest','title']).optional(),playlistId:key.optional()};
export type CatalogQuery={query?:string;filter?:'all'|'final'|'kept'|'imported';sort?:'newest'|'oldest'|'title';playlistId?:string};
export type CatalogEntry={id:string;title:string;item:LibrarySound|null};
const entry=z.object({id:key,title:z.string().min(1).max(240)}).strict();
const playlist=z.object({id:key,title:z.string().trim().min(1).max(120),revision:z.number().int().positive(),entries:z.array(entry).max(20000)}).strict();
const document=z.object({format:z.literal('music-room-playlists'),version:z.literal(1),playlists:z.array(playlist)}).strict();
type Playlist=z.infer<typeof playlist>;
export const playlistSave=z.object({id:key,title:z.string().trim().min(1).max(120),revision:z.number().int().nonnegative(),ids:z.array(key).max(20000)}).strict();
export type PlaylistSummary={id:string;title:string;revision:number;count:number};
const summary=(p:Playlist):PlaylistSummary=>({id:p.id,title:p.title,revision:p.revision,count:p.entries.length});
export const soundCatalogRevision=(items:LibrarySound[],playlists:PlaylistSummary[])=>hash(JSON.stringify([[...items].sort((a,b)=>a.id.localeCompare(b.id)),[...playlists].sort((a,b)=>a.id.localeCompare(b.id))]));
/** Saved lists reference exact versions. Missing audio keeps its last known name. */
export class SoundCatalog{
 private records:Playlist[];private pending:Promise<unknown>=Promise.resolve();
 private store:ProjectStore;private available:()=>Promise<LibrarySound[]>;
 constructor(store:ProjectStore,available:()=>Promise<LibrarySound[]>){
  this.store=store;this.available=available;
  const path=store.path('sound-library','playlists.json');this.records=existsSync(path)?document.parse(JSON.parse(readFileSync(path,'utf8'))).playlists:[];
 }
 playlists(){return this.records.map(summary);}
 private get(id:string){const p=this.records.find(p=>p.id===identity(id));if(!p)throw new ServiceError('NOT_FOUND','播放列表不存在，可能已在其他窗口删除');return p;}
 private write(records:Playlist[]){mkdirSync(this.store.path('sound-library'),{recursive:true,mode:0o700});this.store.atomicJSON(this.store.path('sound-library','playlists.json'),{format:'music-room-playlists',version:1,playlists:records});this.records=records;}
 private async entries(options:CatalogQuery){
  const all=await this.available(),byId=new Map(all.map(i=>[i.id,i]));
  const collected=all.filter(i=>i.origin==='imported'||i.final||i.kept);
  let entries:CatalogEntry[]=options.playlistId?this.get(options.playlistId).entries.map(e=>({id:e.id,title:byId.get(e.id)?.title??e.title,item:byId.get(e.id)??null})):collected.map(item=>({id:item.id,title:item.title,item}));
  const query=(options.query??'').trim().toLocaleLowerCase();
  entries=entries.filter(({title,item})=>(!options.filter||options.filter==='all'||(options.filter==='imported'?item?.origin==='imported':item?.origin==='generated'&&(options.filter==='final'?item.final:item.kept)))&&`${title} ${item?.origin==='generated'?item.projectTitle:item?.origin==='imported'?item.filename:''}`.toLocaleLowerCase().includes(query));
  if(!options.playlistId)entries.sort((a,b)=>options.sort==='title'?a.title.localeCompare(b.title)||a.id.localeCompare(b.id):options.sort==='oldest'?(a.item!.createdAt.localeCompare(b.item!.createdAt)||a.id.localeCompare(b.id)):(b.item!.createdAt.localeCompare(a.item!.createdAt)||b.id.localeCompare(a.id)));
  return {entries,libraryTotal:collected.length,revision:soundCatalogRevision(all,this.playlists())};
 }
 async page(options:CatalogQuery&{page?:number;pageSize?:number}){
  const {entries,libraryTotal,revision}=await this.entries(options),pageSize=options.pageSize??20;
  if(![20,50].includes(pageSize)||!Number.isSafeInteger(options.page??1)||(options.page??1)<1)throw new ServiceError('INVALID_REQUEST','分页参数无效');
  const total=entries.length,totalPages=Math.max(1,Math.ceil(total/pageSize)),page=Math.min(options.page??1,totalPages);
  return {items:entries.slice((page-1)*pageSize,page*pageSize),total,totalPages,page,pageSize,libraryTotal,revision,playlists:this.playlists()};
 }
 async queue(options:CatalogQuery){const {entries}=await this.entries(options);return {ids:entries.map(e=>e.id),title:options.playlistId?this.get(options.playlistId).title:options.query?'搜索结果':'声音库'};}
 async items(ids:string[]){
  const all=new Map((await this.available()).map(i=>[i.id,i]));const saved=new Map(this.records.flatMap(p=>p.entries).map(e=>[e.id,e.title]));
  return {items:ids.map(id=>({id,title:all.get(id)?.title??saved.get(id)??'声音暂不可用',item:all.get(id)??null}))};
 }
 save(input:z.infer<typeof playlistSave>){
  const args=playlistSave.parse(input);
  const task=this.pending.then(async()=>{
   const previous=this.records.find(p=>p.id===args.id);if((previous?.revision??0)!==args.revision){if(previous?.title===args.title&&JSON.stringify(previous.entries.map(e=>e.id))===JSON.stringify([...new Set(args.ids)]))return summary(previous);throw new ServiceError('CONFLICT','播放列表已改变，请刷新后再操作');}
   const all=new Map((await this.available()).map(i=>[i.id,i.title])),saved=new Map(previous?.entries.map(e=>[e.id,e.title]));
   const entries=[...new Set(args.ids)].map(id=>{const title=all.get(id)??saved.get(id);if(!title)throw new ServiceError('NOT_FOUND','要添加的声音已不可用，请刷新后重新选择');return {id,title};});
   const record:Playlist={id:args.id,title:args.title,revision:args.revision+1,entries};this.write([...this.records.filter(p=>p.id!==args.id),record]);return summary(record);
  });this.pending=task.catch(()=>{});return task;
 }
 remove(args:{id:string;revision:number}){
  const task=this.pending.then(()=>{const p=this.get(args.id);if(p.revision!==args.revision)throw new ServiceError('CONFLICT','播放列表已改变，请刷新后再操作');this.write(this.records.filter(r=>r.id!==p.id));return {removed:true as const};});this.pending=task.catch(()=>{});return task;
 }
 async close(){await this.pending;}
}
