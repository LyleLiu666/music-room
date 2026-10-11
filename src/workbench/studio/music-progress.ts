import type {MusicProgress} from '../../service/yue2/progress.ts';
import type {StudioVersion} from '../../service/studio/studio.ts';
const titles={queued:'排队等待',load:'加载音乐模型',plan:'规划旋律与和弦',semantic:'生成音乐内容',conditioning:'准备声音合成',synthesize:'合成声音',decode:'导出音频',save:'保存音乐',running:'正在生成音乐'};
function duration(seconds:number){const s=Math.max(0,Math.floor(seconds));return s<60?`${s} 秒`:`${Math.floor(s/60)} 分 ${s%60} 秒`;}
function approximate(seconds:number){return seconds<60?'不到 1 分钟':`约 ${Math.round(seconds/60)} 分钟`;}
export function musicProgressView(p:MusicProgress,now=Date.now()){
 const age=p.updatedAt===undefined?undefined:Math.max(0,(now-p.updatedAt)/1000);
 const average=p.completed&&p.seconds?p.seconds/p.completed:undefined;
 const delayed=age!==undefined&&age>Math.max(120,(average??0)*3);
 const percent=p.total&&p.completed!==undefined?p.completed/p.total*100:undefined;
 const remainingSeconds=!delayed&&age!==undefined&&average&&p.total&&p.completed!>=2&&p.completed!<p.total?average*(p.total-p.completed!):undefined;
 const estimate=delayed?'进度暂未更新，暂时无法估计':p.completed===p.total&&p.total?'本阶段已完成，正在进入后续处理':remainingSeconds!==undefined?`本阶段预计还需 ${approximate(remainingSeconds)}`:p.stage==='queued'?'轮到任务后开始计时':'本阶段剩余时间暂时无法估计';
 const connected=p.checkedAt!==undefined&&now-p.checkedAt<=15000;
 const activity=delayed?`${duration(age!)}内未收到新进度${connected?'；音乐服务仍有响应':'；仍在等待进度，请查看本机状态'}`:age!==undefined?`最近推进：${duration(age)}前${connected?' · 音乐服务响应正常':''}`:connected?'音乐服务已响应，等待首条进度':'等待模型报告进度';
 const detail=p.total&&p.completed!==undefined?`${p.completed} / ${p.total} ${p.unit==='chunks'?'段':'步'}（本阶段）`:p.tokens!==undefined?`已生成 ${p.tokens} 个${p.stage==='plan'?'乐谱符号':'音乐标记'}`:'';
 const note=p.stage==='synthesize'?'按已完成步骤的平均速度估计；之后还需导出音频。':p.stage==='plan'||p.stage==='semantic'?'生成长度由模型决定，总量尚未知；完成后继续合成声音。':p.stage==='decode'?'正在把生成结果写成可试听的音频。':'完成后会自动保存在这个版本中。';
 return {title:titles[p.stage],percent,remainingSeconds,estimate,activity,detail,note,delayed,elapsed:p.startedAt===undefined?'':`已运行 ${duration((now-p.startedAt)/1000)}`};
}
const esc=(v:string)=>v.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function musicProgressMarkup(v:StudioVersion,now=Date.now()){
 if(v.source?.kind!=='music'||!['queued','running'].includes(v.state)||v.state==='queued'&&v.resource?.stage==='waiting_resources')return '';
 const p=v.musicProgress??{stage:v.state==='queued'?'queued':'running' as const},view=musicProgressView(p,now);
 return `<div class="music-progress ${view.delayed?'delayed':''}" data-music-progress="${esc(v.id)}"><strong data-progress-title>${esc(view.title)}</strong>${view.detail?`<span class="music-progress-detail">${esc(view.detail)}</span>`:''}<progress aria-label="${esc(view.title)}本阶段进度" ${view.percent===undefined?'':`max="100" value="${view.percent}"`}></progress><span class="music-progress-time">${esc([view.elapsed,view.estimate].filter(Boolean).join(' · '))}</span><span class="music-progress-activity">${esc(view.activity)}</span><span class="music-progress-note">${esc(view.note)}</span></div>`;
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
