import {LiveAudio} from './live-audio.ts';
import {icon} from './icons.ts';
import {WorkbenchApiError,type WorkbenchService} from '../service.ts';
import type {OwnedSound} from '../../service/studio/sound-library.ts';
import type {OperationResults} from '../../service/operations.ts';

const styles=[
 ['爵士','迪斯科','Intimate acoustic jazz trio, warm piano, upright bass and brushed drums','Upbeat disco funk, punchy dance drums, electric bass and bright rhythm guitar'],
 ['民谣','电子','Warm fingerpicked acoustic folk and natural string texture','Rhythmic electronic synths, arpeggios and a tight drum machine'],
 ['古典弦乐','放克','Lyrical classical string quartet and gentle dynamics','Syncopated funk bass, rhythm guitar, brass and drums'],
] as const;
type Session=OperationResults['live_play_start'];
type Hooks={api:WorkbenchService;panel:HTMLElement;pauseOther:()=>void;change:()=>void;refresh:()=>Promise<void>;notice:(message:string)=>void;url:(path:string)=>Promise<string>;attach:(item:OwnedSound)=>Promise<void>};
const delay=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));

export class LiveUI {
 private h:Hooks;
 private audio?:LiveAudio;
 private sessionId?:string;
 private session?:Session;
 private launch?:Promise<Session>;
 private lifetime?:AbortController;
 private release?:Promise<void>;
 private captures:OwnedSound[]=[];
 private style={left:styles[0][2] as string,right:styles[0][3] as string,mix:0};
 private labels:[string,string]=['爵士','迪斯科'];
 private saving?:{requestId:string;heardFrame:number;title:string};
 private preview?:HTMLAudioElement;
 private externalAudio?:HTMLAudioElement;
 private installPolling=false;
 private playing=false;
 private nextFrame?:number;
 constructor(h:Hooks){this.h=h;}
 active(){return !this.h.panel.hidden;}
 isPlaying(){return this.playing;}
 private element<T extends HTMLElement=HTMLElement>(selector:string){return this.h.panel.querySelector<T>(selector)!;}
 private showStatus(message:string){const node=this.element('[data-live-status]');if(node)node.textContent=message;}
 private playingStatus(value:boolean){
  if(this.playing===value)return;
  this.playing=value;this.h.change();
 }
 async open(){
  if(this.release)await this.release;
  if(this.lifetime)return;
  const lifetime=new AbortController();
  this.lifetime=lifetime;
  const panel=this.h.panel;
  this.captures=[];this.saving=undefined;this.session=undefined;
  this.style={left:styles[0][2],right:styles[0][3],mix:0};this.labels=['爵士','迪斯科'];
  this.audio=new LiveAudio();
  // Resume directly inside the user's click before waiting for model setup.
  void this.audio.context.resume().catch(()=>{});
  this.h.pauseOther();
  panel.hidden=false;
  panel.innerHTML=`<header class="side-panel-heading"><h2>玩一段</h2><button class="secondary" type="button" data-stop-live>停止并关闭</button></header>
  <div class="side-panel-body live-body">
    <div class="live-status" role="status" data-live-status>检查本机模型…</div>
    <button class="secondary" data-live-prepare type="button" hidden>准备模型</button>
    <div class="live-styles">
     <label>风格组合<select data-live-style>${styles.map(([a,b],i)=>`<option value="${i}">${a} ⇄ ${b}</option>`).join('')}<option value="custom">自定义两端</option></select></label>
     <div class="live-custom" hidden><label>左端<input data-live-left maxlength="240" value="爵士"></label><label>右端<input data-live-right maxlength="240" value="迪斯科"></label></div>
    </div>
    <div class="live-mix-labels"><span data-live-label-left>爵士</span><span data-live-label-right>迪斯科</span></div>
    <div class="live-mix"><div class="live-trail" aria-hidden="true"></div><div class="live-nodes" aria-hidden="true"><i hidden></i><i hidden></i><i hidden></i></div><div class="live-heard" aria-hidden="true"></div><input type="range" min="0" max="100" step="1" value="0" aria-label="混合风格" data-live-mix></div>
    <p class="live-heard-label" data-live-heard-label>移动滑块，改变演奏风格</p>
    <div class="live-wave" aria-label="最近播出的实时波形"><canvas data-live-wave width="420" height="100"></canvas><span class="live-window">最近 15 秒</span></div>
    <button class="primary live-save" data-live-save type="button" disabled>留下刚才这段</button>
    <p class="field-note" data-live-save-message>听满 15 秒即可留下</p>
    <section class="live-saved" hidden><h3>本次留下的片段</h3><div data-live-saved></div></section>
  </div>`;
  this.element<HTMLButtonElement>('[data-stop-live]').onclick=()=>void this.close().catch(e=>this.h.notice(e.message));
  this.element<HTMLButtonElement>('[data-live-save]').onclick=()=>void this.save();
  const chooser=this.element<HTMLSelectElement>('[data-live-style]');
  const left=this.element<HTMLInputElement>('[data-live-left]'),right=this.element<HTMLInputElement>('[data-live-right]');
  chooser.onchange=()=>{
   this.element('.live-custom').hidden=chooser.value!=='custom';
   if(chooser.value==='custom'){left.focus();return;}
   const [a,b,x,y]=styles[Number(chooser.value)];
   this.style={left:x,right:y,mix:this.style.mix};this.labels=[a,b];this.updateLabels();
  };
  const custom=()=>{if(left.value.trim()&&right.value.trim()){this.style={left:left.value.trim(),right:right.value.trim(),mix:this.style.mix};this.labels=[this.style.left,this.style.right];this.updateLabels();}};
  left.onchange=custom;right.onchange=custom;
  this.element<HTMLInputElement>('[data-live-mix]').oninput=event=>{this.style.mix=Number((event.currentTarget as HTMLInputElement).value)/100;};
  panel.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();void this.close().catch(e=>this.h.notice(e.message));}},{signal:lifetime.signal});
  let lastPaint=0;
  const frame=(now:number)=>{
   if(lifetime.signal.aborted)return;
   if(now-lastPaint>=75){this.renderAudio();lastPaint=now;}
   this.nextFrame=requestAnimationFrame(frame);
  };
  this.nextFrame=requestAnimationFrame(frame);
  this.h.change();
  await this.prepareOrStart(lifetime.signal);
 }
 private updateLabels(){
  this.element('[data-live-label-left]').textContent=this.labels[0];
  this.element('[data-live-label-right]').textContent=this.labels[1];
 }
 private async prepareOrStart(signal:AbortSignal){
  const prepare=this.element<HTMLButtonElement>('[data-live-prepare]');
  try{
   const status=await this.h.api.call('live_play_status',{});
   if(signal.aborted)return;
   prepare.hidden=status.installed;
   if(status.installed){await this.run(signal);return;}
   this.showStatus(status.message??'首次使用需准备 Magenta 模型');
   prepare.textContent=status.preparing?'取消准备':'准备模型';
   prepare.onclick=()=>{
    prepare.disabled=true;
    void this.h.api.call(status.preparing?'live_play_cancel_preparation':'live_play_prepare',{}).then(()=>{
     if(!this.installPolling)this.pollInstallation(signal);
    }).catch(error=>this.showStatus(error.message)).finally(()=>{prepare.disabled=false;});
   };
   if(status.preparing&&!this.installPolling)this.pollInstallation(signal);
  }catch(error){if(!signal.aborted)this.showStatus((error as Error).message);}
 }
 private pollInstallation(signal:AbortSignal){
  this.installPolling=true;
  void (async()=>{
   try{
    while(!signal.aborted){
     await delay(1200);
     const status=await this.h.api.call('live_play_status',{});
     if(signal.aborted)return;
     this.showStatus(status.message??'正在准备 Magenta');
     const button=this.element<HTMLButtonElement>('[data-live-prepare]');
     if(!status.preparing){this.installPolling=false;await this.prepareOrStart(signal);return;}
     button.textContent='取消准备';
     button.onclick=()=>void this.h.api.call('live_play_cancel_preparation',{}).catch(e=>this.showStatus(e.message));
    }
   }catch(error){if(!signal.aborted)this.showStatus((error as Error).message);}
   finally{this.installPolling=false;}
  })();
 }
 private async run(signal:AbortSignal){
  const audio=this.audio!,sessionId=`live-${crypto.randomUUID()}`;
  this.sessionId=sessionId;
  try{
   this.launch=this.h.api.call('live_play_start',{sessionId});
   const started=await this.launch;
   if(signal.aborted)return;
   this.session=started;
   let lastRequest=0;
   while(!signal.aborted){
    if(audio.buffered>1.05&&(audio.context.state==='running'||performance.now()-lastRequest<2500)){await delay(100);continue;}
    lastRequest=performance.now();
    const labels=this.labels;
    const result=await this.h.api.call('live_play_next',{sessionId,offset:audio.end,heardFrame:audio.frame(),style:this.style});
    if(signal.aborted)return;
    this.session=result.session;
    if(result.session.phase==='failed'||result.session.phase==='stopped')throw Error(result.session.message);
    if(result.block){
     audio.push(result.block,labels);
    }else{
     if(!audio.end)this.showStatus(result.session.message);
     await delay(160);
    }
   }
  }catch(error){
   if(signal.aborted)return;
   if(this.session)this.session={...this.session,phase:'failed',message:(error as Error).message};
   this.playingStatus(false);
   this.showStatus((error as Error).message);
   await audio.close().catch(()=>{});
   await this.h.api.call('live_play_stop',{sessionId}).catch(()=>{});
  }
 }
 private renderAudio(){
  if(!this.audio)return;
  const audio=this.audio,{heard,mix,levels,trail,labels}=audio.visual();
  const now=heard>0&&audio.context.state==='running'&&audio.buffered>0&&this.session?.phase==='running';
  if(now&&!this.playing)this.showStatus('● 正在演奏');
  if(this.playing&&!now&&this.session?.phase==='running')this.showStatus(this.preview||this.externalAudio?'正在试听其他音频':'正在缓冲');
  this.playingStatus(now);
  const canvas=this.element<HTMLCanvasElement>('[data-live-wave]'),ctx=canvas.getContext('2d');
  if(ctx){
   ctx.clearRect(0,0,canvas.width,canvas.height);
   const color=getComputedStyle(canvas).color;
   ctx.fillStyle=color;
   const width=canvas.width/240,mid=canvas.height/2;
   levels.forEach((level,i)=>{
    const amplitude=Math.max(1,Math.sqrt(level)*mid*.95);
    ctx.fillRect((240-levels.length+i)*width,mid-amplitude,Math.max(1,width-.7),2*amplitude);
   });
  }
  const rail=this.element('.live-mix');
  rail.style.setProperty('--live-current',`${mix*100}%`);
  rail.style.setProperty('--live-target',`${this.style.mix*100}%`);
  this.h.panel.querySelectorAll<HTMLElement>('.live-nodes i').forEach((element,i)=>{
   element.hidden=trail[i]===undefined;
   if(!element.hidden)element.style.left=`${trail[i]*100}%`;
  });
  const heardLabel=this.element('[data-live-heard-label]');
  if(heard&&labels)heardLabel.textContent=`正在听到 · ${labels[0]} ${Math.round((1-mix)*100)}% · ${labels[1]} ${Math.round(mix*100)}%`;
  const save=this.element<HTMLButtonElement>('[data-live-save]');
  const message=this.element('[data-live-save-message]');
  if(heard>=15*48000&&message.textContent==='听满 15 秒即可留下')message.textContent='保存已听到的最近 15 秒';
  save.disabled=heard<15*48000||save.dataset.busy==='true'||this.session?.phase!=='running';
 }
 private async save(){
  const audio=this.audio,sessionId=this.sessionId;
  if(!audio||!sessionId)return;
  const button=this.element<HTMLButtonElement>('[data-live-save]'),message=this.element('[data-live-save-message]');
  if(button.disabled)return;
  const args=this.saving??={requestId:`capture-${crypto.randomUUID()}`,heardFrame:audio.frame(),title:`${this.labels[0].slice(0,28)}转${this.labels[1].slice(0,28)} · 片段 ${this.captures.length+1}`};
  button.dataset.busy='true';button.disabled=true;
  try{
   const saved=await this.h.api.call('live_play_save',{...args,sessionId});
   if(sessionId!==this.sessionId||!this.lifetime||this.lifetime.signal.aborted)return;
   this.captures.unshift(saved);this.saving=undefined;message.textContent='已留下 15 秒 · 声音库可重听';
   this.renderCaptures();await this.h.refresh();
  }catch(error){
   if(error instanceof WorkbenchApiError&&error.code==='CAPTURE_EXPIRED'){
    if(this.saving===args)this.saving=undefined;
    message.textContent=`${error.message}，再次点击可留下现在听到的片段`;
   }else message.textContent=(error as Error).message;
  }
  finally{delete button.dataset.busy;}
 }
 private renderCaptures(){
  const target=this.element('[data-live-saved]');
  target.parentElement!.hidden=false;
  target.replaceChildren();
  for(const item of this.captures){
   const row=document.createElement('div');row.className='live-saved-row';
   const play=document.createElement('button');play.type='button';play.className='icon-button';play.innerHTML=icon('play');play.setAttribute('aria-label',`试听 ${item.title}`);
   play.onclick=()=>void this.listen(item,play).catch(e=>this.h.notice(e.message));
   const title=document.createElement('span');title.textContent=item.title;
   const length=document.createElement('time');length.textContent='0:15';
   const attach=document.createElement('button');attach.type='button';attach.className='secondary';attach.textContent='加入项目';
   attach.onclick=()=>void this.h.attach(item).catch(e=>this.h.notice(e.message));
   row.append(play,title,length,attach);target.append(row);
  }
 }
 private async listen(item:OwnedSound,button:HTMLButtonElement){
  if(this.preview){this.preview.pause();return;}
  const lifetime=this.lifetime,audio=this.audio;if(!lifetime||!audio)return;
  const player=new Audio(await this.h.url(item.audioPath));
  if(lifetime.signal.aborted)return;
  this.preview=player;this.h.pauseOther();
  await audio.context.suspend();
  const resume=()=>{if(this.preview!==player)return;this.preview=undefined;button.innerHTML=icon('play');if(!lifetime.signal.aborted&&!this.externalAudio)void audio.context.resume().catch(()=>{});};
  player.onpause=resume;player.onended=resume;player.onerror=resume;
  try{await player.play();button.innerHTML=icon('pause');}catch(error){resume();throw error;}
 }
 async mediaPlayback(media:HTMLAudioElement,playing:boolean){
  const audio=this.audio;
  if(!audio||audio.context.state==='closed')return;
  if(playing){
   this.externalAudio=media;
   this.preview?.pause();
   if(audio.context.state==='running')await audio.context.suspend();
  }else if(this.externalAudio===media){
   this.externalAudio=undefined;
   if(!this.preview&&this.lifetime)await audio.context.resume();
  }
 }
 close(){
  if(this.release)return this.release;
  if(!this.active())return Promise.resolve();
  this.lifetime?.abort();this.lifetime=undefined;this.installPolling=false;
  if(this.nextFrame!==undefined)cancelAnimationFrame(this.nextFrame);
  const source=this.audio,sessionId=this.sessionId,launch=this.launch;
  this.preview?.pause();this.preview=undefined;this.externalAudio=undefined;
  this.audio=undefined;
  this.playing=false;
  this.showStatus('正在释放 Magenta…');
  const stop=this.element<HTMLButtonElement>('[data-stop-live]');
  this.h.panel.querySelectorAll<HTMLButtonElement>('button').forEach(button=>{button.disabled=true;});
  this.release=(async()=>{
   await source?.close().catch(error=>this.h.notice(error.message));
   if(!sessionId)return;
   if(!await this.stopSession(sessionId)&&launch){
    // An initial miss can mean the server has yet to receive the start request.
    await launch.catch(()=>{});
    await this.stopSession(sessionId);
   }
  })().then(()=>{
   this.sessionId=undefined;this.launch=undefined;this.session=undefined;
   this.h.panel.hidden=true;this.h.panel.replaceChildren();
   document.querySelector<HTMLElement>('#play-live')?.focus({preventScroll:true});
  }).catch(error=>{
   this.showStatus(`停止未确认 · ${error.message}`);stop.textContent='重试停止';stop.disabled=false;throw error;
  }).finally(()=>{this.release=undefined;this.h.change();});
  this.h.change();
  return this.release;
 }
 private async stopSession(sessionId:string){
  try{
   const result=await this.h.api.call('live_play_stop',{sessionId});
   if(!result.released)throw Error(result.message||'后台尚未确认模型释放');
   return true;
  }catch(error){if(error instanceof WorkbenchApiError&&error.code==='NOT_FOUND')return false;throw error;}
 }
 closeOnNavigation(){return this.lifetime?this.close():Promise.resolve();}
 pageExit(){
  const sessionId=this.sessionId;
  this.lifetime?.abort();
  if(sessionId)void this.h.api.request('/api/live_play_stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({sessionId}),keepalive:true}).catch(()=>{});
 }
}
