import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, globSync} from 'node:fs';

const scripts = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).scripts as Record<string, string>;
// Historical entry points remain explicit; a new filename must never silently bypass the gate.
const excluded = new Map([
  ['verify-speech-ui.test.mjs', 'compatibility alias importing verify-studio-ui.test.mjs'],
  ['verify-yue2-ui.test.mjs', 'retired standalone YuE2 page; current flows covered by studio suites'],
  ['verify-service-boundaries.test.mjs', 'retired standalone score library; current score editor uses verify-score-context-ui.test.mjs'],
  ['verify-sound-first-model.test.mjs', 'historical public/prototypes/sound-first model; production service and studio tests cover current behavior'],
]);

function commands(name: string, seen = new Set<string>()) {
  assert.ok(scripts[name], `missing npm script ${name}`);
  if (seen.has(name)) return seen;
  seen.add(name);
  for (const match of scripts[name].matchAll(/\bnpm (?:run ([\w:-]+)|(test))\b/g)) commands(match[1] ?? match[2], seen);
  return seen;
}
const dailyCommands = () => [...commands('verify:all')].map(name => scripts[name]).join(' ');
const unaccounted = (files: string[], command: string) => files.filter(file => file.endsWith('.test.mjs') && !command.includes(`scripts/${file}`) && !excluded.has(file));

test('daily verification includes unit tests, Python workers and every current UI gate', () => {
  const included = commands('verify:all');
  for (const required of ['test', 'build', 'test:service', 'test:lyrics-worker', 'test:experiments', 'verify:studio', 'verify:score', 'verify:lyrics', 'verify:resources']) {
    assert.ok(included.has(required), `verify:all omits ${required}`);
  }
});

test('every script test has a daily gate or an explicit compatibility/history reason', () => {
  const files = readdirSync(new URL('../scripts/', import.meta.url));
  assert.deepEqual(unaccounted(files, dailyCommands()), [], 'wire omitted suites into verify:all or document their scope here');
  for (const file of excluded.keys()) assert.ok(files.includes(file), `remove stale exception for ${file}`);
});

test('non-UI test names cannot bypass discovery and removing a registered suite is detected', () => {
  const file = 'verify-browser-compat.test.mjs';
  assert.deepEqual(unaccounted([file], dailyCommands()), []);
  assert.deepEqual(unaccounted([file], dailyCommands().replaceAll(`scripts/${file}`, '')), [file]);
  assert.deepEqual(unaccounted(['verify-new-flow.test.mjs'], dailyCommands()), ['verify-new-flow.test.mjs']);
});

test('every TypeScript test belongs to the daily gate or the explicit trials entry', () => {
  const registered = [...commands('verify:all'), ...commands('test:trials')].flatMap(name => scripts[name].match(/(?:src|tests|scripts)\/[\w/.*-]+\.test\.ts\b/g) ?? []);
  const included = new Set(globSync(registered));
  const files = globSync(['src/**/*.test.ts', 'tests/**/*.test.ts', 'scripts/**/*.test.ts']);
  assert.deepEqual(files.filter(file => !included.has(file)), [], 'a new test directory must be wired into its npm entry');
});

test('browser gates bound hung browser promises with an explicit test timeout', () => {
  for (const name of ['verify:studio', 'verify:score', 'verify:lyrics', 'verify:resources', 'verify:webkit']) {
    assert.match(scripts[name], /--test-timeout=90000\b/, `${name} can otherwise hang on an unresolved browser promise`);
  }
});

test('service fixtures bound waits for worker shutdown and resource release', () => {
  assert.match(scripts['test:service'], /--test-timeout=60000\b/, 'a fixture waiting for a stage that never starts must fail within a minute');
});
