import {icon} from './icons.ts';
import {poolBudget} from '../../service/resources/policy.ts';
import type {MusicRecovery} from '../../service/yue2/contracts.ts';
import type {ResourceStatus} from '../../service/operations.ts';
import type {ResourceTaskState} from '../../service/resources/contracts.ts';
export const resourceEngineNames:Record<string,string>={'sound-effects':'音效生成',tts:'语音',reference:'参考清理',conversion:'音色转换',yue2:'音乐',render:'乐谱合成',speed:'调速',lyrics:'同步歌词',installation:'安装准备',import:'音频导入'};
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function musicRecoveryNote(recovery?:MusicRecovery){
 return recovery?{plan:'已保存乐谱，将从音乐内容生成继续。',semantic:'已保存乐谱和音乐内容，将从声音合成继续。',synthesis:'已保存完整声音合成结果，将从音频导出继续。'}[recovery.stage]:'尚无可用恢复点，将更换随机种子从头生成。创作要求保留，旋律可能变化。';
}
/** Recovery follows the backend reason code, never guesses from an error's wording. */
export function resourceFailure(resource:Pick<ResourceTaskState,'reason'|'message'|'diagnostic'>|undefined,music:boolean,canRetry=true,recovery?:MusicRecovery,effect=false){
 if(!resource?.reason||!['PRESSURE_PROTECTION','PEAK_EXCEEDED','INSUFFICIENT_CAPACITY','RESOURCE_TELEMETRY_UNAVAILABLE','RESOURCE_PROFILE_UNVERIFIED'].includes(resource.reason))return '';
 const title=resource.reason==='RESOURCE_PROFILE_UNVERIFIED'?'生成前检查未通过':resource.reason==='RESOURCE_TELEMETRY_UNAVAILABLE'?'内存监测失败，生成已停止':resource.reason==='INSUFFICIENT_CAPACITY'?'当前内存额度不足以运行此模型':'为保护电脑，生成已停止';
 const advice=resource.reason==='RESOURCE_PROFILE_UNVERIFIED'?(effect?'任务尚未开始，请检查音效描述、1–5 秒时长和模型状态。':music?'任务尚未开始，请检查输入范围与模型状态。':'任务尚未开始，请检查正文长度与模型状态。长稿会自动分段，最多 8000 字。'):resource.reason==='RESOURCE_TELEMETRY_UNAVAILABLE'?'程序未能可靠读取内存数据，已停止任务。无需修改创作内容；请查看技术详情中的监测错误。':resource.reason==='INSUFFICIENT_CAPACITY'?'请查看本机内存与应用上限，确认是否满足模型需求。':resource.reason==='PEAK_EXCEEDED'?'任务占用超过已验证的内存预算。请尝试减少生成内容；如果仍然失败，需要核查模型的内存预算。':'运行时触发了内存保护。请先关闭暂时不用的应用，查看内存状态，待压力恢复正常后再尝试。';
 return `<div class="empty-player"><span aria-hidden="true">${icon('circle')}</span><div><strong>${title}</strong><p>${advice}${music&&!['RESOURCE_TELEMETRY_UNAVAILABLE','RESOURCE_PROFILE_UNVERIFIED'].includes(resource.reason)?'也可在“修改要求”中改用“较快尝试”，但仍需满足内存要求。':''}创作要求已保留，无需重写。</p>${music?`<p class="music-recovery-note">${musicRecoveryNote(recovery)}</p>`:''}<div class="failure-actions">${canRetry?`<button class="primary" data-action="retry-generation">${music&&recovery?'继续生成':'重试生成'}</button><button class="secondary" data-action="iterate">修改要求</button>`:'<button class="primary" data-action="iterate">修改后重试</button>'}<button class="quiet" data-action="resource-overview">查看内存状态</button></div>${resource.message?`<details class="failure-details"><summary>技术详情</summary><p>${escape(resource.message)}${resource.diagnostic?`<br>${escape(resource.diagnostic)}`:''}</p></details>`:''}</div></div>`;
}
const gib=(bytes:number)=>`${(bytes/2**30).toFixed(1)} GiB`;
const stages:Record<string,string>={queued:'排队中',waiting_resources:'等待资源',loading:'加载中',running:'处理中',cancelling:'正在取消',succeeded:'完成',blocked:'已阻止',failed:'失败',cancelled:'已取消'};
const pressureText={normal:'正常',warning:'偏高，后续任务等待',critical:'过高，已停止重型任务',unknown:'暂时无法读取'};
/** 任务与资源页的「本机资源」区块。数据只来自 resource_status / monitor_status，不另做估算。 */
export function resourceOverview(status:ResourceStatus|undefined,details='',offline=false){
 if(!status)return `<div class="block-head"><h2>本机资源</h2><span class="block-meta">${offline?'暂时无法读取电脑资源':'正在读取电脑资源…'}</span></div>${details?`<details class="resource-details"><summary>详细数据</summary>${details}</details>`:''}`;
 const hardware=status.hardware,policy=status.policy,tasks=[...(status.active?[status.active]:[]),...(status.queued??[])],residentList=status.residents??[],history=status.history??[];
 const pools=hardware&&policy?hardware.pools.map(p=>{
  const {reserve,limit,startupBudget}=poolBudget(p,policy),capacity=Math.max(p.capacity,1),owned=Math.max(0,p.owned);
  const parts:[string,number,string][]=[['系统保留',reserve,'reserve'],['本程序',owned,'owned'],['现在可用',startupBudget,'free']];
  const other=Math.max(0,capacity-reserve-owned-startupBudget);parts.splice(1,0,['其他占用与余量',other,'other']);
  const name=hardware.topology==='unified'?'共享内存':p.id==='memory'?'系统内存':escape(p.id);
  return `<div class="memory-pool"><div class="memory-bar" role="img" aria-label="${name}分布：${parts.map(([n,v])=>`${n} ${gib(v)}`).join('，')}">${parts.map(([n,v,k])=>`<span class="memory-${k}" style="width:${(v/capacity*100).toFixed(2)}%" title="${n} ${gib(v)}"></span>`).join('')}</div><div class="memory-legend">${parts.map(([n,v,k])=>`<span><i class="memory-${k}"></i>${n} <b>${gib(v)}</b></span>`).join('')}</div><p class="memory-facts">${name} <b>${gib(p.capacity)}</b> · 应用上限 <b>${gib(limit)}</b>（${policy.limits?.memory===undefined?'自动':'手动'}）· 启动新任务最多可用 <b>${gib(startupBudget)}</b></p><p class="field-note">系统可用估计 ${gib(p.available)} · 为系统保留 ${gib(reserve)} · 额外余量 ${gib(policy.headroom)}</p></div>`;
 }).join(''):'<p>电脑资源暂时无法读取</p>';
 const usage=status.active&&status.observation&&status.reservations?`<p class="field-note">当前任务采样 ${Object.values(status.observation.usage).map(gib).join(' / ')} · 运行保护上限 ${Object.values(status.reservations).map(gib).join(' / ')}（采样保护并非瞬时硬上限）</p>`:'';
 const residents=residentList.length?residentList.map(r=>`<b>${escape(resourceEngineNames[r.engine]??r.engine)}</b>`).join('、'):'无';
 return `<div class="block-head"><h2>本机资源</h2><span class="block-meta">内存压力 ${hardware?pressureText[hardware.pressure]:'暂时无法读取'}${hardware?` · 采样 ${escape(new Date(hardware.sampledAt).toLocaleTimeString())}`:''}</span><button class="text-link" data-action="settings" data-section="memory">调整内存上限</button></div>${status.fault||status.configurationError?`<p role="alert" class="resource-alert">${escape(status.fault?.message??status.configurationError)}</p>`:''}${pools}${usage}<div class="resident-row"><span>模型驻留</span><span>${residents}</span><span class="resident-note">${tasks.length?'有任务时不能释放':'重型任务结束后自动释放'}</span><button class="secondary" data-action="resource-release" ${tasks.length?'disabled':''}>释放空闲模型</button></div><details class="resource-details"><summary>详细数据</summary>${details}${history.slice(-3).reverse().map(t=>`<p class="field-note">最近：${escape(resourceEngineNames[t.engine]??t.engine)} · ${escape(t.message??stages[t.stage])}</p>`).join('')}<p class="field-note">已验证输入范围：语音正文最多 8000 字，每段最多 140 字，参考音频 15 秒；音乐按实际分词检查上下文容量，并预留规划与生成空间。能否运行还取决于本机容量和当前压力。</p></details>`;
}
/** 设置 · 内存与资源：当前实际生效的应用上限。 */
export function memoryLimitSummary(status:ResourceStatus|undefined){
 const pool=status?.hardware?.pools.find(p=>p.id==='memory')??status?.hardware?.pools[0];
 if(!status?.policy||!pool)return '正在读取当前上限…';
 return `当前应用上限 ${gib(poolBudget(pool,status.policy).limit)}（${status.policy.limits?.memory===undefined?'自动管理':'手动设置'}）`;
}
