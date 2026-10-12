import {backend} from '../service.ts';
import type {LyricsResult} from '../../service/studio/lyrics.ts';
import './lyrics.css';
const mounted=new WeakSet<HTMLAudioElement>();
/** Lives with the audio element, so polling and docking preserve both playback and lyrics. */
export function mountLyrics(audio:HTMLAudioElement|null){
 if(!audio||mounted.has(audio)||!backend||!audio.dataset.version)return;
 mounted.add(audio);const version=audio.dataset.version;
 const section=document.createElement('section');section.className='player-lyrics';section.hidden=true;section.setAttribute('aria-label','歌词');audio.closest('.player-space')!.append(section);
 const header=document.createElement('div');header.className='lyrics-toolbar';const toggle=document.createElement('button');toggle.className='quiet';toggle.textContent='显示歌词';toggle.setAttribute('aria-expanded','false');
 const note=document.createElement('span');note.className='muted';const follow=document.createElement('button');follow.className='quiet';follow.textContent='恢复跟随';follow.hidden=true;
 const download=document.createElement('button');download.className='quiet';download.textContent='下载 LRC';
 const body=document.createElement('div');body.className='lyrics-scroll';body.hidden=true;body.tabIndex=0;body.setAttribute('aria-label','歌词内容');header.append(toggle,note,follow,download);section.append(header,body);
 let following=true,last=-2,result:LyricsResult|undefined;
 function update(){if(!result||body.hidden)return;const index=result.lines.findLastIndex(line=>audio!.currentTime>=line.start&&audio!.currentTime<line.end);if(index===last)return;last=index;body.querySelectorAll('.current-lyric').forEach(n=>{n.classList.remove('current-lyric');n.removeAttribute('aria-current');});if(index>=0){const line=body.children[index] as HTMLElement;line.classList.add('current-lyric');line.setAttribute('aria-current','true');if(following)body.scrollTop+=line.getBoundingClientRect().top-body.getBoundingClientRect().top-body.clientHeight/2+line.clientHeight/2;}}
 toggle.onclick=()=>{body.hidden=!body.hidden;toggle.textContent=body.hidden?'显示歌词':'收起歌词';toggle.setAttribute('aria-expanded',String(!body.hidden));last=-2;update();};
 const stopFollowing=()=>{following=false;follow.hidden=false;};for(const event of ['wheel','touchstart','keydown'])body.addEventListener(event,stopFollowing,{passive:true});
 follow.onclick=()=>{following=true;follow.hidden=true;last=-2;update();};
 for(const event of ['timeupdate','seeked','loadedmetadata','play','ended'])audio.addEventListener(event,update);
 download.onclick=async()=>{download.disabled=true;try{const response=await backend!.request('/api/studio-lyrics?'+new URLSearchParams({versionId:version,format:'lrc'}));if(!response.ok)throw Error();const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=`${version}.lrc`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch{note.textContent='下载失败，请重试';}finally{download.disabled=false;}};
 async function load(){try{
  const response=await backend!.request('/api/studio-lyrics?'+new URLSearchParams({versionId:version}),{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error();const value=await response.json() as LyricsResult;if(!audio!.isConnected)return;result=value;section.hidden=value.kind==='none';if(section.hidden)return;
  download.hidden=value.kind!=='synced';note.textContent=value.kind==='plain'?'参考歌词 · 暂无同步时间':value.draft?'同步歌词 · 校正草稿':'同步歌词';body.replaceChildren();
  if(value.kind==='synced'){for(const line of value.lines){const button=document.createElement('button');button.className='lyric-line';button.textContent=line.text;button.onclick=()=>{audio!.currentTime=line.start;following=true;follow.hidden=true;last=-2;update();};body.append(button);}body.hidden=false;toggle.textContent='收起歌词';toggle.setAttribute('aria-expanded','true');last=-2;update();}
  else{const text=document.createElement('p');text.className='plain-lyrics';text.textContent=value.reference;body.append(text);}
 }catch{if(!audio!.isConnected)return;section.hidden=false;note.textContent='歌词读取失败';toggle.textContent='重试歌词';download.hidden=true;toggle.onclick=()=>{toggle.onclick=()=>{body.hidden=!body.hidden;toggle.textContent=body.hidden?'显示歌词':'收起歌词';toggle.setAttribute('aria-expanded',String(!body.hidden));last=-2;update();};void load();};}}
 void load();
}
