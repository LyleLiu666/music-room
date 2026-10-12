import type {MusicProgress} from '../../service/yue2/progress.ts';
import type {StudioVersion} from '../../service/studio/studio.ts';
const titles={queued:'排队等待',load:'加载音乐模型',plan:'规划旋律与和弦',semantic:'生成音乐内容',conditioning:'准备声音合成',synthesize:'合成声音',decode:'导出音频',save:'保存音乐',running:'正在生成音乐'};
const majorStages=[{title:'规划旋律与和弦',label:'旋律和弦',phases:['plan']},{title:'生成音乐内容',label:'音乐内容',phases:['semantic']},{title:'准备声音合成',label:'合成准备',phases:['conditioning']},{title:'合成声音',label:'声音合成',phases:['synthesize']},{title:'导出与保存',label:'导出保存',phases:['decode','save']}];
function duration(seconds:number){const s=Math.max(0,Math.floor(seconds));return s<60?`${s} 秒`:`${Math.floor(s/60)} 分 ${s%60} 秒`;}
function approximate(seconds:number){return seconds<60?'不到 1 分钟':`约 ${Math.round(seconds/60)} 分钟`;}
export function musicProgressView(p:MusicProgress,now=Date.now()){
 const current=majorStages.findIndex(s=>s.phases.includes(p.stage));
 const stages=majorStages.map((s,index)=>({title:s.title,label:s.label,state:current<0||index>current?'pending':index===current?'current':'complete'}));
 const title=current<0?titles[p.stage]:`第 ${current+1} / ${majorStages.length} 阶段 · ${majorStages[current].title}`;
 const age=p.updatedAt===undefined?undefined:Math.max(0,(now-p.updatedAt)/1000);
 const average=p.completed&&p.seconds?p.seconds/p.completed:undefined;
 const delayed=age!==undefined&&age>Math.max(120,(average??0)*3);
 const percent=p.total&&p.completed!==undefined?p.completed/p.total*100:undefined;
 const remainingSeconds=!delayed&&age!==undefined&&average&&p.total&&p.completed!>=2&&p.completed!<p.total?average*(p.total-p.completed!):undefined;
 const estimate=delayed?'进度暂未更新，暂时无法估计':p.completed===p.total&&p.total?'本阶段已完成，正在进入后续处理':remainingSeconds!==undefined?`本阶段预计还需 ${approximate(remainingSeconds)}`:p.stage==='queued'?'轮到任务后开始计时':'本阶段剩余时间暂时无法估计';
 const connected=p.checkedAt!==undefined&&now-p.checkedAt<=15000;
 const activity=delayed?`${duration(age!)}内未收到新进度${connected?'；音乐服务仍有响应':'；仍在等待进度，请查看本机状态'}`:age!==undefined?`最近推进：${duration(age)}前${connected?' · 音乐服务响应正常':''}`:connected?'音乐服务已响应，等待首条进度':'等待模型报告进度';
 const detail=p.total&&p.completed!==undefined?(p.stage==='synthesize'?`已完成 ${p.completed} / ${p.total} 小步`:`${p.completed} / ${p.total} 段（当前环节）`):p.tokens!==undefined?`已生成 ${p.tokens} 个${p.stage==='plan'?'乐谱符号':'音乐标记'}`:'';
 const note=p.stage==='synthesize'?'按已完成步骤的平均速度估计；之后还需导出音频。':p.stage==='plan'||p.stage==='semantic'?'生成长度由模型决定，总量尚未知；完成后继续合成声音。':p.stage==='decode'?'正在把生成结果写成可试听的音频。':'完成后会自动保存在这个版本中。';
 return {title,stages,percent,remainingSeconds,estimate,activity,detail,note,delayed,elapsed:p.startedAt===undefined?'':`总计已运行 ${duration((now-p.startedAt)/1000)}`,phaseElapsed:p.seconds===undefined?'':`当前环节已用 ${duration(p.seconds)}`};
}
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function musicProgressMarkup(v:StudioVersion,now=Date.now()){
 if(v.source?.kind!=='music'||!['queued','running'].includes(v.state)||v.state==='queued'&&v.resource?.stage==='waiting_resources')return '';
 const p=v.musicProgress??{stage:v.state==='queued'?'queued':'running' as const},view=musicProgressView(p,now);
 const segments=`<ol class="music-stage-list" aria-label="音乐生成的 5 个阶段">${view.stages.map((s,i)=>{const status=s.state==='complete'?'已完成':s.state==='current'?'进行中':'待进行';return `<li class="music-stage ${s.state}" title="${esc(s.title)} · ${status}" aria-label="第 ${i+1} 阶段：${esc(s.title)}，${status}" ${s.state==='current'?'aria-current="step"':''}><span class="music-stage-number" aria-hidden="true">${i+1}</span><span class="music-stage-name">${esc(s.label)}</span></li>`;}).join('')}</ol>`;
 const percent=view.percent===undefined?'进度待定':`${Number(view.percent.toFixed(1))}%`;
 const timing=[p.startedAt===undefined?'':`总计 ${duration((now-p.startedAt)/1000)}`,p.seconds===undefined?'':`本环节 ${duration(p.seconds)}`,view.remainingSeconds===undefined?(p.completed===p.total&&p.total?'即将进入下一阶段':''):`本阶段预计还需 ${approximate(view.remainingSeconds)}`,view.delayed?'':p.checkedAt!==undefined&&now-p.checkedAt<=15000?'服务正常':'等待进度'].filter(Boolean).join(' · ');
 return `<div class="music-progress ${view.delayed?'delayed':''}" data-music-progress="${esc(v.id)}">${segments}<div class="music-progress-heading"><strong data-progress-title>${esc(view.title)}</strong><span class="music-progress-detail"><span>${esc(percent)}</span>${view.detail?` · <span>${esc(view.detail)}</span>`:''}</span></div><progress aria-label="${esc(view.title)}本阶段进度" title="${esc(view.note)}" ${view.percent===undefined?'':`max="100" value="${view.percent}"`}></progress><span class="music-progress-time" title="${esc(view.activity)}">${esc(timing)}</span>${view.delayed?`<span class="music-progress-activity" role="status">${esc(view.activity)}</span>`:''}</div>`;
}
/** Update only status nodes, keeping audio, controls, menus and user focus connected. */
export function refreshMusicProgress(versions:StudioVersion[],now=Date.now()){
 for(const host of document.querySelectorAll<HTMLElement>('[data-music-progress]')){
  const v=versions.find(v=>v.id===host.dataset.musicProgress);if(!v)continue;
  const markup=musicProgressMarkup(v,now);if(!markup)continue;
  const template=document.createElement('template');template.innerHTML=markup;const next=template.content.firstElementChild!;
  host.className=next.className;host.replaceChildren(...next.childNodes);
 }
}
