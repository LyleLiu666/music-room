import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const entry = fileURLToPath(new URL('../../server/dev.ts', import.meta.url));
async function waitPid(file: string): Promise<number> {
  for (let i = 0; i < 250; i++) { try { const pid = Number(await readFile(file, 'utf8')); if (pid > 1) return pid; } catch {} await delay(20); }
  throw new Error('fixture child did not start');
}
async function expectDead(pid: number) {
  for (let i = 0; i < 300; i++) { try { process.kill(pid, 0); } catch { return; } await delay(20); }
  assert.fail('owned native child survived loss of parent');
}
function cleanupGroup(pid: number | undefined) { try { if (pid) process.kill(-pid, 'SIGKILL'); } catch {} }

test('supervisor EOF stops a native process even when it ignores TERM', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conversion-worker-eof-'));
  const supervisor = spawn(process.execPath, [entry, 'conversion-native-worker'], { stdio: ['pipe', 'pipe', 'pipe'] });
  let pid: number | undefined, output = '';
  const closed = new Promise<number | null>(resolve => supervisor.once('close', resolve));
  supervisor.stdout.on('data', chunk => { output += chunk; }); supervisor.stderr.resume();
  try {
    const path = join(directory, 'child.pid');
    supervisor.stdin.write(JSON.stringify({ command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(path)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`], log: join(directory, 'run.log'), timeoutMs: 10000 }) + '\n');
    pid = await waitPid(path); supervisor.stdin.end();
    assert.equal(await closed, 1); await expectDead(pid);
    assert.match(output, /取消/);
  } finally { supervisor.stdin.end(); cleanupGroup(pid); await closed; await rm(directory, { recursive: true, force: true }); }
});

test('SIGKILL of the application closes the lease and cannot orphan native inference', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conversion-worker-crash-'));
  const path = join(directory, 'child.pid');
  const nativeModule = new URL('./native.ts', import.meta.url).href;
  const childScript = `require('node:fs').writeFileSync(${JSON.stringify(path)},String(process.pid));process.on('SIGTERM',()=>{});setInterval(()=>{},1000);`;
  const parentScript = `import {runCommand} from ${JSON.stringify(nativeModule)};await runCommand(process.execPath,['-e',${JSON.stringify(childScript)}],${JSON.stringify(join(directory, 'run.log'))},new AbortController().signal,10000);`;
  const parent = spawn(process.execPath, ['--input-type=module', '-e', parentScript], { stdio: 'ignore' });
  const closed = new Promise(resolve => parent.once('close', resolve)); let pid: number | undefined;
  try { pid = await waitPid(path); parent.kill('SIGKILL'); await closed; await expectDead(pid); }
  finally { parent.kill('SIGKILL'); cleanupGroup(pid); await closed; await rm(directory, { recursive: true, force: true }); }
});
