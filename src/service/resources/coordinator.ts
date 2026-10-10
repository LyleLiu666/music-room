import {ResourceError, type ResourceAdapter, type ResourceRequest, type ResourcePolicy,
  type HardwareSnapshot, type ResourceTaskState, type ResourceStage} from './contracts.ts';
import {admit, validPolicy} from './policy.ts';
import type {ResourceLease} from './lease.ts';

type Entry = {
  request: ResourceRequest<unknown>; state: ResourceTaskState; controller: AbortController;
  resolve: (value: unknown) => void; reject: (error: unknown) => void;
  detach: () => void;
};
export type CoordinatorOptions = {
  probe: () => Promise<HardwareSnapshot>;
  policy: ResourcePolicy;
  now?: () => number;
  monitorMs?:number;
  observe?:(pids:number[],baseline:HardwareSnapshot)=>Promise<{usage:Record<string,number>;swapUsed?:number;pressure:HardwareSnapshot['pressure']}>;
  lease?: ResourceLease;
  estimate?: (engine: string, input: unknown) => import('./contracts.ts').ResourceDemand;
};
/** Transient execution rights; business services own durable inputs and results. */
export class ResourceCoordinator {
  private options: CoordinatorOptions;
  private queue: Entry[] = [];
  private active?: Entry;
  private adapters = new Map<string, ResourceAdapter>();
  private history: ResourceTaskState[] = [];
  private fault?: ResourceError;
  private closed = false;
  private closing?: Promise<void>;
  private pumping?: Promise<void>;
  private wake?: () => void;
  private lastHardware?:HardwareSnapshot;
  private observation?:{usage:Record<string,number>;swapUsed?:number;pressure:HardwareSnapshot['pressure']};
  private reservations: Record<string, number> = {};
  constructor(options: CoordinatorOptions) {
    if (!validPolicy(options.policy)) throw new Error('资源策略参数无效');
    this.options = {...options, policy: structuredClone(options.policy)};
  }
  private now() {return this.options.now?.() ?? Date.now();}
  estimate(engine: string, input: unknown) {
    return this.options.estimate?.(engine, input) ?? {verified: false, peak: {memory: 0}};
  }
  register(engine: string, adapter: ResourceAdapter) {
    if (this.closed || this.adapters.has(engine)) throw new Error('引擎重复注册或协调器已关闭');
    this.adapters.set(engine, adapter);
  }
  run<T>(request: ResourceRequest<T>): Promise<T> {
    if (this.closed) return Promise.reject(new ResourceError('CLOSED', '服务正在退出'));
    if (this.fault) return Promise.reject(this.fault);
    if (!this.adapters.has(request.engine)) return Promise.reject(new ResourceError('UNSUPPORTED_BACKEND', '引擎未接入资源管理'));
    if (this.queue.length + (this.active ? 1 : 0) >= this.options.policy.maxQueue)
      return Promise.reject(new ResourceError('QUEUE_FULL', '任务队列已满，请等待或取消任务'));
    if (this.queue.some(e => e.state.id === request.id) || this.active?.state.id === request.id)
      return Promise.reject(new ResourceError('DUPLICATE_RESOURCE_TASK', '任务已在排队或执行'));
    if (request.signal?.aborted) return Promise.reject(new ResourceError('CANCELLED', '任务已取消'));
    return new Promise<T>((resolve, reject) => {
      const controller = new AbortController();
      const entry: Entry = {request: {...request, demand: structuredClone(request.demand)} as ResourceRequest<unknown>,
        state: {id: request.id, engine: request.engine, stage: 'queued', submittedAt: this.now()}, controller,
        resolve: value => resolve(value as T), reject, detach: () => request.signal?.removeEventListener('abort', abort)};
      const abort = () => {
        const error = new ResourceError('CANCELLED', '任务已取消'); controller.abort(error);
        const index = this.queue.indexOf(entry);
        if (index >= 0) {
          this.queue.splice(index, 1);
          try {this.emit(entry, 'cancelled', error);} catch {/* Cancellation still settles if persistence fails. */}
          entry.detach(); this.remember(entry); entry.reject(error);
        } else if (this.active === entry) {
          try {this.emit(entry, 'cancelling', error);} catch {/* Cleanup owns the execution right until it returns. */}
        }
        this.wake?.();
      };
      request.signal?.addEventListener('abort', abort, {once: true});
      try {this.emit(entry, 'queued');} catch (error) {entry.detach(); reject(error); return;}
      this.queue.push(entry);
      queueMicrotask(() => this.pump());
    });
  }
  snapshot() {
    return {active: this.active ? structuredClone(this.active.state) : undefined,
      queued: this.queue.map(e => structuredClone(e.state)), history: structuredClone(this.history),
      hardware:this.lastHardware?structuredClone(this.lastHardware):undefined,observation:this.observation?structuredClone(this.observation):undefined,
      reservations: {...this.reservations}, residents: [...this.adapters].flatMap(([engine, a]) => {
        const bytes = a.resident(); return bytes ? [{engine, bytes: {...bytes}}] : [];
      }), fault: this.fault ? {code: this.fault.code, message: this.fault.message} : undefined};
  }
  private emit(entry: Entry, stage: ResourceStage, error?: ResourceError) {
    entry.state = {...entry.state, stage, reason: error?.code, message: error?.message};
    entry.request.onState?.(structuredClone(entry.state));
  }
  private remember(entry: Entry) {this.history.push({...entry.state}); this.history = this.history.slice(-100);}
  private async unload(engine: string, adapter: ResourceAdapter) {
    try {await adapter.unload(); if (adapter.resident()) throw new Error(`${engine} 仍然驻留`);}
    catch (error) {
      this.fault = new ResourceError('UNLOAD_FAILED', `释放 ${engine} 失败：${error instanceof Error ? error.message : String(error)}`);
      throw this.fault;
    }
  }
  private wait(ms: number) {
    return new Promise<void>(resolve => {
      const timer = setTimeout(finish, ms);
      const coordinator = this;
      function finish() {clearTimeout(timer); if (coordinator.wake === finish) coordinator.wake = undefined; resolve();}
      this.wake = finish;
    });
  }
  private pump() {
    if (this.pumping) return;
    this.pumping = this.drain().finally(() => {this.pumping = undefined; if (this.queue.length) this.pump();});
    // Every entry has its own rejection. Never leak a background rejection.
    void this.pumping.catch(() => {});
  }
  private monitor(entry:Entry,pids:number[],baseline:HardwareSnapshot){
    let stopped=false,timer:ReturnType<typeof setTimeout>|undefined,pending=Promise.resolve();
    const tick=()=>{pending=(async()=>{if(!this.options.observe||stopped)return;try{const result=await this.options.observe([...pids],baseline);if(stopped)return;this.observation=result;for(const pool of Object.keys(this.reservations))if(!Number.isFinite(result.usage[pool]))throw new Error('缺少占用指标');
      for(const [pool,bytes] of Object.entries(result.usage)){if(!Number.isFinite(bytes)||bytes<0)throw new Error('占用指标无效');entry.state.peak??={};entry.state.peak[pool]=Math.max(entry.state.peak[pool]??0,bytes);if(bytes>(this.reservations[pool]??0))throw new ResourceError('PEAK_EXCEEDED','任务实际占用超过内存预算，已停止');}
      if(baseline.swapUsed!==undefined){if(!Number.isFinite(result.swapUsed))throw new Error('缺少交换空间指标');if(result.swapUsed!-baseline.swapUsed>=512*2**20)throw new ResourceError('PRESSURE_PROTECTION','系统交换空间增长超过安全阈值，已停止任务');}
      if(result.pressure==='critical')throw new ResourceError('PRESSURE_PROTECTION','系统内存压力过高，已停止任务');if(result.pressure==='unknown')throw new Error('压力指标无效');
    }catch(error){if(!stopped&&!entry.controller.signal.aborted)entry.controller.abort(error instanceof ResourceError?error:new ResourceError('RESOURCE_TELEMETRY_UNAVAILABLE','运行期间无法确认内存占用，已停止任务'));}
    finally{if(!stopped)timer=setTimeout(tick,this.options.monitorMs??1000);}})();};
    if(this.options.observe)tick();return async()=>{stopped=true;if(timer)clearTimeout(timer);await pending;};
  }
  private async drain() {
    while (this.queue.length) {
      const entry = this.queue.shift()!; this.active = entry;
      const adapter = this.adapters.get(entry.request.engine)!;
      let executed = false;
      let leased = false;let stopMonitor:()=>Promise<void>=async()=>{};let admittedHardware!:HardwareSnapshot;const pids:number[]=[];
      try {
        if (this.fault) throw this.fault;
        entry.controller.signal.throwIfAborted();
        const waitStarted = this.now();
        for (;;) {
          entry.controller.signal.throwIfAborted();
          if (this.options.lease && !leased) {
            leased = this.options.lease.acquire();
            if (!leased) {
              const error = new ResourceError('WAITING_FOR_WORKSPACE', '另一个工作区正在使用模型资源');
              if (this.now() - waitStarted >= this.options.policy.maxWaitMs) throw error;
              this.emit(entry, 'waiting_resources', error); await this.wait(this.options.policy.retryMs); continue;
            }
          }
          for (const [engine, other] of this.adapters) {
            if (engine !== entry.request.engine && other.resident()) await this.unload(engine, other);
          }
          let hardware: HardwareSnapshot;
          try {hardware = await this.options.probe();}
          catch {throw new ResourceError('RESOURCE_TELEMETRY_UNAVAILABLE', '无法读取电脑资源，请稍后重试');}
          this.lastHardware=hardware;admittedHardware=hardware;entry.controller.signal.throwIfAborted();
          const decision = admit(hardware, entry.request.demand, this.options.policy, this.now(), adapter.resident());
          if (decision.allowed) {this.reservations = decision.budgets; break;}
          const error = new ResourceError(decision.code, decision.message);
          if (!decision.retry || this.now() - waitStarted >= this.options.policy.maxWaitMs) throw error;
          this.emit(entry, 'waiting_resources', error);
          if (adapter.resident()) await this.unload(entry.request.engine, adapter);
          if (leased) {this.options.lease!.release(); leased = false;}
          await this.wait(this.options.policy.retryMs);
        }
        entry.controller.signal.throwIfAborted();
        this.emit(entry, 'loading');
        entry.controller.signal.throwIfAborted();
        executed = true;this.observation=undefined;stopMonitor=this.monitor(entry,pids,admittedHardware);
        const value = await entry.request.execute({signal: entry.controller.signal, budgets: {...this.reservations},
          running: () => {entry.controller.signal.throwIfAborted(); this.emit(entry, 'running');},
          trackProcess: pid => {this.options.lease?.track(pid);if(!pids.includes(pid))pids.push(pid);},
          lease: leased ? this.options.lease!.capability() : undefined});
        entry.controller.signal.throwIfAborted();
        // First release policy is conservative: a user-wide lease always reaps after each task.
        if (leased) {await this.unload(entry.request.engine, adapter); this.options.lease!.release(); leased = false;}
        await stopMonitor();entry.controller.signal.throwIfAborted();this.emit(entry, 'succeeded'); entry.resolve(value);
      } catch (error) {
        await stopMonitor();if(entry.controller.signal.aborted&&entry.controller.signal.reason instanceof ResourceError)error=entry.controller.signal.reason;
        // A failed/cancelled load may have left a resident. Reap before settling or advancing.
        try {if (executed || adapter.resident()) await this.unload(entry.request.engine, adapter);}
        catch (cleanup) {
          this.fault ??= new ResourceError('UNLOAD_FAILED', `无法确认模型释放：${String(cleanup)}`);
          error = this.fault;
        }
        if (leased && !this.fault) {
          try {this.options.lease!.release(); leased = false;}
          catch (cleanup) {this.fault = new ResourceError('UNLOAD_FAILED', `所属进程未释放：${String(cleanup)}`); error = this.fault;}
        }
        const cause = error instanceof ResourceError ? error : undefined;
        const stage = this.fault ? 'failed' : entry.controller.signal.aborted&&cause?.code==='CANCELLED' ? 'cancelled' : cause ? 'blocked' : 'failed';
        try {this.emit(entry, stage, cause);} catch {/* Persistence failure must not prevent cleanup. */}
        entry.reject(error);
      } finally {
        this.reservations = {}; entry.detach(); this.remember(entry); this.active = undefined;
      }
    }
  }
  async releaseIdle() {
    if (this.active || this.queue.length) throw new Error('任务正在排队或运行，请先取消');
    // Serialize against run() while unload awaits; no new execution during release.
    if (this.pumping) await this.pumping;
    if (this.active || this.queue.length || this.closed) throw new Error('服务状态已改变，请稍后释放');
    const release = (async () => {for (const [engine, a] of this.adapters) if (a.resident()) await this.unload(engine, a);})();
    this.pumping = release;
    try {await release;} finally {if (this.pumping === release) this.pumping = undefined; if (this.queue.length) this.pump();}
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    this.closing = (async () => {
      for (const entry of [...this.queue, ...(this.active ? [this.active] : [])])
        entry.controller.abort(new ResourceError('CANCELLED', '服务退出，任务中断'));
      this.wake?.(); this.pump(); await this.pumping;
      let failure: unknown;
      for (const [engine, a] of this.adapters) {
        try {if (a.resident()) await this.unload(engine, a);} catch (error) {failure ??= error;}
      }
      if (failure) throw failure;
    })();
    return this.closing;
  }
}
