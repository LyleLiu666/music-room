import test from 'node:test';
import assert from 'node:assert/strict';
import {ResourceCoordinator} from './coordinator.ts';
import type {ResourceDemand, ResourceRequest} from './contracts.ts';
const GiB = 2 ** 30;
const demand: ResourceDemand = {verified: true, peak: {memory: GiB}};
const policy = {reserveFraction: .25, reserveMinimum: GiB, headroom: GiB,
  maxSnapshotAgeMs: 1000, maxWaitMs: 100, retryMs: 1, maxQueue: 8};
function gate() {let release!: () => void; const promise = new Promise<void>(r => release = r); return {promise, release};}
function fixture() {
  let now = 1000, available = 12 * GiB, probes = 0;
  const residents = new Map<string, Record<string, number>>(), unloads: string[] = [];
  const c = new ResourceCoordinator({policy, now: () => now, probe: async () => {
    probes++; return {supported: true, topology: 'unified', sampledAt: now, pressure: 'normal',
      pools: [{id: 'memory', capacity: 16 * GiB, available, owned: GiB + [...residents.values()].reduce((n, r) => n + r.memory, 0)}]};
  }});
  for (const engine of ['tts', 'svc', 'yue']) c.register(engine, {resident: () => residents.get(engine),
    unload: async () => {unloads.push(engine); residents.delete(engine);}});
  const request = (id: string, engine = 'tts', execute: ResourceRequest<void>['execute'] = async ctx => {ctx.running();}): ResourceRequest<void> =>
    ({id, engine, demand, execute});
  return {c, request, residents, unloads, probes: () => probes, busy: () => {available = 0;}, tick: (ms = 100) => {now += ms;}};
}
test('three engines serialize, unload before switching and preserve resident accounting', async () => {
  const f = fixture(), hold = gate(), entered = gate(); let active = 0, peak = 0; const order: string[] = [];
  const run = (id: string, engine: string) => f.c.run(f.request(id, engine, async ctx => {
    active++; peak = Math.max(peak, active); ctx.running(); order.push(engine);
    if (engine === 'tts') {f.residents.set(engine, {memory: GiB}); entered.release(); await hold.promise;}
    else assert.equal(f.residents.has('tts'), false);
    active--;
  }));
  const first = run('a', 'tts'); await entered.promise;
  const second = run('b', 'svc'), third = run('c', 'yue');
  assert.equal(f.c.snapshot().queued.length, 2); hold.release(); await Promise.all([first, second, third]);
  assert.equal(peak, 1); assert.deepEqual(order, ['tts', 'svc', 'yue']); assert.deepEqual(f.unloads, ['tts']);
  assert.deepEqual(f.c.snapshot().reservations, {}); await f.c.close();
});
test('queued cancellation settles without waiting for an unrelated running task', async () => {
  const f = fixture(), entered = gate(), hold = gate(), controller = new AbortController(); let starts = 0;
  const first = f.c.run(f.request('a', 'tts', async () => {entered.release(); await hold.promise;}));
  await entered.promise;
  const second = f.c.run({...f.request('b', 'svc', async () => {starts++;}), signal: controller.signal});
  let cancelled = false; const rejection = assert.rejects(second, {code: 'CANCELLED'}).then(() => {cancelled = true;});
  controller.abort(); await new Promise<void>(r => setImmediate(r));
  try {assert.equal(cancelled, true); assert.equal(starts, 0);} finally {hold.release(); await first; await rejection; await f.c.close();}
});
test('cancellation during a probe must not enter the adapter', async () => {
  const hold = gate(), entered = gate(); let starts = 0;
  const c = new ResourceCoordinator({policy, probe: async () => {entered.release(); await hold.promise;
    return {supported: true, topology: 'cpu', sampledAt: Date.now(), pressure: 'normal',
      pools: [{id: 'memory', capacity: 16 * GiB, available: 12 * GiB, owned: GiB}]};}});
  c.register('tts', {resident: () => undefined, unload: async () => {}});
  const controller = new AbortController(), task = c.run({id: 'a', engine: 'tts', demand,
    signal: controller.signal, execute: async () => {starts++;}}), rejection = assert.rejects(task);
  await entered.promise; controller.abort(); hold.release(); await rejection; assert.equal(starts, 0); await c.close();
});
test('cancelled execution waits for cleanup and unload failure fences subsequent tasks', async () => {
  const f = fixture(); let resident = false, starts = 0; const entered = gate(), cleanup = gate();
  f.c.register('broken', {resident: () => resident ? {memory: GiB} : undefined,
    unload: async () => {await cleanup.promise; throw Error('cannot stop');}});
  const controller = new AbortController();
  const first = f.c.run({id: 'a', engine: 'broken', demand, signal: controller.signal,
    execute: async ctx => {resident = true; entered.release(); await new Promise((_, reject) => ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason), {once: true}));}});
  const failure = assert.rejects(first, {code: 'UNLOAD_FAILED'}); await entered.promise;
  const second = f.c.run(f.request('b', 'svc', async () => {starts++;})), blocked = assert.rejects(second, {code: 'UNLOAD_FAILED'});
  controller.abort(); await new Promise<void>(r => setImmediate(r)); assert.equal(starts, 0);
  cleanup.release(); await Promise.all([failure, blocked]); assert.equal(starts, 0);
  assert.equal(f.c.snapshot().fault?.code, 'UNLOAD_FAILED'); await assert.rejects(f.c.close());
});
test('permanent capacity failure advances the queue without executing; unknown profile does too', async () => {
  const f = fixture(); let starts = 0;
  const bad = f.c.run({...f.request('a'), demand: {verified: true, peak: {memory: 64 * GiB}}, execute: async () => {starts++;}});
  const unverified = f.c.run({...f.request('b'), demand: {verified: false, peak: {memory: GiB}}});
  const good = f.c.run(f.request('c'));
  await Promise.all([assert.rejects(bad, {code: 'INSUFFICIENT_CAPACITY'}), assert.rejects(unverified, {code: 'RESOURCE_PROFILE_UNVERIFIED'}), good]);
  assert.equal(starts, 0); assert.equal(f.c.snapshot().history.at(-1)?.stage, 'succeeded'); await f.c.close();
});
test('temporary lack of memory times out and never decodes input while queued', async () => {
  const f = fixture(); f.busy(); let reads = 0;
  const task = f.c.run({...f.request('a', 'tts', async () => {reads++;}), onState: s => {if (s.stage === 'waiting_resources') f.tick();}});
  await assert.rejects(task, {code: 'WAITING_FOR_MEMORY'}); assert.equal(reads, 0); assert.ok(f.probes() >= 2); await f.c.close();
});
test('bounded queue, active ID conflicts and close reject work without orphan execution', async () => {
  const f = fixture(), hold = gate(), entered = gate();
  const first = f.c.run(f.request('a', 'tts', async () => {entered.release(); await hold.promise;})); await entered.promise;
  await assert.rejects(f.c.run(f.request('a')), {code: 'DUPLICATE_RESOURCE_TASK'});
  const rest = Array.from({length: 7}, (_, n) => f.c.run(f.request('b' + n)));
  const rejections = rest.map(p => assert.rejects(p));
  await assert.rejects(f.c.run(f.request('full')), {code: 'QUEUE_FULL'});
  const firstRejected = assert.rejects(first); const closing = f.c.close(); hold.release();
  await Promise.all([closing, firstRejected, ...rejections]); await assert.rejects(f.c.run(f.request('closed')), {code: 'CLOSED'});
  assert.deepEqual(f.c.snapshot().reservations, {});
});
test('persistence observer failure must clean up, reject and allow the next task', async () => {
  const f = fixture(); let unloaded = false;
  f.c.register('persist', {resident: () => unloaded ? undefined : {memory: GiB}, unload: async () => {unloaded = true;}});
  await assert.rejects(f.c.run({id: 'a', engine: 'persist', demand,
    execute: async () => {}, onState: s => {if (s.stage === 'succeeded') throw Error('disk full');}}), /disk full/);
  assert.equal(unloaded, true); await f.c.run(f.request('b')); await f.c.close();
});
test('idle release is serialized with newly submitted execution', async () => {
  const f = fixture(), cleanup = gate(), entered = gate(); let resident = true, starts = 0;
  f.c.register('idle', {resident: () => resident ? {memory: GiB} : undefined,
    unload: async () => {entered.release(); await cleanup.promise; resident = false;}});
  const release = f.c.releaseIdle(); await entered.promise;
  const run = f.c.run(f.request('b', 'tts', async () => {assert.equal(resident, false); starts++;}));
  await new Promise<void>(r => setImmediate(r)); assert.equal(starts, 0);
  cleanup.release(); await Promise.all([release, run]); assert.equal(starts, 1); await f.c.close();
});
test('repeated close calls both await final resident cleanup', async () => {
  const f = fixture(), cleanup = gate(), entered = gate(); let resident = true;
  f.c.register('idle', {resident: () => resident ? {memory: GiB} : undefined,
    unload: async () => {entered.release(); await cleanup.promise; resident = false;}});
  const first = f.c.close(); await entered.promise; let secondFinished = false;
  const second = f.c.close().then(() => {secondFinished = true;});
  await new Promise<void>(r => setImmediate(r));
  try {assert.equal(secondFinished, false);} finally {cleanup.release(); await Promise.all([first, second]);}
});

test('runtime observation stops over-budget work and holds rights until cleanup',async()=>{
 const events:string[]=[];let sampled=0;
 const resources=new ResourceCoordinator({policy:{reserveFraction:.1,reserveMinimum:0,headroom:0,maxSnapshotAgeMs:1000,maxWaitMs:100,retryMs:1,maxQueue:10},probe:async()=>({supported:true,topology:'cpu',sampledAt:Date.now(),pressure:'normal',pools:[{id:'memory',capacity:1000,available:1000,owned:0}]}),observe:async()=>{sampled++;return {usage:{memory:101},pressure:'normal'};},monitorMs:1});
 resources.register('x',{resident:()=>undefined,unload:async()=>{events.push('unloaded');}});
 await assert.rejects(resources.run({id:'x',engine:'x',demand:{verified:true,peak:{memory:100}},execute:async ctx=>{ctx.running();await new Promise<void>(r=>ctx.signal.addEventListener('abort',()=>r(),{once:true}));ctx.signal.throwIfAborted();}}),/预算/);
 assert.ok(sampled>0);assert.deepEqual(events,['unloaded']);assert.equal(resources.snapshot().history.at(-1)?.reason,'PEAK_EXCEEDED');await resources.close();
});
