/** Bytes throughout. A unified CPU/GPU device has one pool, not two copies. */
export type ResourcePool = {
  id: string;
  capacity: number;
  available: number;
  owned: number;
  platformLimit?: number;
};
export type HardwareSnapshot = {
  supported: boolean;
  topology: 'unified' | 'discrete' | 'cpu' | 'unknown';
  sampledAt: number;
  pressure: 'normal' | 'warning' | 'critical' | 'unknown';
  pools: ResourcePool[];
};
export type ResourceDemand = {verified: boolean; peak: Record<string, number>};
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
  'QUEUE_FULL' | 'CLOSED' | 'CANCELLED' | 'DUPLICATE_RESOURCE_TASK' | 'WAITING_FOR_WORKSPACE';
export class ResourceError extends Error {
  code: ResourceReason;
  constructor(code: ResourceReason, message: string) {super(message); this.code = code;}
}
export type Admission = {allowed: true; budgets: Record<string, number>} |
  {allowed: false; retry: boolean; code: ResourceReason; message: string};
export type ResourceStage = 'queued' | 'waiting_resources' | 'loading' | 'running' | 'cancelling' |
  'succeeded' | 'failed' | 'cancelled' | 'blocked';
export type ResourceTaskState = {
  id: string; engine: string; stage: ResourceStage; submittedAt: number;
  reason?: ResourceReason; message?: string;
};
export type ResidentModel = {engine: string; bytes: Record<string, number>};
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
