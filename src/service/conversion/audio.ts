/** Timeline arithmetic is always in 44.1 kHz samples, never rounded seconds. */
export const SR = 44100;
export interface Part { start: number; end: number; inputStart: number; inputEnd: number }
export function plan(n: number): Part[] {
  if (!Number.isSafeInteger(n) || n < 1) throw new Error('音频为空或长度无效');
  const result: Part[] = [];
  for (let start = 0; start < n;) {
    const end = Math.min(n, start + 16 * SR);
    result.push({ start, end, inputStart: Math.max(0, start - 1.5 * SR), inputEnd: Math.min(n, end + 1.5 * SR) });
    if (end === n) break;
    start = end - SR / 2;
  }
  return result;
}
export function weights(parts: Part[], i: number): Float32Array {
  const p = parts[i], w = new Float32Array(p.end - p.start).fill(1);
  if (i) { const n = parts[i - 1].end - p.start; for (let j = 0; j < n; j++) w[j] = n === 1 ? .5 : j / (n - 1); }
  if (i + 1 < parts.length) { const n = p.end - parts[i + 1].start; for (let j = 0; j < n; j++) w[w.length - n + j] = n === 1 ? .5 : 1 - j / (n - 1); }
  return w;
}
export function rms(a: Float32Array): number { let sum = 0; for (const x of a) sum += x * x; return Math.sqrt(sum / Math.max(1, a.length)); }
export function mono(channels: Float32Array[]): Float32Array {
  if (!channels.length || channels.some(c => c.length !== channels[0].length)) throw new Error('音频声道长度不一致');
  const a = new Float32Array(channels[0].length);
  for (const c of channels) for (let i = 0; i < a.length; i++) a[i] += c[i] / channels.length;
  return a;
}
export function fitLength(a: Float32Array, length: number): Float32Array {
  if (a.length > length + 1024 || a.length < length - 1024) throw new Error(`转换输出长度异常：${a.length} / ${length}`);
  const result = new Float32Array(length); result.set(a.subarray(0, length)); return result;
}
/** Smooth a source-derived energy gate; suppress generated vocals during source pauses. */
export function gate(source: Float32Array, vocal: Float32Array): void {
  if (source.length !== vocal.length) throw new Error('人声长度不一致');
  const frame = 441, count = Math.ceil(source.length / frame), levels = new Float32Array(count), smooth = new Float32Array(count);
  for (let k = 0; k < count; k++) levels[k] = Math.max(0, Math.min(1, (20 * Math.log10(Math.max(rms(source.subarray(k * frame, (k + 1) * frame)), 1e-9)) + 65) / 20));
  for (let k = 0; k < count; k++) { let sum = 0, total = 0; for (let d = -20; d <= 20; d++) { const w = Math.exp(-.5 * (d / 5) ** 2); sum += levels[Math.max(0, Math.min(count - 1, k + d))] * w; total += w; } smooth[k] = sum / total; }
  for (let i = 0; i < vocal.length; i++) { const k = Math.floor(i / frame), t = i / frame - k; vocal[i] *= smooth[k] * (1 - t) + smooth[Math.min(k + 1, count - 1)] * t; }
}
export function mix(backing: Float32Array[], vocals: Float32Array): { channels: Float32Array[]; gain: number } {
  if (!backing.length || backing.some(c => c.length !== vocals.length)) throw new Error('背景和人声长度不一致');
  const n = vocals.length, fade = Math.min(Math.floor(SR / 50), Math.floor(n / 2));
  let peak = 0;
  const channels = backing.map(b => {
    const out = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const edge = fade > 1 ? Math.min(1, i / (fade - 1), (n - 1 - i) / (fade - 1)) : 1;
      const value = (b[i] + vocals[i]) * edge;
      if (!Number.isFinite(value)) throw new Error('音频包含无效采样');
      out[i] = value || 0; peak = Math.max(peak, Math.abs(value));
    }
    return out;
  });
  const gain = Math.min(1, .98 / Math.max(peak, 1e-9));
  if (gain < 1) for (const c of channels) for (let i = 0; i < n; i++) c[i] *= gain;
  return { channels, gain };
}
