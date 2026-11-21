import {icon} from './icons.ts';
import {admit,hardwareSnapshotIssue,poolBudget,validPolicy} from '../../service/resources/policy.ts';
import type {MusicRecovery} from '../../service/yue2/contracts.ts';
import {modelMemory} from '../../service/resources/model-memory.ts';
import type {ResourceStatus} from '../../service/operations.ts';
import type {Admission,ResourceTaskState} from '../../service/resources/contracts.ts';
export const resourceEngineNames:Record<string,string>={'sound-effects':'音效生成',tts:'语音',reference:'参考清理',conversion:'音色转换',yue2:'音乐',render:'乐谱合成',speed:'调速',lyrics:'同步歌词',installation:'安装准备',import:'音频导入'};
const escape=(v:unknown)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export function musicRecoveryNote(recovery?:MusicRecovery){
 return recovery?{plan:'已保存乐谱，将从音乐内容生成继续。',semantic:'已保存乐谱和音乐内容，将从声音合成继续。',synthesis:'已保存完整声音合成结果，将从音频导出继续。'}[recovery.stage]:'尚无可用恢复点，将更换随机种子从头生成。创作要求保留，旋律可能变化。';
}
/** Recovery follows the backend reason code, never guesses from an error's wording. */
export function resourceFailure(resource:Pick<ResourceTaskState,'reason'|'message'|'diagnostic'>|undefined,music:boolean,canRetry=true,recovery?:MusicRecovery,effect=false){
 if(!resource?.reason||!['PRESSURE_PROTECTION','PEAK_EXCEEDED','INSUFFICIENT_CAPACITY','WAITING_FOR_MEMORY','RESOURCE_TELEMETRY_UNAVAILABLE','RESOURCE_PROFILE_UNVERIFIED'].includes(resource.reason))return '';
 const title=resource.reason==='RESOURCE_PROFILE_UNVERIFIED'?'生成前检查未通过':resource.reason==='RESOURCE_TELEMETRY_UNAVAILABLE'?'内存监测失败，生成已停止':resource.reason==='INSUFFICIENT_CAPACITY'?'当前内存额度不足以运行此模型':resource.reason==='WAITING_FOR_MEMORY'?'等待可用内存超时，生成尚未开始':'为保护电脑，生成已停止';
 const advice=resource.reason==='RESOURCE_PROFILE_UNVERIFIED'?(effect?'任务尚未开始，请检查音效描述、1–5 秒时长和模型状态。':music?'任务尚未开始，请检查输入范围与模型状态。':'任务尚未开始，请检查正文长度与模型状态。长稿会自动分段，最多 8000 字。'):resource.reason==='RESOURCE_TELEMETRY_UNAVAILABLE'?'程序未能可靠读取内存数据，已停止任务。无需修改创作内容；请查看技术详情中的监测错误。':resource.reason==='INSUFFICIENT_CAPACITY'?'请查看本机内存与应用上限，确认是否满足模型需求。':resource.reason==='PEAK_EXCEEDED'?'任务占用超过已验证的内存预算。请尝试减少生成内容；如果仍然失败，需要核查模型的内存预算。':resource.reason==='WAITING_FOR_MEMORY'?'电脑内存压力持续偏高或可用内存不足（页面上的“可用估计”包含系统缓存，不代表立即可用的空闲内存）。请先关闭暂时不用的其他应用，查看内存状态，待压力恢复正常后再尝试。':'运行时触发了内存保护。请先关闭暂时不用的应用，查看内存状态，待压力恢复正常后再尝试。';
 return `<div class="empty-player"><span aria-hidden="true">${icon('circle')}</span><div><strong>${title}</strong><p>${advice}${music&&!['RESOURCE_TELEMETRY_UNAVAILABLE','RESOURCE_PROFILE_UNVERIFIED'].includes(resource.reason)?'也可在“修改要求”中改用“较快尝试”，但仍需满足内存要求。':''}创作要求已保留，无需重写。</p>${music?`<p class="music-recovery-note">${musicRecoveryNote(recovery)}</p>`:''}<div class="failure-actions">${canRetry?`<button class="primary" data-action="retry-generation">${music&&recovery?'继续生成':'重试生成'}</button><button class="secondary" data-action="iterate">修改要求</button>`:'<button class="primary" data-action="iterate">修改后重试</button>'}<button class="quiet" data-action="resource-overview">查看内存状态</button></div>${resource.message?`<details class="failure-details"><summary>技术详情</summary><p>${escape(resource.message)}${resource.diagnostic?`<br>${escape(resource.diagnostic)}`:''}</p></details>`:''}</div></div>`;
}
const gib=(bytes:number)=>`${(bytes/2**30).toFixed(1)} GiB`;
const stages:Record<string,string>={queued:'排队中',waiting_resources:'等待资源',loading:'加载中',running:'处理中',cancelling:'正在取消',succeeded:'完成',blocked:'已阻止',failed:'失败',cancelled:'已取消'};
const pressureText={normal:'正常',warning:'偏高，后续任务等待',critical:'过高，已停止重型任务',unknown:'暂时无法读取'};
const capabilityNames:Record<keyof typeof modelMemory,string>={
 lyrics:'同步歌词',soundEffects:'音效生成',breeze:'语音 · Breeze',indexTts:'语音 · IndexTTS',
 yue:'音乐 · YuE2',reference:'参考清理 · UVR',conversion:'音色转换 · Seed-VC'
};
function ownedPurpose(active:ResourceStatus['active'],hasResidents:boolean,sampled:number|undefined){
 if(active){
  const name=escape(resourceEngineNames[active.engine]??active.engine);
  const stage=active.stage==='running'?'正在运行':stages[active.stage];
  return `（${stage}：${name}${sampled!==undefined&&Number.isFinite(sampled)?` ${gib(sampled)}`:''}）`;
 }
 return hasResidents?'（含已加载模型）':'（后台服务）';
}
function capabilityStatus(decision:Admission|undefined,readyText:string){
 if(decision?.allowed)return {tone:'ready',text:readyText};
 if(decision?.code==='UNSUPPORTED_BACKEND')return {tone:'blocked',text:'设备不支持'};
 if(decision?.code==='INSUFFICIENT_CAPACITY')return {tone:'blocked',text:'超出上限'};
 if(decision?.code==='WAITING_FOR_MEMORY'){
  const detail=decision.details?.[0];
  if(detail?.limiting==='pressure')return {tone:'wait',text:'等待压力恢复'};
  if(detail?.shortfall)return {tone:'wait',text:detail.shortfall<0.05*2**30?'还差不到 0.1 GiB':`还差 ${gib(detail.shortfall)}`};
 }
 return {tone:'unknown',text:'状态未知'};
}
function renderCapabilityGuide(hardware:ResourceStatus['hardware'],policy:ResourceStatus['policy'],now:number){
 const items=(Object.keys(capabilityNames) as (keyof typeof modelMemory)[]).map(key=>{
  const name=capabilityNames[key],demand=modelMemory[key];
  const startup=demand.startup.memory,peak=demand.peak.memory;
  const varying=key==='yue';
  const demandText=varying?`${gib(startup)} 起 · 随输入变化`:startup!==peak?`启动 ${gib(startup)} · 上限 ${gib(peak)}`:gib(startup);
  const decision=hardware?admit(hardware,demand,policy,now):undefined;
  const state=capabilityStatus(decision,varying?'达到起步要求':'内存充足');
  return `<li class="memory-capability-item"><span class="memory-capability-name">${name}</span><span class="memory-capability-demand">${demandText}</span><span class="memory-capability-state is-${state.tone}">${state.text}</span></li>`;
 }).join('');
 return `<div class="memory-capabilities"><p class="memory-capabilities-head"><span>各功能内存需求</span><span class="field-note">任务排队串行执行，仅在生成时加载当前模型，完成后立即从内存卸载</span></p><ul class="memory-capability-list" aria-label="各功能内存需求">${items}</ul></div>`;
}
/** 任务与资源页按照后台准入规则展示各功能的内存情况。 */
export function resourceOverview(status:ResourceStatus|undefined,details='',offline=false){
 if(!status)return `<div class="block-head"><h2>本机资源</h2><span class="block-meta">${offline?'暂时无法读取电脑资源':'正在读取电脑资源…'}</span></div>${details?`<details class="resource-details"><summary>详细数据</summary>${details}</details>`:''}`;
 const now=Date.now(),policy=status.policy,active=offline?undefined:status.active;
 const sample=status.hardware;
 const hardware=!offline&&!status.hardwareError&&sample&&policy&&validPolicy(policy)&&!hardwareSnapshotIssue(sample,policy,now)?sample:undefined;
 const residentList=offline?[]:status.residents??[],history=status.history??[];
 const reservations=Object.values(status.reservations??{});
 const observation=active&&['loading','running','cancelling'].includes(active.stage)&&reservations.length?status.observation:undefined;
 const busy=!!active||!!status.queued?.length;
 const pools=hardware?hardware.pools.map(p=>{
  const {reserve,limit,startupBudget}=poolBudget(p,policy);
  const available=Math.min(p.available,p.capacity-p.owned);
  const parts:[string,number,string,string?][]=[
   ['本程序',p.owned,'owned',ownedPurpose(active,residentList.length>0,observation?.usage?.[p.id])],
   ['其余内存',p.capacity-p.owned-available,'other'],
   ['系统可用估计',available,'free','（含可回收缓存，非纯空闲）']
  ];
  const name=hardware.topology==='unified'?'共享内存':p.id==='memory'?'系统内存':escape(p.id);
  const state=!hardware.supported?'设备不支持':hardware.pressure!=='normal'?'等待压力恢复':`新任务可用 <b>${gib(startupBudget)}</b>`;
  const legend=`<div class="memory-legend">${parts.map(([n,v,k,note])=>`<span><i class="memory-${k}"></i>${n} <b>${gib(v)}</b>${note??''}</span>`).join('')}</div>`;
  const pressureNote=hardware.pressure==='normal'?'':`<p class="field-note">为何显示还有 ${gib(available)} 却仍在等待：该估计包含系统随时可清理的缓存，并非真正空余内存${hardware.memory?`（当前实际空闲仅 ${gib(hardware.memory.free)}，已压缩 ${gib(hardware.memory.compressed)}、使用交换空间 ${gib(hardware.memory.swapUsed)}）`:''}。因系统内存压力${hardware.pressure==='critical'?'过高':'偏高'}，为防电脑卡顿已暂停启动新模型；关闭几个暂不使用的后台应用即可恢复。</p>`;
  return {summary:`<div class="memory-pool"><p class="memory-summary">${state} · 应用上限 <b>${gib(limit)}</b>（${policy.limits?.[p.id]===undefined?'自动':'手动'}）· ${name} ${gib(p.capacity)}</p><div class="memory-bar" role="img" aria-label="${name}分布：${parts.map(([n,v])=>`${n} ${gib(v)}`).join('，')}">${parts.map(([n,v,k])=>`<span class="memory-${k}" style="width:${(v/Math.max(p.capacity,1)*100).toFixed(2)}%" title="${n} ${gib(v)}"></span>`).join('')}</div>${legend}<p class="field-note">系统保留额度 <b>${gib(reserve)}</b></p>${pressureNote}</div>`,
   detail:`<p class="field-note">系统可用估计 ${gib(p.available)}（由系统可腾出比例粗估，含缓存） · 启动额外余量 ${gib(policy.headroom)}</p>`};
 }):[];
 const usage=observation?`<p class="field-note">当前任务采样 ${Object.values(observation.usage).map(gib).join(' / ')} · 运行保护上限 ${reservations.map(gib).join(' / ')}（采样保护并非瞬时硬上限）</p>`:'';
 const residents=offline?'状态未知':residentList.map(r=>`<b>${escape(resourceEngineNames[r.engine]??r.engine)}</b>`).join('、')||'无';
 return `<div class="block-head"><h2>本机资源</h2><span class="block-meta">${hardware?`内存压力 ${pressureText[hardware.pressure]} · 采样 ${escape(new Date(hardware.sampledAt).toLocaleTimeString())}`:'暂时无法读取电脑资源'}</span><button class="text-link" data-action="settings" data-section="memory">调整内存上限</button></div>${status.fault||status.configurationError?`<p role="alert" class="resource-alert">${escape(status.fault?.message??status.configurationError)}</p>`:''}${pools.map(x=>x.summary).join('')}${renderCapabilityGuide(hardware,policy,now)}${usage}<div class="resident-row"><span>已加载模型</span><span>${residents}</span><button class="quiet" data-action="resource-release" ${offline||busy?'disabled':''} title="${offline?'暂时无法连接后台':busy?'有任务时不能释放':'重型任务结束后会自动释放'}">释放空闲模型</button></div><details class="resource-details"><summary>详细数据</summary>${pools.map(x=>x.detail).join('')}${details}${history.slice(-3).reverse().map(t=>`<p class="field-note">最近：${escape(resourceEngineNames[t.engine]??t.engine)} · ${escape(t.message??stages[t.stage])}</p>`).join('')}<p class="field-note">已验证输入范围：语音正文最多 8000 字，每段最多 140 字，参考音频 15 秒；音乐按实际分词检查上下文容量，并预留规划与生成空间。能否运行还取决于本机容量和当前压力。</p></details>`;
}
/** 设置 · 内存与资源：当前实际生效的应用上限。 */
export function memoryLimitSummary(status:ResourceStatus|undefined){
 const pool=status?.hardware?.pools.find(p=>p.id==='memory')??status?.hardware?.pools[0];
 if(!status?.policy||!pool)return '正在读取当前上限…';
 return `当前应用上限 ${gib(poolBudget(pool,status.policy).limit)}（${status.policy.limits?.memory===undefined?'自动管理':'手动设置'}）`;
}
