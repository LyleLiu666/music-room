export function encodeWav(channels: Float32Array[], sampleRate: number): ArrayBuffer {
  if (!channels.length || channels.some(c => c.length !== channels[0].length)) throw new Error('声道长度不一致');
  const frames = channels[0].length, count = channels.length;
  const data = new ArrayBuffer(44 + frames * count * 2), v = new DataView(data);
  const text = (offset: number, s: string) => [...s].forEach((c, i) => v.setUint8(offset + i, c.charCodeAt(0)));
  text(0, 'RIFF'); v.setUint32(4, data.byteLength - 8, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, count, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * count * 2, true); v.setUint16(32, count * 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, frames * count * 2, true);
  let offset = 44;
  for (let i = 0; i < frames; i++) for (const channel of channels) {
    const value = Math.max(-1, Math.min(1, channel[i]));
    v.setInt16(offset, Math.round(value * (value < 0 ? 32768 : 32767)), true); offset += 2;
  }
  return data;
}
