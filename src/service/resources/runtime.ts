import {probeHardware,observeProcesses} from './telemetry.ts';
import {estimateResources} from './profiles.ts';
import {ResourceCoordinator} from './coordinator.ts';
import {ResourceLease} from './lease.ts';
/** Current OS pressure and owned task footprint; never selected by a guessed memory tier. */
export function createResources() {
  return new ResourceCoordinator({lease: new ResourceLease(),
    policy: {reserveFraction: .3, reserveMinimum: 2 * 2 ** 30, headroom: 2 ** 30,
      maxSnapshotAgeMs: 3000, maxWaitMs: 60_000, retryMs: 1000, maxQueue: 64},
    probe:probeHardware,observe:process.platform==='darwin'&&process.arch==='arm64'?observeProcesses:undefined,estimate:estimateResources});
}
