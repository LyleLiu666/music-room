import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateCompletedTrial, validateResumeContext} from './quality/resume.ts';

const audio = new TextEncoder().encode('saved audio');
const log = new TextEncoder().encode('real inference log');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const expected = {key: 'Q-TTS-01-1', caseId: 'Q-TTS-01', input: {text: '你好'}, run: 1, seed: 42};
const completed = () => ({...expected, status: 'succeeded', audio: 'audio.wav', sha256: sha(audio), log: 'inference.log', logSha256: sha(log)});
const read = async (path: string) => path === 'audio.wav' ? audio : log;

test('resuming validates saved audio and logs before reusing success', async () => {
  assert.equal(await validateCompletedTrial(completed(), expected, read), true);
  await assert.rejects(validateCompletedTrial(completed(), expected, async () => new Uint8Array([1])), /audio/);
  await assert.rejects(validateCompletedTrial(completed(), expected, async () => {throw Error('missing file');}), /missing file/);
  await assert.rejects(validateCompletedTrial(completed(), expected, async path => path === 'audio.wav' ? audio : new Uint8Array()), /log/);
  await assert.rejects(validateCompletedTrial({...completed(), logSha256: '0'.repeat(64)}, expected, read), /log/);
});

test('changed input, seed or rate cannot silently reuse an earlier successful output', async () => {
  for (const change of [{input: {text: 'changed'}}, {seed: 43}, {run: 2}, {rate: .5}, {caseId: 'another-case'}]) {
    await assert.rejects(validateCompletedTrial(completed(), {...expected, ...change}, read), /request/);
  }
});

test('failed and interrupted trials remain retryable without reading stale output', async () => {
  for (const status of ['failed', 'blocked', 'interrupted', 'running']) {
    assert.equal(await validateCompletedTrial({...completed(), status}, expected, async () => {throw Error('must not read');}), false);
  }
  assert.equal(await validateCompletedTrial(undefined, expected, read), false);
});

test('legacy successes require matching audio and a nonempty log without inventing a historical log hash', async () => {
  const legacy = {...completed(), logSha256: undefined};
  assert.equal(await validateCompletedTrial(legacy, expected, read), true);
  assert.equal(legacy.logSha256, undefined);
});

test('resuming rejects changed models or source fingerprints before changing the report', () => {
  const context = {models: {tts: {modelSha256: 'old'}}, corpusSources: {'voice.wav': 'old'}};
  const before = structuredClone(context);
  validateResumeContext(context, structuredClone(context));
  assert.throws(() => validateResumeContext(context, {...context, models: {tts: {modelSha256: 'new'}}}), /models/);
  assert.throws(() => validateResumeContext(context, {...context, corpusSources: {'voice.wav': 'new'}}), /corpus/);
  assert.deepEqual(context, before);
});

test('legacy reports can bind verified prepared sources while still enforcing their recorded models', () => {
  const previous = {models: {tts: {modelSha256: 'old'}}};
  validateResumeContext(previous, {...previous, corpusSources: {'voice.wav': 'verified'}});
  assert.throws(() => validateResumeContext(previous, {models: {}, corpusSources: {}}), /models/);
});
