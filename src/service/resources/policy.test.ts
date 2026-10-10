import test from 'node:test';
import assert from 'node:assert/strict';
import {admit} from './policy.ts';
import type {HardwareSnapshot, ResourcePolicy} from './contracts.ts';
const GiB = 2 ** 30;
export const policy: ResourcePolicy = {reserveFraction: .25, reserveMinimum: 2 * GiB,
  headroom: GiB, maxSnapshotAgeMs: 1000, maxWaitMs: 100, retryMs: 10, maxQueue: 8};
export const hardware = (capacity = 16, available = 12): HardwareSnapshot => ({supported: true,
  topology: 'unified', sampledAt: 1000, pressure: 'normal',
  pools: [{id: 'memory', capacity: capacity * GiB, available: available * GiB, owned: GiB}]});
const demand = (memory: number) => ({verified: true, peak: {memory: memory * GiB}});
test('actual capacities control admission; one fixed 32 GiB assumption cannot pass', () => {
  for (const capacity of [8, 16, 24, 32, 64]) {
    const result = admit(hardware(capacity, capacity - 2), demand(8), policy, 1000);
    assert.equal(result.allowed, capacity >= 16);
    if (!result.allowed) assert.equal(result.code, 'INSUFFICIENT_CAPACITY');
  }
});
test('same physical capacity behaves differently under current load', () => {
  assert.equal(admit(hardware(32, 20), demand(8), policy, 1000).allowed, true);
  const busy = admit(hardware(32, 5), demand(8), policy, 1000);
  assert.equal(busy.allowed, false);
  if (!busy.allowed) {assert.equal(busy.code, 'WAITING_FOR_MEMORY'); assert.equal(busy.retry, true);}
});
test('discrete host memory and GPU memory each must fit, never sum their capacity', () => {
  const snapshot = hardware(32, 20); snapshot.topology = 'discrete';
  snapshot.pools.push({id: 'gpu:0', capacity: 4 * GiB, available: 4 * GiB, owned: 0});
  const result = admit(snapshot, {verified: true, peak: {memory: 3 * GiB, 'gpu:0': 6 * GiB}}, policy, 1000);
  assert.equal(result.allowed, false);
  if (!result.allowed) assert.equal(result.code, 'INSUFFICIENT_CAPACITY');
  snapshot.pools[1].capacity = 16 * GiB; snapshot.pools[1].available = 12 * GiB;
  snapshot.pools[0].available = 2 * GiB;
  assert.equal(admit(snapshot, {verified: true, peak: {memory: 3 * GiB, 'gpu:0': 6 * GiB}}, policy, 1000).allowed, false);
});
test('unknown, stale, unsupported or unverified data cannot load a model', () => {
  assert.equal(admit(hardware(), {verified: false, peak: {memory: GiB}}, policy, 1000).allowed, false);
  for (const patch of [{supported: false}, {topology: 'unknown' as const},
    {pressure: 'unknown' as const}, {pressure: 'critical' as const}, {sampledAt: -1}, {sampledAt: 2000}]) {
    assert.equal(admit({...hardware(), ...patch}, demand(1), policy, 1000).allowed, false);
  }
  assert.equal(admit(hardware(), demand(1), policy, 3000).allowed, false);
});
test('resident bytes are subtracted from additional need without double charging ownership', () => {
  const h = hardware(16, 4); h.pools[0].owned = 6 * GiB;
  const result = admit(h, demand(8), policy, 1000, {memory: 5 * GiB});
  assert.equal(result.allowed, true);
  if (result.allowed) assert.equal(result.budgets.memory, 8 * GiB);
});
test('tightened user limits, platform limits, invalid values and missing pools fail closed', () => {
  assert.equal(admit(hardware(), demand(8), {...policy, limits: {memory: 6 * GiB}}, 1000).allowed, false);
  const h = hardware(); h.pools[0].platformLimit = 6 * GiB;
  assert.equal(admit(h, demand(8), policy, 1000).allowed, false);
  for (const value of [NaN, Infinity, -1]) {
    const h = hardware(); h.pools[0].available = value;
    assert.equal(admit(h, demand(1), policy, 1000).allowed, false);
    assert.equal(admit(hardware(), {verified: true, peak: {memory: value}}, policy, 1000).allowed, false);
  }
  assert.equal(admit(hardware(), {verified: true, peak: {'gpu:0': GiB}}, policy, 1000).allowed, false);
});
