/** Bytes throughout. A unified CPU/GPU device has one pool, not two copies. */
export type ResourcePool = {
  id: string;
  capacity: number;
  available: number;
  owned: number;
  platformLimit?: number;
};
export type HardwareSnapshot = {
  swapUsed?:number;
  serviceOwned?:number;
  memory?:SystemMemory & {pressureAvailablePercent:number;estimatedReclaimable:number};
  supported: boolean;
  topology: 'unified' | 'discrete' | 'cpu' | 'unknown';
  sampledAt: number;
  pressure: 'normal' | 'warning' | 'critical' | 'unknown';
  pools: ResourcePool[];
};
/** Kernel measurements; categories overlap and must not be summed as free memory. */
export type SystemMemory = {capacity:number;free:number;purgeable:number;inactive:number;fileBacked:number;compressed:number;wired:number;swapUsed:number;swapInBytes:number;swapOutBytes:number};
/** Startup reserves capacity; peak is the independent requested runtime protection ceiling.
 * Older callers without startup conservatively reserve the full ceiling. */
export type ResourceDemand = {verified: boolean; startup?:Record<string,number>; peak: Record<string, number>};
export type ResourcePolicy = {
  reserveFraction: number;
  reserveMinimum: number;
  headroom: number;
  maxSnapshotAgeMs: number;
  maxWaitMs: number;
  retryMs: number;
  maxQueue: number;
  limits?: Record<string, number>;
};
export type ResourceReason = 'INSUFFICIENT_CAPACITY' | 'WAITING_FOR_MEMORY' | 'UNSUPPORTED_BACKEND' |
  'RESOURCE_PROFILE_UNVERIFIED' | 'RESOURCE_TELEMETRY_UNAVAILABLE' | 'UNLOAD_FAILED' |
  'QUEUE_FULL' | 'CLOSED' | 'CANCELLED' | 'DUPLICATE_RESOURCE_TASK' | 'WAITING_FOR_WORKSPACE' | 'INSUFFICIENT_DISK' | 'DISK_TELEMETRY_UNAVAILABLE' | 'PEAK_EXCEEDED' | 'PRESSURE_PROTECTION';
export class ResourceError extends Error {
  code: ResourceReason;
  constructor(code: ResourceReason, message: string) {super(message); this.code = code;}
}
export type AdmissionDetail={pool:string;startup:number;runtimeLimit:number;applicationLimit:number;owned:number;resident:number;availableEstimate:number;headroom:number;startupBudget:number;shortfall:number;limiting:'capacity'|'user_limit'|'platform_limit'|'application_usage'|'system_memory'|'pressure'};
export type Admission = ({allowed: true; budgets: Record<string, number>} |
  {allowed: false; retry: boolean; code: ResourceReason; message: string}) & {details?:AdmissionDetail[]};
export type ResourceStage = 'queued' | 'waiting_resources' | 'loading' | 'running' | 'cancelling' |
  'succeeded' | 'failed' | 'cancelled' | 'blocked';
export type ResourceTaskState = {
  id: string; engine: string; stage: ResourceStage; submittedAt: number;
  reason?: ResourceReason; message?: string;diagnostic?:string;peak?:Record<string,number>;
  demand?:ResourceDemand;admission?:Admission;
};
export type ResidentModel = {engine: string; loaded:boolean; estimatedBytes?:Record<string, number>};
export type ResourceAdapter = {
  resident: () => Record<string, number> | undefined;
  /** Resolves only after actual resource release. Rejecting fences new work. */
  unload: () => Promise<void>;
};
export type ResourceExecution = {
  signal: AbortSignal;
  budgets: Record<string, number>;
  running: () => void;
  trackProcess: (pid: number) => void;
  lease?: {directory: string; owner: string};
};
export type ResourceRequest<T> = {
  id: string; engine: string; demand: ResourceDemand; signal?: AbortSignal;
  execute: (context: ResourceExecution) => Promise<T>;
  onState?: (state: ResourceTaskState) => void;
};

export function userCancelled(signal:AbortSignal){return signal.aborted&&(!(signal.reason instanceof ResourceError)||signal.reason.code==='CANCELLED');}
