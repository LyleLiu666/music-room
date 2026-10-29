import {readAudioBlob} from '../audio-response.ts';

export const AUDIO_READ_LIMIT_BYTES=120_000_000;
export const AUDIO_CACHE_LIMIT_BYTES=64*1048576;
export const AUDIO_CACHE_LIMIT_ENTRIES=6;

export interface AudioUrlCacheOptions {
 request:(path:string,init:RequestInit)=>Promise<Response>;
 activeUrls:()=>Iterable<string>;
 createObjectURL?:(blob:Blob)=>string;
 revokeObjectURL?:(url:string)=>void;
}

type CachedAudio={url:string;size:number};
type PendingAudio={controller:AbortController;task:Promise<string>};

/** Full-blob cache with transport and active-player ownership supplied by its host.
 * Pass the authenticated service request, not raw fetch. Paths (including format
 * queries) are exact keys. Active/newest URLs may exceed the soft LRU budget,
 * matching the player's existing policy rather than interrupting playback. */
export class AudioUrlCache {
 private readonly options:AudioUrlCacheOptions;
 private readonly entries=new Map<string,CachedAudio>();
 private readonly pending=new Map<string,PendingAudio>();
 private cachedBytes=0;
 private disposed=false;

 constructor(options:AudioUrlCacheOptions){this.options=options;}

 get(path:string):Promise<string>{
  if(this.disposed)return Promise.reject(this.staleError());
  const found=this.entries.get(path);
  if(found){this.entries.delete(path);this.entries.set(path,found);return Promise.resolve(found.url);}
  const existing=this.pending.get(path);if(existing)return existing.task;
  // Install the owner before invoking transport; even a synchronous throw is
  // shared and releases the slot. No rejected promise is retained for a retry.
  const pending:PendingAudio={controller:new AbortController(),task:undefined!};
  pending.task=Promise.resolve().then(()=>this.read(path,pending)).finally(()=>{
   if(this.pending.get(path)===pending)this.pending.delete(path);
  });
  this.pending.set(path,pending);return pending.task;
 }

 private async read(path:string,pending:PendingAudio):Promise<string>{
  this.assertCurrent(path,pending);
  const response=await this.options.request(path,{signal:pending.controller.signal});
  if(!this.isCurrent(path,pending)){
   await response.body?.cancel();throw this.staleError();
  }
  if(!response.ok){await response.body?.cancel();throw Error('音频暂时无法读取，请检查文件是否完整');}
  const blob=await readAudioBlob(response,AUDIO_READ_LIMIT_BYTES);
  this.assertCurrent(path,pending);
  const url=this.options.createObjectURL?.(blob)??URL.createObjectURL(blob);
  if(!this.isCurrent(path,pending)){this.revoke(url);throw this.staleError();}
  this.entries.set(path,{url,size:blob.size});this.cachedBytes+=blob.size;
  const active=new Set(this.options.activeUrls());
  for(const [key,entry] of this.entries){
   if(this.cachedBytes<=AUDIO_CACHE_LIMIT_BYTES&&this.entries.size<=AUDIO_CACHE_LIMIT_ENTRIES)break;
   if(key===path||active.has(entry.url))continue;
   this.remove(key,entry);
  }
  return url;
 }

 /** Release unattached completed URLs; pending reads still have consumers. */
 releaseUnused():void{
  const active=new Set(this.options.activeUrls());
  for(const [path,entry] of this.entries)if(!active.has(entry.url))this.remove(path,entry);
 }

 /** Only the owner of a deleted resource may invalidate its exact path. */
 invalidate(path:string):void{
  const pending=this.pending.get(path);if(pending){this.pending.delete(path);pending.controller.abort();}
  const entry=this.entries.get(path);if(entry)this.remove(path,entry);
 }

 /** Final page teardown only; a bfcache pagehide must not dispose this cache. */
 dispose():void{
  if(this.disposed)return;this.disposed=true;this.cancelPending();
  for(const [path,entry] of this.entries)this.remove(path,entry);
 }

 private cancelPending():void{
  const pending=[...this.pending.values()];this.pending.clear();
  for(const read of pending)read.controller.abort();
 }

 private isCurrent(path:string,pending:PendingAudio):boolean{
  return !this.disposed&&!pending.controller.signal.aborted&&this.pending.get(path)===pending;
 }

 private assertCurrent(path:string,pending:PendingAudio):void{if(!this.isCurrent(path,pending))throw this.staleError();}
 private staleError():DOMException{return new DOMException('音频读取已取消','AbortError');}
 private revoke(url:string):void{if(this.options.revokeObjectURL)this.options.revokeObjectURL(url);else URL.revokeObjectURL(url);}

 private remove(path:string,entry:CachedAudio):void{
  this.revoke(entry.url);
  this.entries.delete(path);this.cachedBytes-=entry.size;
 }
}
