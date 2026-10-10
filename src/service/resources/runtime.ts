import {totalmem} from 'node:os';
import {ResourceCoordinator} from './coordinator.ts';
import {ResourceLease} from './lease.ts';
/** Platform telemetry and measured profiles are added in round six; unknown data never grants a load. */
export function createResources() {
  return new ResourceCoordinator({lease: new ResourceLease(),
    policy: {reserveFraction: .3, reserveMinimum: 2 * 2 ** 30, headroom: 2 ** 30,
      maxSnapshotAgeMs: 3000, maxWaitMs: 60_000, retryMs: 1000, maxQueue: 64},
    probe: async () => ({supported: process.platform === 'darwin' && process.arch === 'arm64',
      topology: process.platform === 'darwin' && process.arch === 'arm64' ? 'unified' : 'unknown',
      sampledAt: Date.now(), pressure: 'unknown', pools: [{id: 'memory', capacity: totalmem(), available: 0, owned: 0}]})});
}
