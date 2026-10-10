import { spawn, execFile } from 'node:child_process';
import { appendFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
export function footprintGiB(text: string): number {
  let peak = 0;
  for (const match of text.matchAll(/Physical footprint(?: \(peak\))?:\s*([\d.]+)([KMGT])/g)) peak = Math.max(peak, Number(match[1]) * ({ K: 2 ** -20, M: 2 ** -10, G: 1, T: 1024 }[match[2]] ?? 0));
  return peak;
}
function aborted(signal: AbortSignal) { if (signal.aborted) throw new Error('转换已取消'); }
/** One owned process per operation. Cancellation waits for the actual process to exit. */
export async function runCommandOwned(command: string, args: string[], log: string, signal: AbortSignal, timeoutMs = 20 * 60_000): Promise<void> {
  aborted(signal);
  await appendFile(log, `${JSON.stringify({ command, args, startedAt: new Date().toISOString() })}\n`);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let failure: Error | undefined, killTimer: ReturnType<typeof setTimeout> | undefined;
    let pending = Promise.resolve();
    const record = (chunk: Buffer) => { pending = pending.then(() => appendFile(log, chunk)).catch(error => { stop(new Error(`无法保存推理日志：${String(error)}`)); }); };
    const killGroup = (signal: NodeJS.Signals) => { try { if (child.pid) process.kill(-child.pid, signal); } catch {} };
    const stop = (error: Error) => { if (failure) return; failure = error; killGroup('SIGTERM'); killTimer = setTimeout(() => killGroup('SIGKILL'), 3000); killTimer.unref(); };
    const cancel = () => stop(new Error('转换已取消'));
    const timeout = setTimeout(() => stop(new Error('原生音频处理超时')), timeoutMs); timeout.unref();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    let sampling = false, memoryUnavailableLogged = false, finished = false;
    let memoryProbe: ReturnType<typeof execFile> | undefined;
    const memoryTimer = setInterval(() => {
      if (process.platform !== 'darwin' || sampling || !child.pid || failure) return;
      sampling = true;
      memoryProbe = execFile('/usr/bin/vmmap', ['-summary', String(child.pid)], { timeout: 5000, maxBuffer: 2 * 1024 * 1024 }, (error, stdout) => {
        sampling = false;
        if (finished) return;
        const peak = footprintGiB(stdout);
        if (peak) record(Buffer.from(JSON.stringify({ physicalFootprintPeakGiB: peak }) + '\n'));
        if (peak > 10) stop(new Error('原生推理物理内存超过 10 GiB，已停止转换'));
        if ((error || !peak) && !memoryUnavailableLogged) { memoryUnavailableLogged = true; record(Buffer.from('Physical footprint sampling unavailable; timeout guard remains active.\n')); }
      });
    }, 10_000); memoryTimer.unref();
    child.stdout.on('data', record); child.stderr.on('data', record);
    child.once('error', error => { failure = error; });
    child.once('close', async code => {
      finished = true; memoryProbe?.kill(); clearInterval(memoryTimer); clearTimeout(timeout); if (killTimer) clearTimeout(killTimer); signal.removeEventListener('abort', cancel);
      if (failure) killGroup('SIGKILL'); // Also reap descendants after the group leader exits.
      await pending;
      if (failure) reject(failure); else if (code !== 0) reject(new Error(`原生音频处理失败（退出码 ${code}），请查看转换日志`)); else resolve();
    });
  });
}

/** stdin is a lifetime lease owned by the application, including after SIGKILL. */
export async function runConversionWorker(): Promise<void> {
  const lines = createInterface({ input: process.stdin });
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once('SIGTERM', stop); process.once('SIGINT', stop); lines.once('close', stop);
  process.stdout.on('error', () => {});
  try {
    const task = await new Promise<{ command: string; args: string[]; log: string; timeoutMs: number }>((resolve, reject) => {
      lines.once('line', line => {
        try {
          if (line.length > 65536) throw new Error('转换监管参数过大');
          const t = JSON.parse(line);
          if (!t || !isAbsolute(t.command) || !isAbsolute(t.log) || !Array.isArray(t.args) || t.args.some((a: unknown) => typeof a !== 'string') || !Number.isInteger(t.timeoutMs) || t.timeoutMs < 1 || t.timeoutMs > 20 * 60_000) throw new Error('转换监管参数无效');
          resolve(t);
        } catch (error) { reject(error); }
      });
      lines.once('close', () => reject(new Error('未收到转换监管参数')));
    });
    await runCommandOwned(task.command, task.args, task.log, controller.signal, task.timeoutMs);
    if (controller.signal.aborted) throw new Error('转换已取消');
    process.stdout.write(JSON.stringify({ ok: true }) + '\n');
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: String((error as Error)?.message ?? error) }) + '\n');
    process.exitCode = 1;
  } finally {
    lines.removeListener('close', stop); process.removeListener('SIGTERM', stop); process.removeListener('SIGINT', stop);
    lines.close(); process.stdin.destroy();
  }
}
