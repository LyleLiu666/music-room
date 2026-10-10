import {readAudioFile} from '../projects/audio-files.ts';
import {conversionProfile} from '../resources/profiles.ts';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeNativeWav } from './audio-codec.ts';
import { encodeWav } from '../../wav.ts';
import { SR, fitLength, gate, mix, mono, plan, rms, weights } from './audio.ts';
import type { ConversionDriver } from './conversion.ts';
import {shiftBackingStem} from './pitch.ts';
import type {ResourceExecution} from '../resources/contracts.ts';

const models = [
  { file: 'seed-vc-f16.gguf', size: 3629186560, sha256: '03740be5b4b55ae677c34d63514ff879aaedd6a77fd31773938166fb84debf93' },
  { file: 'htdemucs-f16.gguf', size: 84059168, sha256: 'f8c54ba35df95aafea7881eac214b58ec18a73cbcb6ff5a90f4b762631a286b6' },
];
type Installation = { format: string; version: number; commit: string; programSha256: string; modelSha256: string; separationSha256: string };
function installation(directory: string): Installation {
  const value = JSON.parse(readFileSync(join(directory, 'installed.json'), 'utf8')) as Installation;
  if (value.format !== 'music-room-conversion-engine' || value.version !== 1 || !/^[a-f0-9]{40}$/.test(value.commit) || !/^[a-f0-9]{64}$/.test(value.programSha256) || value.modelSha256 !== models[0].sha256 || value.separationSha256 !== models[1].sha256) throw new Error('音色转换安装记录无效');
  return value;
}
const checked = new Map<string, string>();
export { footprintGiB } from './worker.ts';
export type ConversionWorker = { command: string; args: string[] };
const defaultWorker: ConversionWorker = { command: process.execPath, args: [fileURLToPath(new URL('../../server/dev.ts', import.meta.url)), 'conversion-native-worker'] };
function aborted(signal: AbortSignal) { if (signal.aborted) throw new Error('转换已取消'); }
/** Keep stdin open until completion; parent death closes it and the supervisor stops its process group. */
export async function runCommand(command: string, args: string[], log: string, signal: AbortSignal, timeoutMs = 20 * 60_000, worker = defaultWorker, execution?:ResourceExecution): Promise<void> {
  aborted(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(worker.command, worker.args, {detached:!!execution?.lease, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '', diagnostics = '', launchError: Error | undefined;let stopTimer:ReturnType<typeof setTimeout>|undefined,forceTimer:ReturnType<typeof setTimeout>|undefined;
    child.stdin.on('error', () => {});
    const cancel = () => {child.stdin.end();if(stopTimer)return;stopTimer=setTimeout(()=>child.kill('SIGTERM'),7000);stopTimer.unref();forceTimer=setTimeout(()=>{try{if(execution?.lease&&child.pid)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{}},14000);forceTimer.unref();};
    signal.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', chunk => { output = (output + chunk.toString()).slice(-65536); });
    child.stderr.on('data', chunk => { diagnostics = (diagnostics + chunk.toString()).slice(-4000); });
    child.once('error', error => { launchError = error; });
    child.once('close', code => {if(stopTimer)clearTimeout(stopTimer);if(forceTimer)clearTimeout(forceTimer);
      signal.removeEventListener('abort', cancel);
      if (signal.aborted) { reject(new Error('转换已取消')); return; }
      if (launchError) { reject(launchError); return; }
      try {
        const result = JSON.parse(output.trim());
        if (code !== 0 || result.ok !== true) throw new Error(result.error || '转换监管进程失败');
        resolve();
      } catch (error) { reject(output.trim() ? error : new Error(diagnostics || '转换监管进程意外退出')); }
    });
    try{if(child.pid)execution?.trackProcess(child.pid);child.stdin.write(JSON.stringify({ command, args, log, timeoutMs,resourceLease:execution?.lease }) + '\n');}
    catch(error){cancel();reject(error);}
    if (signal.aborted) cancel();
  });
}
async function loadWav(path: string) {
  const info = await stat(path);
  // Bounded to 20 min, stereo float32 WAV with small header allowance.
  if (info.size > SR * 1200 * 2 * 4 + 65536) throw new Error('音频文件超过 20 分钟限制');
  const bytes = readAudioFile(path,SR * 1200 * 2 * 4 + 65536);
  const audio = await decodeNativeWav(bytes);
  if (audio.sampleRate !== SR || !audio.channelData.length || audio.channelData.length > 2) throw new Error('需要 44.1 kHz 单声道或立体声音频');
  if (audio.channelData.some(c => c.length !== audio.channelData[0].length || c.some(x => !Number.isFinite(x)))) throw new Error('音频采样无效');
  return audio.channelData;
}
async function saveWav(path: string, channels: Float32Array[]) { await writeFile(path, Buffer.from(encodeWav(channels, SR))); }
async function verifyModels(directory: string, signal: AbortSignal) {
  const installed = installation(directory);
  for (const m of [...models, { file: 'audiocpp_cli', size: undefined, sha256: installed.programSha256 }]) {
    aborted(signal);
    const path = join(directory, m.file), info = await stat(path), identity = `${info.size}:${info.mtimeMs}:${info.ctimeMs}:${m.sha256}`;
    if (m.size !== undefined && info.size !== m.size) throw new Error(`${m.file} 文件大小不正确`);
    if (checked.get(path) === identity) continue;
    const hash = createHash('sha256'), stream = createReadStream(path, { signal });
    for await (const chunk of stream) hash.update(chunk);
    if (hash.digest('hex') !== m.sha256) throw new Error(`${m.file} 校验失败，请重新安装模型`);
    checked.set(path, identity);
  }
}
export function createNativeConversionDriver(engineDirectory: string, worker: ConversionWorker = defaultWorker): ConversionDriver {
  const cli = join(engineDirectory, 'audiocpp_cli');
  const details = { model: 'Seed-VC · F16 · v1_svc', backend: 'Metal', separationModel: 'HTDemucs · F16', directory: engineDirectory };
  return {resourceProfile:()=>{try{const i=installation(engineDirectory);return {...conversionProfile,commit:i.commit,program:i.programSha256};}catch{return undefined;}},
    status: () => {
      try {
        if (!existsSync(cli) || !existsSync(join(engineDirectory, 'installed.json'))) return { ...details, ready: false, message: '尚未安装原生音色转换引擎' };
        installation(engineDirectory);
        if (models.some(m => statSync(join(engineDirectory, m.file)).size !== m.size)) return { ...details, ready: false, message: '音色转换模型不完整' };
        return { ...details, ready: true, message: '已就绪 · 在本机处理，无需为新音色训练' };
      } catch { return { ...details, ready: false, message: '音色转换模型不可用' }; }
    },
    run: async (directory, progress, signal,execution) => {
      const execute = (command: string, args: string[], log: string, signal: AbortSignal, timeoutMs = 20 * 60_000) => runCommand(command, args, log, signal, timeoutMs, worker,execution);
      const started = Date.now(), log = join(directory, 'native.log');
      progress('preparing', '校验模型与原始音频', 0);
      await verifyModels(engineDirectory, signal);
      const meta = JSON.parse(await readFile(join(directory, 'meta.json'), 'utf8')) as { extension: string; pitchShiftSemitones?:number };
      const pitchShiftSemitones=meta.pitchShiftSemitones??0;
      if(!Number.isInteger(pitchShiftSemitones)||Math.abs(pitchShiftSemitones)>12)throw new Error('升降调必须为 -12 至 12 之间的整数半音');
      if (!/^\.[a-zA-Z0-9]{1,8}$/.test(meta.extension)) throw new Error('原始文件扩展名无效');
      const sourcePath = join(directory, 'source.wav');
      await execute('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', join(directory, `original${meta.extension}`), sourcePath], log, signal, 120_000);
      const source = await loadWav(sourcePath), n = source[0].length;
      if (!n || n > 1200 * SR) throw new Error('音频必须在 0 至 20 分钟之间');
      // Core Audio may emit WAVE_FORMAT_EXTENSIBLE; publish canonical PCM16 for service validation.
      await saveWav(sourcePath, source);
      // Verify the reference can be decoded without cropping its high-note ending.
      const referencePath = join(directory, 'reference-decoded.wav');
      await execute('/usr/bin/afconvert', ['-f', 'WAVE', '-d', 'LEI16@44100', '-c', '1', join(directory, 'reference.wav'), referencePath], log, signal, 120_000);
      const reference = await loadWav(referencePath);
      if (reference[0].length < .3 * SR || reference[0].length > 25 * SR) throw new Error('参考音频请保持在 0.3 至 25 秒，避免模型自动截去末尾');
      progress('separation', '提取人声并保留立体声背景', .02);
      const stems = join(directory, 'stems'); await mkdir(stems, { recursive: true });
      await execute(cli, ['--task', 'sep', '--family', 'htdemucs', '--model', join(engineDirectory, 'htdemucs-f16.gguf'), '--backend', 'metal', '--audio', sourcePath, '--out-dir', stems, '--metrics', '--log'], log, signal);
      const separated = await loadWav(join(stems, 'vocals.wav'));
      const vocal = mono(separated.map(c => fitLength(c, n)));
      // Sum model background stems; keep stereo channel placement through remix.
      const backing = Array.from({ length: source.length }, () => new Float32Array(n));
      for (const stem of ['drums', 'bass', 'other']) {
        const separatedChannels = await loadWav(join(stems, `${stem}.wav`));
        const channels = await shiftBackingStem(stem as 'drums'|'bass'|'other',separatedChannels.map(c=>fitLength(c,n)),pitchShiftSemitones,signal);
        if (source.length === 2 && channels.length !== 2) throw new Error('分离引擎丢失立体声背景，拒绝输出降为单声道的结果');
        for (let ch = 0; ch < backing.length; ch++) { const a = fitLength(channels[ch] ?? channels[0], n); for (let i = 0; i < n; i++) backing[ch][i] += a[i]; }
      }
      const parts = plan(n), merged = new Float32Array(n), records: object[] = [];
      for (let i = 0; i < parts.length; i++) {
        aborted(signal);
        const p = parts[i], central = vocal.subarray(p.start, p.end), level = rms(central), piece = new Float32Array(central.length), begin = Date.now();
        progress('conversion', `转换第 ${i + 1} / ${parts.length} 段`, .08 + .85 * i / parts.length);
        let gain = 0;
        if (level >= 10 ** (-55 / 20)) {
          const input = join(directory, 'segment-source.wav'), output = join(directory, 'segment-converted.wav');
          await saveWav(input, [vocal.subarray(p.inputStart, p.inputEnd)]); await rm(output, { force: true });
          await execute(cli, ['--task', 'svc', '--family', 'seed_vc', '--task-route', 'v1_svc', '--model', join(engineDirectory, 'seed-vc-f16.gguf'), '--backend', 'metal', '--audio', input, '--voice-ref', referencePath, '--out', output, '--num-inference-steps', '30', '--seed', '42', '--request-option', 'f0_condition=true', '--request-option', 'auto_f0_adjust=false', '--request-option', `semitone_shift=${pitchShiftSemitones}`, '--request-option', 'length_adjust=1.0', '--metrics', '--log'], log, signal);
          const rendered = fitLength(mono(await loadWav(output)), p.inputEnd - p.inputStart);
          piece.set(rendered.subarray(p.start - p.inputStart, p.end - p.inputStart));
          if (rms(piece) < 1e-8) throw new Error(`第 ${i + 1} 段转换得到空白人声`);
          gain = Math.min(4, level / Math.max(rms(piece), 1e-8)) * 10 ** (3 / 20);
          for (let j = 0; j < piece.length; j++) piece[j] *= gain;
        }
        const w = weights(parts, i); for (let j = 0; j < piece.length; j++) merged[p.start + j] += piece[j] * w[j];
        records.push({ ...p, sourceRms: level, gain, skipped: gain === 0, seconds: (Date.now() - begin) / 1000 });
      }
      aborted(signal); progress('mixing', pitchShiftSemitones?'混回同步升降调的伴奏并检查完整长度':'混回原背景并检查完整长度', .95);
      gate(vocal, merged);
      const mixed = mix(backing, merged), vocalOutput = mix([new Float32Array(n)], merged);
      await saveWav(join(directory, 'converted.pending.wav'), mixed.channels);
      await saveWav(join(directory, 'vocals.wav'), vocalOutput.channels);
      const verified = await loadWav(join(directory, 'converted.pending.wav'));
      if (verified.length !== source.length || verified.some(c => c.length !== n)) throw new Error('转换输出未通过完整长度检查');
      aborted(signal);
      await writeFile(join(directory, 'metrics.json'), JSON.stringify({ installation: installation(engineDirectory), duration: n / SR, sampleRate: SR, channels: source.length, pitchShiftSemitones, drumsPitchShiftSemitones:0, elapsedSeconds: (Date.now() - started) / 1000, mixGain: mixed.gain, vocalBoostDb: 3, referenceSeconds: reference[0].length / SR, parts: records }, null, 2));
      await rename(join(directory, 'converted.pending.wav'), join(directory, 'converted.wav'));
      progress('complete', '转换完成', 1);
      return { duration: n / SR };
    },
  };
}
