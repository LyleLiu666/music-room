import type {LyricLine,LyricsResult,LyricsReview} from '../../service/studio/lyrics.ts';

type SyncedLyrics=Extract<LyricsResult,{kind:'synced'}>;
type ReviewRow={
 text:HTMLInputElement;
 start:HTMLInputElement;
 end:HTMLInputElement;
 issueIndex?:number;
 removed:boolean;
};

export function createLyricsEditor(audio:HTMLAudioElement,value:SyncedLyrics,save:(update:LyricsReview)=>Promise<void>,close:()=>void){
 const form=document.createElement('form');form.className='lyrics-editor';form.setAttribute('aria-label','校对歌词');
 const heading=document.createElement('h3');heading.textContent='校对歌词';
 const hint=document.createElement('p');hint.className='field-note';hint.textContent='试听后修改歌词或填写起止秒数。待定位句可以留空，稍后继续。';
 const rows:ReviewRow[]=[];
 const controls=document.createElement('div');controls.className='lyrics-review-actions';
 const message=document.createElement('p');message.className='field-note';message.setAttribute('role','status');
 function button(label:string,action:()=>void){
  const b=document.createElement('button');b.type='button';b.className='quiet';b.textContent=label;b.onclick=action;return b;
 }
 function field(label:string,type:string,initial:string){
  const wrapper=document.createElement('label');wrapper.textContent=label;
  const input=document.createElement('input');input.type=type;input.value=initial;wrapper.append(input);
  return {wrapper,input};
 }
 function row(text:string,label:string,start?:number,end?:number,issueIndex?:number,window?:[number,number]){
  const element=document.createElement('fieldset');element.className='lyrics-review-row';
  const legend=document.createElement('legend');legend.textContent=label;
  const line=field('歌词','text',text),begin=field('起点（秒）','number',start===undefined?'':String(start)),finish=field('终点（秒）','number',end===undefined?'':String(end));
  line.input.required=true;line.input.maxLength=2000;
  for(const time of [begin.input,finish.input]){
   time.min='0';time.max=String(value.duration);time.step='any';time.required=issueIndex===undefined;
  }
  const state:ReviewRow={text:line.input,start:begin.input,end:finish.input,issueIndex,removed:false};
  rows.push(state);
  const actions=document.createElement('div');actions.className='lyrics-review-row-actions';
  const audition=button(window?'试听待定位段':issueIndex===undefined?'从这句试听':'从当前位置试听',()=>{
   const at=state.start.valueAsNumber;
   audio.currentTime=Number.isFinite(at)&&at>=0&&at<value.duration?at:window?.[0]??start??audio.currentTime;
   void audio.play().catch(()=>{message.textContent='无法播放，请用上方播放器试听。';});
  });
  function capture(input:HTMLInputElement){
   input.value=String(Math.floor(Math.min(audio.currentTime,value.duration)*1000)/1000);
  }
  const setStart=button('取当前起点',()=>capture(state.start)),setEnd=button('取当前终点',()=>capture(state.end));
  const remove=button('不收录',()=>{
   state.removed=!state.removed;
   for(const control of [line.input,begin.input,finish.input,audition,setStart,setEnd])control.disabled=state.removed;
   remove.textContent=state.removed?'恢复这句':'不收录';
  });
  actions.append(audition,setStart,setEnd,remove);
  if(issueIndex!==undefined){
   const range=document.createElement('p');range.className='field-note';
   range.textContent=window?'待试听范围 '+window.map(time=>time.toFixed(1)).join('–')+' 秒':'旧稿未记录试听范围，可用播放器定位。';
   element.append(legend,range);
  }else element.append(legend);
  element.append(line.wrapper,begin.wrapper,finish.wrapper,actions);
  return element;
 }
 const list=document.createElement('div');list.className='lyrics-review-list';
 list.append(...value.unresolved.map((issue,index)=>row(issue.text,'待定位 '+(index+1),undefined,undefined,index,issue.window)));
 list.append(...value.lines.map((line,index)=>row(line.text,'第 '+(index+1)+' 句',line.start,line.end)));
 const cancel=button('取消校对',close),submit=document.createElement('button');
 submit.type='submit';submit.className='primary';submit.textContent='保存歌词';
 controls.append(cancel,submit);
 form.append(heading,hint,list,message,controls);
 form.onsubmit=async event=>{
  event.preventDefault();
  const lines:LyricLine[]=[],pending:LyricsReview['pending']=[];
  for(const row of rows){
   if(row.removed)continue;
   const text=row.text.value.trim(),start=row.start.valueAsNumber,end=row.end.valueAsNumber;
   if(row.issueIndex!==undefined&&!row.start.value&&!row.end.value){
    pending.push({index:row.issueIndex,text});continue;
   }
   if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start){
    message.textContent='请填写有效的起止时间，终点须晚于起点。';row.start.focus();return;
   }
   lines.push({text,start,end});
  }
  lines.sort((a,b)=>a.start-b.start);
  submit.disabled=cancel.disabled=true;message.textContent='正在保存歌词…';
  try{await save({revision:value.revision,lines,pending});}
  catch(error){message.textContent=error instanceof Error?error.message:String(error);}
  finally{submit.disabled=cancel.disabled=false;}
 };
 return form;
}
