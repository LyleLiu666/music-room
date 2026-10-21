import type {StudioVersion} from '../../service/studio/studio.ts';
import {musicRecoveryNote} from './resources.ts';

const escape=(value:unknown)=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const states={queued:'排队中',running:'生成中',succeeded:'已完成',failed:'失败',cancelled:'已取消',interrupted:'已中断'};
/** Attempts are execution history inside one work version, not new creative versions. */
export function musicAttemptsMarkup(v:StudioVersion){
 const attempts=[...(v.musicAttempts??[]),{jobId:v.source.id,input:v.input,state:v.state,stage:v.stage,error:v.error,recovery:v.musicRecovery,resumedFrom:v.musicResumedFrom,startedAt:v.musicAttemptStartedAt??v.createdAt}];
 return `<p class="field-note">这些是 V${v.number} 的生成记录。重试和继续生成都在此版本内完成。</p><ol class="music-attempts">${attempts.map((a,i)=>{
  const date=new Date(a.startedAt),started=Number.isFinite(date.getTime())?date.toLocaleString('zh-CN',{hour12:false}):'时间未记录';
  return `<li><strong>第 ${i+1} 次 · ${states[a.state]}</strong><p class="field-note">${escape(started)} · 随机种子：${a.input?.seed??'未记录'}</p><p>${a.resumedFrom?escape(musicRecoveryNote(a.resumedFrom)):'从头生成'}</p><p>${escape(a.stage)}</p>${a.error?`<details><summary>失败详情</summary><p class="requirement-text">${escape(a.error)}</p></details>`:''}</li>`;
 }).reverse().join('')}</ol>`;
}
