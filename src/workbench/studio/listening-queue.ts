import './listening-queue.css';
import {readAudioBlob} from '../audio-response.ts';
import type {WorkbenchService} from '../service.ts';
import type {CatalogQuery,CatalogEntry} from '../../service/studio/sound-catalog.ts';
import {changePlaybackMode,replacePlaybackOrder,restorePlaybackOrder,type ListeningOrder,type PlaybackMode} from './listening-order.ts';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
type State=ListeningOrder&{time:number;title:string};
/** One connected audio element owns library playback, independently of page DOM. */
export class ListeningQueue{
 readonly audio:HTMLAudioElement;private state:State={ids:[],index:0,mode:'order',time:0,title:'声音库'};
 private api:WorkbenchService;private root:HTMLElement;private notify:(s:string)=>void;private key:string;
 private catalogRevision='';private controller?:AbortController;private epoch=0;private url='';private listeners=new Set<()=>void>();private active=false;private storageFailed=false;private savedAt=0;private panelPage=0;private panelEpoch=0;private names=new Map<string,CatalogEntry>();
 constructor(root:HTMLElement,api:WorkbenchService,notify:(s:string)=>void){
  this.root=root;this.api=api;this.notify=notify;this.key=`music-room-listening:${api.bootstrap.workspace}`;
  this.audio=document.createElement('audio');this.audio.id='sound-library-audio';this.audio.hidden=true;this.audio.preload='metadata';root.append(this.audio);
  const panel=document.createElement('section');panel.id='listening-queue';panel.hidden=true;panel.setAttribute('aria-label','播放队列');root.append(panel);
  try{const saved=JSON.parse(localStorage.getItem(this.key)??'null');if(saved&&Array.isArray(saved.ids)&&saved.ids.length<=20000&&saved.ids.every((id:unknown)=>typeof id==='string'&&/^[a-z0-9][a-z0-9-]{0,79}$/.test(id))){this.state={...restorePlaybackOrder([...new Set<string>(saved.ids)],Math.max(0,Math.min(Number.isSafeInteger(saved.index)?saved.index:0,new Set(saved.ids).size-1)),saved.mode,saved.orderedIds),time:Number.isFinite(saved.time)&&saved.time>0?saved.time:0,title:typeof saved.title==='string'?saved.title:'声音库'};}}catch{notify('上次播放记录无法读取，请重新选择声音');}
  window.addEventListener('beforeunload',()=>this.save());window.addEventListener('pagehide',()=>this.save());
  this.audio.addEventListener('ended',()=>{if(this.active)void this.next(true);});
  this.audio.addEventListener('timeupdate',()=>{if(Date.now()-this.savedAt>2000)this.save();});
  this.audio.addEventListener('pause',()=>this.save());this.audio.addEventListener('seeked',()=>this.save());
  this.audio.addEventListener('error',()=>{if(this.audio.getAttribute('src')&&!this.controller?.signal.aborted){this.audio.pause();notify('这首声音无法播放，可以重试或切换下一首');}});
  root.addEventListener('play',e=>{if(!(e.target instanceof HTMLAudioElement))return;this.active=e.target===this.audio;if(!this.active){++this.epoch;this.controller?.abort();}if(this.active)document.querySelectorAll<HTMLAudioElement>('audio').forEach(a=>{if(a!==this.audio)a.pause();});this.update();},true);
  this.audio.addEventListener('playbacktoggle',e=>{e.preventDefault();if(this.audio.paused)void this.resume();else{++this.epoch;this.controller?.abort();this.audio.pause();}});
  root.addEventListener('click',e=>{
   const button=(e.target as Element).closest<HTMLButtonElement>('[data-queue-action]');if(!button)return;
   const action=button.dataset.queueAction,id=button.dataset.id,index=Number(button.dataset.index);
   if(action==='previous')void this.previous();else if(action==='next')void this.next();else if(action==='open'){panel.hidden=!panel.hidden;this.panelPage=Math.floor(this.state.index/20);void this.panel();}
   else if(action==='close')panel.hidden=true;else if(action==='play')void this.start(index,true);else if(action==='remove')this.remove(index);else if(action==='up')this.move(index,-1);else if(action==='down')this.move(index,1);
   else if(action==='page'){this.panelPage=Number(id);void this.panel();}else if(action==='mode'){const modes:PlaybackMode[]=['order','list','one','shuffle'];this.setMode(modes[(modes.indexOf(this.state.mode)+1)%modes.length]);}
  });
  root.addEventListener('keydown',e=>{if(e.key==='Escape'&&!root.querySelector('dialog[open]')&&!panel.hidden){panel.hidden=true;root.querySelector<HTMLButtonElement>('[data-queue-action="open"]')?.focus();}});
  this.update();if(this.state.ids.length)void this.start(this.state.index,false,this.state.time);
 }
 async reconcile(revision:string){
  if(!revision||revision===this.catalogRevision)return;this.catalogRevision=revision;
  const id=this.currentId,epoch=this.epoch;if(!id)return;
  try{const {items}=await this.api.call('sound_library_items',{ids:[id]});if(epoch!==this.epoch||id!==this.currentId)return;const entry=items[0];if(!entry)return;this.names.set(id,entry);
   if(!entry.item){const playing=!this.audio.paused;this.controller?.abort();++this.epoch;this.audio.pause();this.audio.removeAttribute('src');this.audio.load();if(this.url){URL.revokeObjectURL(this.url);this.url='';}this.notify(`${entry.title}已不可用`);if(playing&&this.state.index+1<this.state.ids.length)await this.next();}
   else{this.audio.setAttribute('aria-label',entry.title+(entry.item.origin==='generated'?` · V${entry.item.number}`:''));if(this.active)this.audio.dispatchEvent(new Event('queueactivate',{bubbles:true}));}this.update();
  }catch{/* A failed status read must not interrupt an already loaded recording. */}
 }
 sync(){this.update();}
 get ids(){return [...this.state.ids];}get currentId(){return this.state.ids[this.state.index]??'';}get current(){return this.names.get(this.currentId);}
 subscribe(fn:()=>void){this.listeners.add(fn);return ()=>this.listeners.delete(fn);}
 private save(){
  if(this.audio.getAttribute('src')&&this.audio.readyState>=1&&this.audio.dataset.playingId===this.currentId)this.state.time=this.audio.currentTime||0;this.savedAt=Date.now();
  try{localStorage.setItem(this.key,JSON.stringify(this.state));}catch{if(!this.storageFailed)this.notify('播放记录未能保存，刷新后可能无法恢复');this.storageFailed=true;}
 }
 private setMode(mode:PlaybackMode){this.state={...this.state,...changePlaybackMode(this.state,mode)};this.audio.loop=mode==='one';this.panelPage=Math.floor(this.state.index/20);this.save();this.update();}
 async play(options:CatalogQuery,startId?:string,mode?:PlaybackMode){const epoch=++this.epoch;this.controller?.abort();const queue=await this.api.call('sound_library_queue',options);if(epoch!==this.epoch)return;if(mode)this.setMode(mode);await this.replace(queue.ids,startId,queue.title);}
 async replace(ids:string[],startId?:string,title='声音库'){
  if(ids.length>20000){this.notify('播放队列最多支持 20000 首，请缩小筛选范围');return;}
  this.state={...replacePlaybackOrder(this.state,ids,startId),time:0,title};this.save();await this.start(this.state.index,true);
 }
 enqueue(ids:string[],next=false){
  const current=this.currentId,unique=[...new Set(ids)].filter(id=>id!==current);
  const additions=next?unique:unique.filter(id=>!this.state.ids.includes(id));
  if(this.state.ids.length+additions.filter(id=>!this.state.ids.includes(id)).length>20000){this.notify('播放队列最多支持 20000 首，请缩小筛选范围');return;}
  if(this.state.orderedIds){const ordered=next?this.state.orderedIds.filter(id=>!additions.includes(id)):[...this.state.orderedIds];ordered.splice(next?Math.max(0,ordered.indexOf(current)+1):ordered.length,0,...additions);this.state.orderedIds=ordered;}
  if(next)this.state.ids=this.state.ids.filter(id=>!additions.includes(id));
  if(current)this.state.index=this.state.ids.indexOf(current);
  this.state.ids.splice(next?this.state.index+1:this.state.ids.length,0,...additions);this.save();this.update();
  if(!current&&this.currentId)void this.start(0,false);this.notify(`已加入播放队列 · ${additions.length} 首`);
 }
 async previous(){if(this.audio.currentTime>3){this.audio.currentTime=0;return;}await this.start(Math.max(0,this.state.index-1),true);}
 async next(ended=false){
  if(!this.state.ids.length)return;
  if(ended&&this.state.mode==='one'){this.audio.currentTime=0;await this.audio.play().catch(()=>this.notify('请点击播放继续'));return;}
  let next=this.state.index+1;if(next>=this.state.ids.length){if(this.state.mode==='list')next=0;else{this.save();this.update();return;}}
  await this.start(next,true);
 }
 private async start(index:number,play:boolean,resume=0,missingFiles=0){
  const epoch=++this.epoch;this.controller?.abort();this.controller=new AbortController();const signal=this.controller.signal;
  this.audio.pause();this.audio.removeAttribute('src');this.audio.load();if(this.url){URL.revokeObjectURL(this.url);this.url='';}
  if(!this.state.ids.length){this.update();return;}
  this.active=true;if(play)document.querySelectorAll<HTMLAudioElement>('audio').forEach(a=>a.pause());
  this.state.index=index;this.state.time=resume;this.audio.loop=this.state.mode==='one';
  try{
   let entry:CatalogEntry|undefined;
   for(let skipped=0;skipped<3&&this.state.index<this.state.ids.length;skipped++){
    const result=await this.api.call('sound_library_items',{ids:[this.currentId]});if(epoch!==this.epoch)return;
    entry=result.items[0];if(entry)this.names.set(entry.id,entry);if(entry?.item)break;
    this.notify(`${entry?.title??'声音'}已不可用，已跳过`);this.state.index++;
   }
   if(!entry?.item||this.state.index>=this.state.ids.length){this.state.index=Math.min(index,this.state.ids.length-1);this.notify('接下来的声音不可用，已暂停播放');this.save();this.update();return;}
   const item=entry.item;this.audio.dataset.version=item.origin==='generated'?item.versionId:'';this.audio.setAttribute('aria-label',item.title+(item.origin==='generated'?` · V${item.number}`:''));
   this.audio.dispatchEvent(new Event('queueactivate',{bubbles:true}));this.update();
   const response=await this.api.request(item.audioPath,{signal});if(epoch!==this.epoch){await response.body?.cancel();return;}
   if(!response.ok){const failure=await response.json().catch(()=>({code:''}));if(response.status===404||response.status===410||['NOT_FOUND','ENOENT','SOURCE_CHANGED','INVALID_AUDIO'].includes(failure.code)){this.notify(`${entry.title}的文件已不可用`);if(missingFiles<2&&this.state.index+1<this.state.ids.length){await this.start(this.state.index+1,play,0,missingFiles+1);return;}this.save();this.update();return;}throw Error('服务暂时无法读取音频，请点击播放重试');}
   const blob=await readAudioBlob(response,120_000_000);if(epoch!==this.epoch)return;
   this.url=URL.createObjectURL(blob);this.audio.dataset.playingId=this.currentId;this.audio.src=this.url;
   if(resume)this.audio.addEventListener('loadedmetadata',()=>{if(epoch===this.epoch)this.audio.currentTime=Math.min(resume,Number.isFinite(this.audio.duration)?this.audio.duration:resume);},{once:true});
   this.audio.dispatchEvent(new Event('queueactivate',{bubbles:true}));this.save();if(play)await this.audio.play();this.update();
  }catch(error){if(epoch!==this.epoch||signal.aborted)return;this.notify((error as Error).message||'播放中断，请点击播放重试');this.save();this.update();}
 }
 async resume(){if(!this.audio.getAttribute('src'))await this.start(this.state.index,true);else{this.active=true;this.audio.dispatchEvent(new Event('queueactivate',{bubbles:true}));await this.audio.play().catch(()=>this.notify('请点击播放继续'));}}
 private remove(index:number){
  const playing=!this.audio.paused,current=this.currentId,removed=this.state.ids[index];this.state.ids.splice(index,1);if(this.state.orderedIds)this.state.orderedIds=this.state.orderedIds.filter(id=>id!==removed);this.state.index=this.state.ids.includes(current)?this.state.ids.indexOf(current):Math.min(index,Math.max(0,this.state.ids.length-1));this.state.time=0;
  this.save();this.update();if(current!==this.currentId)void this.start(this.state.index,playing);
 }
 private move(index:number,direction:number){const target=index+direction;if(target<0||target>=this.state.ids.length)return;const current=this.currentId;[this.state.ids[index],this.state.ids[target]]=[this.state.ids[target],this.state.ids[index]];this.state.index=this.state.ids.indexOf(current);this.save();this.update();}
 private update(){
  for(const bar of this.root.querySelectorAll<HTMLElement>('.bar-playback')){
   bar.querySelectorAll<HTMLElement>('[data-queue-transport]').forEach(e=>e.hidden=!this.active||!this.state.ids.length);
   const previous=bar.querySelector<HTMLButtonElement>('[data-queue-action="previous"]'),next=bar.querySelector<HTMLButtonElement>('[data-queue-action="next"]');if(previous)previous.disabled=!this.state.ids.length;if(next)next.disabled=this.state.index>=this.state.ids.length-1&&this.state.mode!=='list';
   const mode=bar.querySelector('[data-queue-action="mode"]');if(mode){mode.textContent={order:'顺序',list:'列表循环',one:'单曲循环',shuffle:'随机'}[this.state.mode];mode.setAttribute('title',this.state.mode==='shuffle'?'随机播放：本轮不重复，播完停止':'切换播放方式');}
   const open=bar.querySelector('[data-queue-action="open"]');if(open)open.textContent=`队列 ${this.state.ids.length}`;
  }
  for(const fn of this.listeners)fn();if(!this.root.querySelector<HTMLElement>('#listening-queue')!.hidden)void this.panel();
 }
 private async panel(){
  const panel=this.root.querySelector<HTMLElement>('#listening-queue')!;if(panel.hidden)return;const epoch=++this.panelEpoch;
  const pages=Math.max(1,Math.ceil(this.state.ids.length/20));this.panelPage=Math.max(0,Math.min(this.panelPage,pages-1));const start=this.panelPage*20,ids=this.state.ids.slice(start,start+20);
  try{const {items}=await this.api.call('sound_library_items',{ids});if(epoch!==this.panelEpoch)return;for(const item of items)this.names.set(item.id,item);
   panel.innerHTML=`<header><strong>播放队列 · ${this.state.ids.length} 首</strong><button class="quiet" data-queue-action="close" aria-label="关闭播放队列">×</button></header><p class="field-note">${esc(this.state.title)}</p><ol>${items.map((entry,i)=>`<li ${start+i===this.state.index?'class="current"':''}><button data-queue-action="play" data-index="${start+i}">${esc(entry.title)}${entry.item?'':' · 不可用'}</button><button data-queue-action="up" data-index="${start+i}" aria-label="上移 ${esc(entry.title)}" ${start+i===0?'disabled':''}>↑</button><button data-queue-action="down" data-index="${start+i}" aria-label="下移 ${esc(entry.title)}" ${start+i===this.state.ids.length-1?'disabled':''}>↓</button><button data-queue-action="remove" data-index="${start+i}" aria-label="从队列移除 ${esc(entry.title)}">×</button></li>`).join('')}</ol><footer><button class="quiet" data-queue-action="page" data-id="${this.panelPage-1}" ${!this.panelPage?'disabled':''}>上一页</button><span>${this.panelPage+1} / ${pages}</span><button class="quiet" data-queue-action="page" data-id="${this.panelPage+1}" ${this.panelPage+1>=pages?'disabled':''}>下一页</button></footer>`;
  }catch(error){if(epoch===this.panelEpoch)panel.innerHTML=`<p>队列暂时无法读取</p><button data-queue-action="close">关闭</button>`;}
 }
}
