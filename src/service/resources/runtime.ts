import {probeHardware,observeProcesses} from './telemetry.ts';
import {estimateResources} from './profiles.ts';
import {ResourceCoordinator} from './coordinator.ts';
import {ResourceLease} from './lease.ts';
import {nativeFootprint} from './native-telemetry.ts';
import type {AssetReader} from '../render/renderer.ts';
/** Current OS pressure and owned task footprint; never selected by a guessed memory tier. */
export function createResources(read?:AssetReader) {
  const native=process.platform==='darwin'&&process.arch==='arm64'?nativeFootprint(read):undefined;
  return new ResourceCoordinator({lease: new ResourceLease(),
    policy: {reserveFraction: .3, reserveMinimum: 2 * 2 ** 30, headroom: 2 ** 30,
      maxSnapshotAgeMs: 3000, maxWaitMs: 60_000, retryMs: 1000, maxQueue: 64},
    probe:()=>probeHardware(native?.measure),observe:native?(pids,baseline)=>observeProcesses(pids,baseline,native.measure):undefined,estimate:estimateResources,dispose:native?.close});
}
