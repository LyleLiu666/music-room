import {icon} from './icons.ts';
import type {WorkbenchService} from '../service.ts';
import type {StudioVersion} from '../../service/studio/studio.ts';
import type {OperationArgs} from '../../service/operations.ts';

const presets=[
 ['沙哑女声 · 摇滚乐队','沙哑低沉的女声主唱，咬字清晰有力。另类摇滚乐队，失真电吉他、电贝斯与原声架子鼓。','Mandarin female low alto, distinctly raspy husky singing and clear consonants. Live alternative rock band with overdriven electric guitar power chords, electric bass, and punchy acoustic drums. Keep the recognizable vocal melody and Mandarin phrasing.'],
 ['慵懒女声 · 爵士三重奏','松弛的女声，爵士钢琴、低音提琴和刷鼓。','Intimate soft Mandarin female lead, relaxed jazz phrasing, piano trio with upright bass and brushed drums. Keep the recognizable vocal melody.'],
 ['清澈男声 · 木吉他民谣','自然清澈的男声，指弹木吉他与克制的伴奏。','Clear intimate Mandarin male vocal, fingerpicked acoustic guitar, sparse acoustic folk band. Keep the recognizable vocal melody.'],
 ['复古合成器 · 迷幻流行','梦幻的唱法，复古合成器、柔和的电贝斯与电子鼓。','Dreamy Mandarin vocals, warm vintage analog synthesizers, electric bass and soft electronic drums, psychedelic pop. Keep the recognizable vocal melody.'],
] as const;
const time=(seconds:number)=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
type CoverArgs=OperationArgs<'studio_cover_generate'>;
type Hooks={api:WorkbenchService;panel:HTMLElement;url:(path:string)=>Promise<string>;samples:(path:string)=>Promise<ArrayBuffer>;saved:(version:StudioVersion)=>Promise<void>;change:()=>void;notice:(message:string)=>void};
type Clip={start:number;end:number};
const clamp=(n:number,min:number,max:number)=>Math.min(max,Math.max(min,n));
const makeRequestId=()=>`cover-${crypto.randomUUID()}`;

