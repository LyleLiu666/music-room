import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateFocused, evaluatePassage, loadFixtures, modelParameters } from './cloudflare-lyrics-review.ts';

test('focused correction requires the exact source text, including half-line boundaries', () => {
  assert.equal(evaluateFocused('我喊慢一点', '我喊慢一点').passed, true);
  assert.equal(evaluateFocused('我喊慢一点 慢一点', '我喊慢一点').passed, false);
  assert.equal(evaluateFocused('野野餐餐垫垫鼓鼓起起一面一面帆帆', '野餐垫鼓起一面帆').passed, false);
  assert.equal(evaluateFocused('你追着帽子跑一圈', '<unmatched>').passed, false);
});

test('passage evaluation accepts equivalent repeated source lines and split ASR fragments', () => {
  const reference = [{ line: 3, text: '我喊慢一点 慢一点' }, { line: 47, text: '我喊慢一点 慢一点' }];
  const fixture = { heard: ['我喊慢一点', '慢一点'], checks: [{ ids: [0, 1], text: '我喊慢一点 慢一点' }] };
  const content = JSON.stringify({ groups: [{ ids: [0, 1], status: 'matched', matches: [{ line: 47 }] }] });
  assert.equal(evaluatePassage(content, fixture, reference).passed, true);
});

test('passage evaluation rejects missed fragments, invented text, and wrong source matches', () => {
  const reference = [{ line: 13, text: '野餐垫鼓起一面帆' }, { line: 14, text: '你追着帽子跑一圈' }];
  const fixture = { heard: ['夜三点的起面粉'], checks: [{ ids: [0], text: reference[0].text }] };
  const group: { ids: number[]; status: string; matches: { line: number; text?: string }[] } = { ids: [0], status: 'matched', matches: [{ line: 14 }] };
  assert.equal(evaluatePassage(JSON.stringify({ groups: [group] }), fixture, reference).passed, false);
  assert.equal(evaluatePassage('{"groups":[]}', fixture, reference).passed, false);
  group.matches = [{ line: 13, text: '野餐垫升起一面帆' }];
  assert.equal(evaluatePassage(JSON.stringify({ groups: [group] }), fixture, reference).passed, false);
  assert.equal(evaluatePassage('not JSON', fixture, reference).passed, false);
});

test('fixtures retain seven real chunks and the unrelated-line negative control', () => {
  const fixtures = loadFixtures();
  assert.equal(fixtures.passages.length, 7);
  assert.equal(fixtures.focused.length, 6);
  assert.equal(fixtures.focused.at(-1)?.expected, '<unmatched>');
  assert.equal(fixtures.passages[2].checks.some(check => check.ids.includes(5)), false);
});

test('a whole-passage negative control must remain unmatched', () => {
  const fixture = { heard: ['我现在想回家去睡觉'], checks: [{ ids: [0], text: '' }] };
  const reference = [{ line: 13, text: '野餐垫鼓起一面帆' }];
  const output = (status: string, matches: { line: number }[]) => JSON.stringify({ groups: [{ ids: [0], status, matches }] });
  assert.equal(evaluatePassage(output('uncertain', []), fixture, reference).passed, true);
  assert.equal(evaluatePassage(output('matched', [{ line: 13 }]), fixture, reference).passed, false);
});

test('NVIDIA reasoning uses template options, while GPT-OSS uses reasoning_effort', () => {
  const nvidia = modelParameters('@cf/nvidia/nemotron-3-120b-a12b', 2048);
  assert.deepEqual(nvidia.chat_template_kwargs, { enable_thinking: true, low_effort: true });
  assert.equal(nvidia.reasoning_effort, undefined);
  const gpt = modelParameters('@cf/openai/gpt-oss-120b', 2048);
  assert.equal(gpt.reasoning_effort, 'low');
  assert.equal(gpt.max_completion_tokens, 2048);
});

test('a legal multi-line group is scored as a whole instead of treated as a wrong mapping', () => {
  const reference = [{ line: 40, text: '夜里帐篷亮起小灯' }, { line: 41, text: '湿鞋并排靠在门边' }];
  const fixture = { heard: reference.map(row => row.text), checks: reference.map((row, id) => ({ ids: [id], text: row.text })) };
  const content = JSON.stringify({ groups: [{ ids: [0, 1], status: 'matched', matches: [{ line: 40 }, { line: 41 }] }] });
  assert.equal(evaluatePassage(content, fixture, reference).passed, true);
  const negative = { ...fixture, checks: [{ ids: [0], text: reference[0].text }, { ids: [1], text: '' }] };
  assert.equal(evaluatePassage(content, negative, reference).passed, false);
});

test('two-turn CLI defaults to a dry run without requiring credentials or performing inference', () => {
  const directory = mkdtempSync(join(tmpdir(), 'lyrics-review-cli-'));
  try {
    const baseline = join(directory, 'report.json');
    writeFileSync(baseline, JSON.stringify({ trials: [{ model: '@cf/qwen/qwen3.8-27b', id: 'focused-0', body: { messages: [] }, envelope: { result: { response: 'stub' } } }] }));
    const output = execFileSync(process.execPath, [fileURLToPath(new URL('./cloudflare-lyrics-review-agent.ts', import.meta.url)), baseline], {
      encoding: 'utf8', env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: '', CLOUDFLARE_API_TOKEN: '' },
    });
    assert.equal(JSON.parse(output).inferencePerformed, false);
  } finally { rmSync(directory, { recursive: true }); }
});
