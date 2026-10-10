import type {Admission, HardwareSnapshot, ResourceDemand, ResourcePolicy, ResourceReason} from './contracts.ts';
const bytes = (n: number) => Number.isSafeInteger(n) && n >= 0;
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
  if (!demand.verified || !Object.keys(demand.peak).length || !Object.values(demand.peak).every(bytes))
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
  const budgets: Record<string, number> = {};
  let waiting = snapshot.pressure !== 'normal';
  for (const [id, peak] of Object.entries(demand.peak)) {
    const pool = snapshot.pools.find(p => p.id === id);
    if (!pool) return no('UNSUPPORTED_BACKEND', `未检测到所需资源池 ${id}`);
    const residentBytes = resident[id] ?? 0;
    if (residentBytes > pool.owned)
      return no('RESOURCE_TELEMETRY_UNAVAILABLE', '驻留资源超过测得占用，等待重新读取', true);
    const reserve = Math.max(policy.reserveMinimum, Math.ceil(pool.capacity * policy.reserveFraction));
    const limit = Math.max(0, Math.min(pool.capacity - reserve, pool.platformLimit ?? pool.capacity,
      policy.limits?.[id] ?? pool.capacity));
    if (peak > limit) return no('INSUFFICIENT_CAPACITY', `${id} 无法容纳此任务，需求超过应用可用上限`);
    const additional = Math.max(0, peak - residentBytes);
    const free = Math.max(0, Math.min(limit - pool.owned, pool.available - policy.headroom));
    if (additional > free) waiting = true;
    budgets[id] = peak;
  }
  return waiting ? no('WAITING_FOR_MEMORY', '等待其他任务结束或电脑释放内存', true) : {allowed: true, budgets};
}
