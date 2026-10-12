import {backend} from '../service.ts';
import type {LyricsResult} from '../../service/studio/lyrics.ts';
import './lyrics.css';
const mounted=new WeakSet<HTMLAudioElement>();
/** The panel follows its audio element, including background playback. */
export function mountLyrics(audio:HTMLAudioElement|null){
 if(!audio||mounted.has(audio)||!backend||!audio.dataset.version)return;
 mounted.add(audio);const version=audio.dataset.version;
 const section=document.createElement('section');section.className='player-lyrics';section.hidden=true;section.setAttribute('aria-label','歌词');audio.closest('.player-space')!.append(section);
 const header=document.createElement('div');header.className='lyrics-toolbar';
 function button(text:string){const b=document.createElement('button');b.className='quiet';b.textContent=text;return b;}
 const toggle=button('显示歌词'),follow=button('恢复跟随'),download=button('下载 LRC'),generate=button('生成同步歌词'),cancel=button('取消生成'),retry=button('重试读取');
 toggle.setAttribute('aria-expanded','false');follow.hidden=cancel.hidden=retry.hidden=true;
 const note=document.createElement('span');note.className='muted';note.setAttribute('role','status');
 const body=document.createElement('div');body.className='lyrics-scroll';body.hidden=true;body.tabIndex=0;body.setAttribute('aria-label','歌词内容');
 header.append(toggle,note,generate,cancel,follow,download,retry);section.append(header,body);
 let following=true,last=-2,result:LyricsResult|undefined,signature='',timer:ReturnType<typeof setTimeout>|undefined,requestId:string|undefined;
 const busy=()=>result?.job?.state==='queued'||result?.job?.state==='running';
 function update(){
  if(!result||body.hidden)return;
  const index=result.lines.findLastIndex(line=>audio!.currentTime>=line.start&&audio!.currentTime<line.end);if(index===last)return;last=index;
  body.querySelectorAll('.current-lyric').forEach(n=>{n.classList.remove('current-lyric');n.removeAttribute('aria-current');});
  if(index>=0){const line=body.children[index] as HTMLElement;line.classList.add('current-lyric');line.setAttribute('aria-current','true');if(following)body.scrollTop+=line.getBoundingClientRect().top-body.getBoundingClientRect().top-body.clientHeight/2+line.clientHeight/2;}
 }
 toggle.onclick=()=>{body.hidden=!body.hidden;toggle.textContent=body.hidden?'显示歌词':'收起歌词';toggle.setAttribute('aria-expanded',String(!body.hidden));last=-2;update();};
 for(const event of ['wheel','touchstart','keydown'])body.addEventListener(event,()=>{following=false;follow.hidden=false;},{passive:true});
 follow.onclick=()=>{following=true;follow.hidden=true;last=-2;update();};
 for(const event of ['timeupdate','seeked','loadedmetadata','play','ended'])audio.addEventListener(event,update);
 const path='/api/studio-lyrics?'+new URLSearchParams({versionId:version});
 async function request(url:string,init:RequestInit={}){const response=await backend!.request(url,{signal:AbortSignal.timeout(15000),...init});if(!response.ok){const error=await response.json().catch(()=>({}));throw Error(error.message??'歌词请求失败');}return response;}
 download.onclick=async()=>{download.disabled=true;try{const response=await request(path+'&format=lrc');const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=`${version}.lrc`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){note.textContent=(e as Error).message;}finally{download.disabled=false;}};
 generate.onclick=async()=>{
  generate.disabled=true;requestId??=crypto.randomUUID();
  try{await request(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({versionId:version,requestId})});requestId=undefined;await load();}
  catch(e){note.textContent=(e as Error).message;generate.disabled=false;}
 };
 cancel.onclick=async()=>{cancel.disabled=true;try{await request(path,{method:'DELETE'});await load();}catch(e){note.textContent=(e as Error).message;}finally{cancel.disabled=false;}};
 retry.onclick=()=>void load();
 async function load(){
  if(timer)clearTimeout(timer);
  try{
   const value=await(await request(path)).json() as LyricsResult;if(!audio!.isConnected)return;
   result=value;retry.hidden=true;section.hidden=value.kind==='none'&&!value.canGenerate;if(section.hidden)return;
   generate.hidden=!value.canGenerate;generate.disabled=busy()||!value.available;generate.title=value.available?'':'本机尚未准备歌词引擎';generate.textContent=busy()?'生成中…':value.kind==='synced'?'重新生成歌词':'生成同步歌词';cancel.hidden=!busy();
   download.hidden=value.kind!=='synced';note.textContent=busy()?`${value.job!.message} · ${value.job!.progress}%`:value.job&&value.job.state!=='succeeded'?value.job.message:value.kind==='plain'?'参考歌词 · 暂无同步时间':value.draft?'同步歌词 · 自动草稿，请试听核对':'同步歌词';
   if(value.job?.state==='succeeded')note.textContent=value.job.message;
   const next=JSON.stringify([value.kind,value.reference,value.lines]);
   if(next!==signature){
    signature=next;body.replaceChildren();last=-2;
    if(value.kind==='synced'){
     for(const line of value.lines){const b=button(line.text);b.className='lyric-line';b.onclick=()=>{audio!.currentTime=line.start;following=true;follow.hidden=true;last=-2;update();};body.append(b);}
     body.hidden=false;toggle.textContent='收起歌词';toggle.setAttribute('aria-expanded','true');update();
    }else{const text=document.createElement('p');text.className='plain-lyrics';text.textContent=value.reference;body.append(text);}
   }
   if(busy())timer=setTimeout(()=>void load(),1000);
  }catch(e){if(!audio!.isConnected)return;section.hidden=false;note.textContent=(e as Error).message;retry.hidden=false;if(busy())timer=setTimeout(()=>void load(),2500);}
 }
 void load();
}
