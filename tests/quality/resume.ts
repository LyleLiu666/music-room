import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

type Request = {key: string; caseId: string; input: unknown; run?: number; seed?: number; rate?: number};
type Trial = Request & {status: string; audio?: string; sha256?: string; log?: string; logSha256?: string};
type Context = {models: unknown; corpusSources?: Record<string, string>};
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

/** Refuse stale evidence before a resumed run can overwrite its provenance. */
export function validateResumeContext(previous: Context, current: Context) {
  assert.deepEqual(previous.models, current.models, 'models changed; use a new MUSIC_ROOM_QUALITY_RUN directory');
  // Older executions predate this field; their prepared corpus is still verified by the caller.
  if (previous.corpusSources) {
    assert.deepEqual(previous.corpusSources, current.corpusSources, 'corpus changed; use a new MUSIC_ROOM_QUALITY_RUN directory');
  }
}

/** A success flag alone is insufficient: the exact request and saved evidence must still exist. */
export async function validateCompletedTrial(trial: Trial | undefined, expected: Request, read: (path: string) => Promise<Uint8Array>) {
  if (trial?.status !== 'succeeded') return false;
  const request = (value: Request) => ({key: value.key, caseId: value.caseId, input: value.input, run: value.run, seed: value.seed, rate: value.rate});
  assert.deepEqual(request(trial), request(expected), `${expected.key}: request changed; use a new execution directory`);
  assert.ok(trial.audio && /^[a-f0-9]{64}$/.test(trial.sha256 ?? ''), `${expected.key}: missing audio identity`);
  const audio = await read(trial.audio);
  assert.ok(audio.length > 0 && sha256(audio) === trial.sha256, `${expected.key}: saved audio changed`);
  assert.ok(trial.log, `${expected.key}: missing inference log`);
  const log = await read(trial.log);
  assert.ok(log.length > 0, `${expected.key}: empty inference log`);
  if (trial.logSha256 !== undefined) assert.equal(sha256(log), trial.logSha256, `${expected.key}: saved inference log changed`);
  return true;
}
