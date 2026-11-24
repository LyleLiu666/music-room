import type {ResourceDemand} from './contracts.ts';
import {yueMemoryMinimum} from '../yue2/resource-budget.ts';

function demand(startup: number, peak = startup) {
  return {verified: true, startup: {memory: startup}, peak: {memory: peak}} satisfies ResourceDemand;
}

/** Fixed reservations for the supported model profiles. Profiles still validate inputs before admission. */
export const modelMemory = {
  lyrics: demand(4 * 2 ** 30, 8 * 2 ** 30),
  aceCover: demand(4_000_000_000,5_000_000_000),
  soundEffects: demand(5_000_000_000),
  breeze: demand(5_000_000_000),
  indexTts: demand(6 * 2 ** 30),
  yue: demand(yueMemoryMinimum),
  reference: demand(8 * 2 ** 30),
  conversion: demand(10 * 2 ** 30),
};
