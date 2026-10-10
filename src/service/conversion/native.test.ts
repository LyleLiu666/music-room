import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createNativeConversionDriver, runCommand } from './native.ts';

test('uninstalled native engine reports actionable unavailable state', () => {
  const status = createNativeConversionDriver('/nonexistent-conversion-engine').status();
  assert.equal(status.ready, false); assert.match(status.message, /安装/);
});
test('native command captures both output streams and fails on nonzero exit', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conversion-command-'));
  try {
    const log = join(directory, 'run.log');
    await assert.rejects(runCommand(process.execPath, ['-e', 'console.log("out");console.error("err");process.exit(7)'], log, new AbortController().signal), /退出码 7/);
    const output = await readFile(log, 'utf8'); assert.match(output, /out/); assert.match(output, /err/); assert.match(output, /startedAt/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('abort terminates the owned process and rejects rather than returning success', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conversion-abort-'));
  try {
    const controller = new AbortController(), started = Date.now();
    const running = runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], join(directory, 'run.log'), controller.signal);
    const timer = setTimeout(() => controller.abort(), 100);
    await assert.rejects(running, /取消/); clearTimeout(timer);
    assert.ok(Date.now() - started < 5000);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
test('timeout and launch failure never yield a successful render', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'conversion-timeout-'));
  try {
    await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(()=>{},1000)'], join(directory, 'run.log'), new AbortController().signal, 50), /超时/);
    await assert.rejects(runCommand('/nonexistent-audio-binary', [], join(directory, 'run.log'), new AbortController().signal), /ENOENT/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('memory guard uses physical footprint including peak and binary units, never just RSS',async()=>{
  const {footprintGiB}=await import('./native.ts');
  assert.equal(footprintGiB('Physical footprint: 2300M\nPhysical footprint (peak): 10.2G\n'),10.2);
  assert.equal(footprintGiB('Physical footprint: 512M'),.5);
  assert.equal(footprintGiB('RSS: 99999G'),0);
});