export class CoverUI {
 private h:Hooks;
 private controller?:AbortController;
 private audio?:HTMLAudioElement;
 private original?:HTMLAudioElement;
 private host?:HTMLElement;
 private visible?:StudioVersion;
 private originalVersion?:StudioVersion;
 private mode:'cover'|'original'='cover';
 private sourceId?:string;
 private clip:Clip={start:0,end:0};
 private readonly bins=new Map<string,Promise<number[]>>();
 private waveDraw=0;
 private originalLoad?:Promise<HTMLAudioElement>;
 private pendingSide?:'cover'|'original';
 private controllerPlayback?:AbortController;
 constructor(h:Hooks){this.h=h;}
 editing(versionId:string){return this.sourceId===versionId;}
 active(){return !!this.sourceId;}
 close(){
  this.controller?.abort();this.controller=undefined;
  if(!this.sourceId)return;
  this.sourceId=undefined;
  this.audio?.pause();this.original?.pause();
  this.h.panel.hidden=true;this.h.panel.replaceChildren();
  if(this.visible?.cover)this.mode='cover';
  this.h.change();
  document.querySelector<HTMLElement>('[data-action=cover]')?.focus({preventScroll:true});
 }
 private get duration(){return this.audio&&Number.isFinite(this.audio.duration)?this.audio.duration:this.visible?.duration??0;}
 private get current(){return this.mode==='original'?this.original:this.audio;}
 private get interval():Clip{
  if(this.sourceId)return this.clip;
  const edit=this.visible?.cover;
  if(!edit)return {start:0,end:this.duration};
  return this.mode==='original'?{start:edit.startSeconds,end:edit.endSeconds}:{start:0,end:this.duration||edit.endSeconds-edit.startSeconds};
 }
 private progress(){
  const a=this.current;
  return a?clamp(a.currentTime-this.interval.start,0,this.interval.end-this.interval.start):0;
 }
 private update(){
  const host=this.host;if(!host||!host.isConnected)return;
  const {start,end}=this.interval, length=end-start;
  const a=this.current, playing=!!a&&!a.paused;
  const current=this.progress();
  const play=host.querySelector<HTMLButtonElement>('[data-cover-play]')!;
  play.innerHTML=icon(playing?'pause':'play');
  play.setAttribute('aria-label',playing?'暂停':'播放');
  const row=document.querySelector<HTMLButtonElement>('.version-row.selected [data-cover-row-play]');
  if(row){row.innerHTML=icon(playing?'pause':'play');row.setAttribute('aria-label',playing?'暂停当前版本':'播放当前版本');}
  const wave=host.querySelector<HTMLElement>('.cover-wave')!;
  wave.style.setProperty('--play-position',`${this.sourceId&&this.duration?100*(start+current)/this.duration:length?100*current/length:0}%`);
  wave.style.setProperty('--range-start',`${this.duration?100*start/this.duration:0}%`);
  wave.style.setProperty('--range-end',`${this.duration?100*end/this.duration:100}%`);
  const cover=this.visible?.cover;
  host.querySelector<HTMLElement>('[data-cover-selection]')!.textContent=`${time(start)} – ${time(end)}`;
  host.querySelector<HTMLElement>('[data-cover-left]')!.textContent=this.sourceId?time(start+current):`${time(current)} / ${time(length)}`;
  host.querySelector<HTMLElement>('[data-cover-right]')!.textContent=!this.sourceId&&cover?`对应原曲 ${time(cover.startSeconds+current)}`:time(this.duration);
  for(const button of document.querySelectorAll<HTMLButtonElement>('[data-cover-switch]')){
   button.setAttribute('aria-pressed',String(button.dataset.coverSwitch===this.mode));
   button.disabled=!!this.pendingSide||(button.dataset.coverSwitch==='original'&&!this.originalVersion?.audioPath);
   const label=button.dataset.coverSwitch==='cover'?`V${this.visible?.number} 翻唱`:`V${cover?.sourceNumber} 原唱同段`;
   button.textContent=(button.dataset.coverSwitch===this.mode?'✓ ':'')+label;
  }
 }
 private onTime(a:HTMLAudioElement){
  if(a!==this.current||!this.host?.isConnected)return;
  const {start,end}=this.interval;
  if(end>start&&!a.paused){
   if(a.currentTime<start-.015)a.currentTime=start;
   else if(a.currentTime>=end-.015){
    if(this.sourceId)a.currentTime=start;
    else{a.pause();a.currentTime=end;}
   }
  }
  this.update();
 }
 private async wave(path:string,start:number,end:number){
  const generation=++this.waveDraw;
  let promise=this.bins.get(path);
  if(!promise){
   promise=(async()=>{
    const context=new OfflineAudioContext(1,1,24000);
    const buffer=await context.decodeAudioData(await this.h.samples(path));
    const data=buffer.getChannelData(0),width=Math.max(1,Math.ceil(data.length/1400));
    return Array.from({length:Math.ceil(data.length/width)},(_,i)=>{
     let peak=0;
     for(let j=i*width;j<Math.min((i+1)*width,data.length);j++)peak=Math.max(peak,Math.abs(data[j]));
     return peak;
    });
   })();
   this.bins.set(path,promise);
   if(this.bins.size>8)this.bins.delete(this.bins.keys().next().value!);
   void promise.catch(()=>this.bins.delete(path));
  }
  try{
   const bins=await promise;
   const wave=this.host?.querySelector<HTMLElement>('.cover-wave-bars');
   if(generation!==this.waveDraw||!wave)return;
   const draw=bins.slice(Math.floor(start*bins.length),Math.max(1,Math.ceil(end*bins.length)));
   const peak=Math.max(.01,...draw);
   wave.innerHTML=Array.from({length:140},(_,i)=>{
    const first=Math.floor(i*draw.length/140),last=Math.max(first+1,Math.floor((i+1)*draw.length/140));
    const max=Math.max(0,...draw.slice(first,last));
    return `<i style="height:${Math.max(5,100*max/peak).toFixed(1)}%"></i>`;
   }).join('');
  }catch{if(generation===this.waveDraw&&this.host)this.host.querySelector('.cover-wave-bars')!.textContent='波形不可用';}
 }
 private draw(){
  const cover=this.visible?.cover, path=(this.mode==='original'?this.originalVersion:this.visible)?.audioPath;
  if(!path)return;
  if(this.mode==='original'&&cover){
   const duration=this.original?.duration;
   if(duration&&Number.isFinite(duration))void this.wave(path,cover.startSeconds/duration,cover.endSeconds/duration);
  }else void this.wave(path,0,1);
 }
 attach(audio:HTMLAudioElement|undefined,version:StudioVersion|undefined,source:StudioVersion|undefined){
  const visible=!!audio&&!!version&&(this.editing(version.id)||!!version.cover);
  if(this.audio===audio&&this.visible?.id===version?.id&&visible===!!this.host&&(!visible||this.host?.isConnected)){
   this.originalVersion=source;
   if(!source?.audioPath&&this.mode==='original'){this.original?.pause();this.mode='cover';this.draw();}
   this.update();return;
  }
  this.controllerPlayback?.abort();if(this.host)this.audio?.pause();this.host?.remove();++this.waveDraw;this.original?.pause();this.original=undefined;this.originalLoad=undefined;
  if(this.audio){this.audio.hidden=false;this.audio.closest('.player-space')?.classList.remove('cover-custom-media');}
  this.host=undefined;this.audio=audio;this.visible=version;this.originalVersion=source;this.mode='cover';this.pendingSide=undefined;
  if(!visible)return;
  const lifetime=new AbortController();this.controllerPlayback=lifetime;
  const {signal}=lifetime;
  const player=audio!.closest<HTMLElement>('.player-space')!;
  player.classList.add('cover-custom-media');audio!.hidden=true;
  const host=document.createElement('div');this.host=host;
  host.className='cover-player';
  host.innerHTML=`<button class="cover-play" type="button" data-cover-play></button><div class="cover-player-content">
  <div class="cover-wave ${this.sourceId?'selecting':''}" role="group" aria-label="声音波形">
   <div class="cover-wave-bars"></div><div class="cover-wave-position"></div>
   <div class="cover-selection" hidden><div data-cover-selection></div><button type="button" data-handle="start" aria-label="拖动选段起点"></button><button type="button" data-handle="end" aria-label="拖动选段终点"></button></div>
  </div><div class="cover-time"><span data-cover-left></span><span data-cover-right></span></div></div>`;
  player.prepend(host);
  host.querySelector<HTMLButtonElement>('[data-cover-play]')!.onclick=()=>void this.toggle().catch(e=>this.h.notice(e.message));
  host.querySelector<HTMLElement>('.cover-selection')!.hidden=!this.sourceId;
  const wave=host.querySelector<HTMLElement>('.cover-wave')!;
  wave.onpointerdown=e=>{
   if((e.target as Element).closest('button'))return;
   const rect=wave.getBoundingClientRect(),ratio=clamp((e.clientX-rect.left)/rect.width,0,1);
   const a=this.current;if(a?.readyState){const {start,end}=this.interval;a.currentTime=this.sourceId?clamp(ratio*this.duration,start,end-.02):start+ratio*(end-start);}
  };
  if(this.sourceId)for(const handle of host.querySelectorAll<HTMLButtonElement>('[data-handle]')){
   const edge=handle.dataset.handle as keyof Clip;
   handle.onpointerdown=e=>{e.stopPropagation();handle.setPointerCapture(e.pointerId);};
   handle.onpointermove=e=>{
    if(!handle.hasPointerCapture(e.pointerId))return;
    const rect=wave.getBoundingClientRect();
    this.setEdge(edge,Math.round((e.clientX-rect.left)/rect.width*this.duration*10)/10);
   };
   handle.onkeydown=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();this.setEdge(edge,this.clip[edge]+(e.key==='ArrowLeft'?-1:1));}};
  }
  for(const event of ['timeupdate','play','pause','seeking','loadedmetadata','ended'])audio!.addEventListener(event,()=>this.onTime(audio!),{signal});
  if(version?.cover&&source?.audioPath&&!this.sourceId)void this.loadOriginal(source.audioPath,lifetime.signal).catch(()=>{});
  let frame=0;
  const tick=()=>{
   if(signal.aborted)return;
   if(this.current&&!this.current.paused){this.onTime(this.current);frame=requestAnimationFrame(tick);}
   else frame=0;
  };
  host.addEventListener('play',()=>{if(!frame)frame=requestAnimationFrame(tick);},{signal,capture:true});
  audio!.addEventListener('play',()=>{if(!frame)frame=requestAnimationFrame(tick);},{signal});
  signal.addEventListener('abort',()=>cancelAnimationFrame(frame),{once:true});
  this.draw();this.update();
 }
 async toggle(){
  const a=this.current;if(!a)return;
  if(!a.paused){a.pause();return;}
  const {start,end}=this.interval;
  if(a.currentTime<start||a.currentTime>=end-.02)a.currentTime=start;
  await a.play();
 }
 private loadOriginal(path:string,signal:AbortSignal){
  return this.originalLoad??=(async()=>{
   const original=new Audio();
   original.preload='auto';original.hidden=true;
   const url=await this.h.url(path);signal.throwIfAborted();
   original.src=url;
   await mediaReady(original,signal);signal.throwIfAborted();
   this.host?.append(original);
   original.onplay=()=>{for(const other of document.querySelectorAll('audio'))if(other!==original)other.pause();};
   for(const event of ['timeupdate','play','pause','seeking','ended'])original.addEventListener(event,()=>this.onTime(original),{signal});
   this.original=original;
   return original;
  })().catch(error=>{if(!signal.aborted)this.originalLoad=undefined;throw error;});
 }
 async switch(side:'cover'|'original'){
  if(this.sourceId||this.pendingSide||side===this.mode||!this.audio||!this.controllerPlayback)return;
  const {signal}=this.controllerPlayback;
  this.pendingSide=side;this.update();
  try{
   if(side==='original'){
    const path=this.originalVersion?.audioPath;if(!path)throw Error('原唱版本不可试听');
    await this.loadOriginal(path,signal);
    signal.throwIfAborted();
   }
   const previous=this.current,playing=!!previous&&!previous.paused,progress=this.progress();
   previous?.pause();
   this.mode=side;
   const next=this.current!,{start,end}=this.interval;
   next.currentTime=clamp(start+progress,start,Math.max(start,end-.02));
   this.draw();
   if(playing)await next.play();
  }finally{if(!signal.aborted){this.pendingSide=undefined;this.update();}}
 }
 private setEdge(edge:keyof Clip,value:number){
  if(!Number.isFinite(value)||this.duration<10)return;
  if(edge==='start')this.clip.start=clamp(value,Math.max(0,this.clip.end-60),this.clip.end-10);
  else this.clip.end=clamp(value,this.clip.start+10,Math.min(this.duration,this.clip.start+60));
  this.h.panel.dispatchEvent(new Event('cover-range'));
  if(this.current)this.onTime(this.current);
 }
 async open(source:StudioVersion,audio:HTMLAudioElement,initial?:StudioVersion['cover']){
  this.close();
  const lifetime=new AbortController();this.controller=lifetime;
  await mediaReady(audio,lifetime.signal);
  if(lifetime.signal.aborted||!audio.isConnected)return;
  const duration=Math.min(600,audio.duration);
  if(!Number.isFinite(duration)||duration<10)throw Error('请选择至少 10 秒的音乐版本');
  this.audio?.pause();this.original?.pause();
  this.sourceId=source.id;
  const length=Math.min(30,duration),start=Math.min(15,duration-length);
  this.clip=initial?{start:initial.startSeconds,end:initial.endSeconds}:{start,end:start+length};
  const p=this.h.panel;p.hidden=false;
  p.innerHTML=`<header class="side-panel-heading"><div><h2>翻唱这段</h2><p>基于 V${source.number}</p></div><button data-close-cover class="icon-button" type="button" aria-label="关闭翻唱面板">${icon('close')}</button></header>
  <form id="cover-form" class="side-panel-body">
   <section><h3>片段</h3><div class="cover-fields"><label>起点（秒）<input name="start" type="number" min="0" max="${duration-10}" step="any" required></label><label>时长（秒）<input name="length" type="number" min="10" max="60" step="any" required></label></div></section>
   <section><h3>唱法与乐队</h3><div class="cover-fields"><select name="preset" aria-label="唱法与乐队">${presets.map(([label],i)=>`<option value="${i}">${label}</option>`).join('')}<option value="custom">自定义</option></select><button type="button" name="custom" class="secondary">自定义</button></div><textarea name="style" aria-label="风格描述" rows="3" required maxlength="1200"></textarea></section>
   <section><h3>改编幅度</h3><div class="cover-strength">${[['close','保留原版'],['balanced','适中'],['bold','大幅改编']].map(([key,label])=>`<label><input type="radio" name="strength" value="${key}" ${key==='balanced'?'checked':''}><span>${label}</span></label>`).join('')}</div></section>
   <section><h3>歌词</h3><p data-lyric-source class="field-note"></p><textarea name="lyrics" aria-label="这段歌词" rows="5" maxlength="8000"></textarea><button type="button" class="quiet" data-cover-refresh-lyrics hidden>按选段重新填词</button></section>
  </form><footer class="side-panel-footer"><span role="status" data-cover-status>检查本机模型…</span><div><button data-cover-prepare type="button" class="secondary" hidden>准备模型</button><button data-cover-submit form="cover-form" type="submit" class="primary" disabled>生成翻唱新版本</button></div></footer>`;
  const query=<T extends HTMLElement>(selector:string)=>p.querySelector<T>(selector)!;
  const f=query<HTMLFormElement>('#cover-form'),pos=query<HTMLInputElement>('input[name=start]'),len=query<HTMLInputElement>('input[name=length]');
  const lyrics=query<HTMLTextAreaElement>('[name=lyrics]'),note=query<HTMLElement>('[data-lyric-source]'),style=query<HTMLTextAreaElement>('[name=style]'),preset=query<HTMLSelectElement>('[name=preset]');
  const ready=query<HTMLButtonElement>('[data-cover-prepare]'),submit=query<HTMLButtonElement>('[data-cover-submit]'),status=query<HTMLElement>('[data-cover-status]');
  let lyricsChanged=!!initial,styleChanged=!!initial,statusVersion=0,busy=false,submitError='',id=makeRequestId(),signature='',installed=false;
  style.value=initial?.styleLabel??initial?.style??presets[0][1];if(initial){preset.value='custom';lyrics.value=initial.lyrics;query<HTMLInputElement>(`[name=strength][value="${initial.strength}"]`).checked=true;}
  query<HTMLButtonElement>('[data-close-cover]').onclick=()=>this.close();
  query<HTMLButtonElement>('button[name=custom]').onclick=()=>{preset.value='custom';styleChanged=true;style.focus();};
  preset.onchange=()=>{if(preset.value==='custom'){styleChanged=true;style.focus();return;}styleChanged=false;style.value=presets[Number(preset.value)][1];};
  style.oninput=()=>{styleChanged=true;};
  lyrics.oninput=()=>{lyricsChanged=true;query<HTMLButtonElement>('[data-cover-refresh-lyrics]').hidden=false;};
  let timer:ReturnType<typeof setTimeout>|undefined;
  let lyricsPending=false;
  const updateLyrics=()=>{
   clearTimeout(timer);const generation=++statusVersion;
   if(lyricsChanged){lyricsPending=false;return;}
   lyricsPending=true;
   timer=setTimeout(()=>void this.h.api.call('studio_cover_selection',{versionId:source.id,startSeconds:this.clip.start,endSeconds:this.clip.end}).then(result=>{
    if(lifetime.signal.aborted||generation!==statusVersion||lyricsChanged)return;
    lyricsPending=false;lyrics.value=result.text;
    note.textContent=result.kind==='synced'?'来自同步歌词 · 可校对':result.kind==='plain'?'按原歌词顺序估算，请对照试听校对':'可填写这段歌词，纯音乐可留空';
   },error=>{if(!lifetime.signal.aborted&&generation===statusVersion){lyricsPending=false;note.textContent=error.message;}}),140);
  };
  query<HTMLButtonElement>('[data-cover-refresh-lyrics]').onclick=e=>{lyricsChanged=false;(e.currentTarget as HTMLButtonElement).hidden=true;updateLyrics();};
  const writeFields=()=>{pos.value=String(Math.round(this.clip.start*100)/100);len.value=String(Math.round((this.clip.end-this.clip.start)*100)/100);};
  const updateFields=()=>{writeFields();updateLyrics();};
  p.addEventListener('cover-range',updateFields,{signal:lifetime.signal});
  const readFields=()=>{
   if(!Number.isFinite(pos.valueAsNumber)||!Number.isFinite(len.valueAsNumber))return;
   const start=clamp(pos.valueAsNumber,0,duration-10);
   const length=clamp(len.valueAsNumber,10,Math.min(60,duration-start));
   if(this.clip.start===start&&this.clip.end===start+length)return;
   this.clip={start,end:start+length};updateLyrics();if(this.current)this.onTime(this.current);
  };
  pos.oninput=readFields;len.oninput=readFields;pos.onchange=writeFields;len.onchange=writeFields;
  updateFields();
  let preparing=false;
  const check=async()=>{
   try{
    const result=await this.h.api.call('ace_cover_status',{});
    if(lifetime.signal.aborted)return;
    preparing=result.preparation?.state==='preparing';installed=result.installed;
    submit.hidden=!installed;submit.disabled=!installed||busy;
    ready.hidden=installed;ready.textContent=preparing?'取消准备':'准备模型';
    if(!busy)status.textContent=submitError||(installed?'翻唱模型已就绪 · 预约 4 GB':result.preparation?.message??'首次使用需准备翻唱模型');
   }catch(error){if(!lifetime.signal.aborted)status.textContent=(error as Error).message;}
  };
  ready.onclick=async()=>{ready.disabled=true;try{await this.h.api.call(preparing?'ace_cover_cancel_preparation':'ace_cover_prepare',{});await check();}catch(error){status.textContent=(error as Error).message;}finally{ready.disabled=false;}};
  f.onsubmit=event=>{
   event.preventDefault();if(busy||!installed)return;
   readFields();
   if(lyricsPending&&!lyricsChanged){status.textContent='正在读取这段歌词，请稍等';return;}
   const usePreset=!styleChanged&&preset.value!=='custom';
   const description=usePreset?presets[Number(preset.value)][2]:initial&&style.value===(initial.styleLabel??initial.style)?initial.style:style.value;
   const styleLabel=usePreset?presets[Number(preset.value)][0]:style.value;
   const args:Omit<CoverArgs,'requestId'>={versionId:source.id,startSeconds:this.clip.start,endSeconds:this.clip.end,
    lyrics:lyrics.value,style:description,styleLabel,strength:new FormData(f).get('strength') as CoverArgs['strength']};
   const next=JSON.stringify(args);if(signature!==next){signature=next;id=makeRequestId();}
   busy=true;submitError='';submit.disabled=true;status.textContent='正在提交翻唱…';
   void this.h.api.call('studio_cover_generate',{...args,requestId:id}).then(async version=>{
    if(!lifetime.signal.aborted)this.close();
    await this.h.saved(version);
   }).catch(error=>{if(!lifetime.signal.aborted){submitError=error.message;status.textContent=submitError;}}).finally(()=>{busy=false;submit.disabled=!installed;});
  };
  const poll=setInterval(()=>void check(),1700);
  lifetime.signal.addEventListener('abort',()=>{clearInterval(poll);clearTimeout(timer);},{once:true});
  void check();this.h.change();pos.focus({preventScroll:true});
 }
}

function mediaReady(audio:HTMLAudioElement,signal:AbortSignal){
 if(audio.readyState>=1)return Promise.resolve();
 return new Promise<void>((resolve,reject)=>{
  const timeout=setTimeout(()=>finish(Error('读取音频超时')),15000);
  const ok=()=>finish(),bad=()=>finish(Error('原唱音频读取失败')),abort=()=>finish(signal.reason);
  function finish(error?:Error){clearTimeout(timeout);audio.removeEventListener('loadedmetadata',ok);audio.removeEventListener('error',bad);signal.removeEventListener('abort',abort);if(error)reject(error);else resolve();}
  audio.addEventListener('loadedmetadata',ok);audio.addEventListener('error',bad);signal.addEventListener('abort',abort,{once:true});
  if(signal.aborted)abort();
 });
}
