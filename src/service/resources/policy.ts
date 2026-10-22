import type {Admission, HardwareSnapshot, ResourceDemand, ResourcePolicy, ResourceReason, AdmissionDetail, ResourcePool} from './contracts.ts';
const bytes = (n: number) => Number.isSafeInteger(n) && n >= 0;
const gib=(n:number)=>`${(n/2**30).toFixed(1)} GiB`;
export function poolBudget(pool:ResourcePool,policy:ResourcePolicy){
 const reserve=Math.max(policy.reserveMinimum,Math.ceil(pool.capacity*policy.reserveFraction));
 const capacityLimit=Math.max(0,pool.capacity-reserve),limit=Math.max(0,Math.min(capacityLimit,pool.platformLimit??pool.capacity,policy.limits?.[pool.id]??pool.capacity));
 return {reserve,limit,startupBudget:Math.max(0,Math.min(limit-pool.owned,pool.available-policy.headroom))};
}
const no = (code: ResourceReason, message: string, retry = false): Admission => ({allowed: false, code, message, retry});
export function validPolicy(p: ResourcePolicy) {
  return Number.isFinite(p.reserveFraction) && p.reserveFraction >= 0 && p.reserveFraction < 1 &&
    [p.reserveMinimum, p.headroom, p.maxSnapshotAgeMs, p.maxWaitMs].every(bytes) &&
    Number.isSafeInteger(p.retryMs) && p.retryMs > 0 && Number.isSafeInteger(p.maxQueue) && p.maxQueue > 0 &&
    Object.values(p.limits ?? {}).every(bytes);
}
export function admit(snapshot: HardwareSnapshot, demand: ResourceDemand, policy: ResourcePolicy,
  now: number, resident: Record<string, number> = {}): Admission {
  if (!validPolicy(policy)) throw new Error('资源策略参数无效');
  if (!snapshot.supported) return no('UNSUPPORTED_BACKEND', '此设备尚无已验证的推理后端');
  const startup=demand.startup??demand.peak;
  if (!demand.verified || !Object.keys(demand.peak).length || !Object.values(demand.peak).every(bytes) ||
    Object.keys(startup).length!==Object.keys(demand.peak).length || Object.entries(startup).some(([id,value])=>!bytes(value)||!bytes(demand.peak[id])||value>demand.peak[id]))
    return no('RESOURCE_PROFILE_UNVERIFIED', '此模型配置的资源需求尚未验证');
  if (snapshot.topology === 'unknown' || !Number.isFinite(now) || !Number.isFinite(snapshot.sampledAt) ||
    now < snapshot.sampledAt || now - snapshot.sampledAt > policy.maxSnapshotAgeMs ||
    snapshot.pressure === 'unknown' || !snapshot.pools.length ||
    new Set(snapshot.pools.map(p => p.id)).size !== snapshot.pools.length ||
    snapshot.pools.some(p => !p.id || ![p.capacity, p.available, p.owned].every(bytes) ||
      p.available > p.capacity || p.owned > p.capacity || p.platformLimit !== undefined && !bytes(p.platformLimit)) ||
    !Object.values(resident).every(bytes))
    return no('RESOURCE_TELEMETRY_UNAVAILABLE', '当前资源数据不可靠，等待重新读取', true);
  // Unified devices must be represented by one shared pool; reject accidental CPU+GPU accounting.
  if (snapshot.topology === 'unified' && snapshot.pools.length !== 1)
    return no('RESOURCE_TELEMETRY_UNAVAILABLE', '统一内存不能重复记为内存和显存');
  const budgets: Record<string, number> = {},details:AdmissionDetail[]=[];
  let permanent=false;
  for (const [id, ceiling] of Object.entries(demand.peak)) {
    const pool = snapshot.pools.find(p => p.id === id);
    if (!pool) return no('UNSUPPORTED_BACKEND', `未检测到所需资源池 ${id}`);
    const residentBytes = resident[id] ?? 0;
    if (residentBytes > pool.owned)
      return no('RESOURCE_TELEMETRY_UNAVAILABLE', '驻留资源超过测得占用，等待重新读取', true);
    const {limit,startupBudget}=poolBudget(pool,policy),required=startup[id];
    const runtimeLimit=Math.min(ceiling,Math.max(0,limit-pool.owned+residentBytes));
    const shortfall=Math.max(0,required-residentBytes-startupBudget);
    let limiting:AdmissionDetail['limiting']=limit-pool.owned<=pool.available-policy.headroom?'application_usage':'system_memory';
    if(required>limit){
      permanent=true;
      limiting=policy.limits?.[id]===limit?'user_limit':pool.platformLimit===limit?'platform_limit':'capacity';
    }else if(snapshot.pressure!=='normal')limiting='pressure';
    details.push({pool:id,startup:required,runtimeLimit,applicationLimit:limit,owned:pool.owned,resident:residentBytes,availableEstimate:pool.available,headroom:policy.headroom,startupBudget,shortfall,limiting});
    budgets[id]=runtimeLimit;
  }
  const failed=details.find(d=>d.startup>d.applicationLimit)??details.find(d=>d.limiting==='pressure'||d.shortfall>0);
  if(!failed)return {allowed:true,budgets,details};
  const source={user_limit:'用户设置的应用上限',capacity:'扣除系统保留后的容量',platform_limit:'平台上限',application_usage:'本程序已有占用',system_memory:'当前系统资源',pressure:'系统内存压力偏高'}[failed.limiting];
  const message=`任务启动预约 ${gib(failed.startup)}，当前启动预算约 ${gib(failed.startupBudget)}${failed.resident?`，可复用驻留 ${gib(failed.resident)}`:''}，尚差约 ${gib(failed.shortfall)}；限制来自${source}`;
  return {...no(permanent?'INSUFFICIENT_CAPACITY':'WAITING_FOR_MEMORY',message,!permanent),details};
}
