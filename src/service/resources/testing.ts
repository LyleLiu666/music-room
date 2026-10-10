import {ResourceCoordinator} from './coordinator.ts';
/** Explicit test fixture, never selected from an environment variable or runtime fallback. */
export function testResources() {
  return new ResourceCoordinator({policy: {reserveFraction: .25, reserveMinimum: 2 ** 30,
    headroom: 2 ** 30, maxSnapshotAgeMs: 1000, maxWaitMs: 1000, retryMs: 5, maxQueue: 100},
    estimate: () => ({verified: true, peak: {memory: 2 ** 20}}),
    probe: async () => ({supported: true, topology: 'cpu', sampledAt: Date.now(), pressure: 'normal',
      pools: [{id: 'memory', capacity: 16 * 2 ** 30, available: 12 * 2 ** 30, owned: 2 ** 30}]})});
}
