import decoder from 'wav-decoder';
/** Validate RIFF first: wav-decoder neither understands extensible GUIDs nor checks truncated data. */
export async function decodeNativeWav(input: Uint8Array): Promise<{ sampleRate: number; channelData: Float32Array[] }> {
  const b = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE' || b.readUInt32LE(4) + 8 !== b.length) throw new Error('WAV 容器不完整');
  let fmt: Buffer | undefined, data: Buffer | undefined, offset = 12;
  while (offset < b.length) {
    if (offset + 8 > b.length) throw new Error('WAV chunk 头不完整');
    const size = b.readUInt32LE(offset + 4), end = offset + 8 + size, next = end + size % 2;
    if (end > b.length || next > b.length) throw new Error('WAV chunk 数据不完整');
    const tag = b.toString('ascii', offset, offset + 4);
    if (tag === 'fmt ') { if (fmt) throw new Error('WAV 包含重复格式'); fmt = b.subarray(offset + 8, end); }
    if (tag === 'data') { if (data) throw new Error('WAV 包含重复数据'); data = b.subarray(offset + 8, end); }
    offset = next;
  }
  if (!fmt || fmt.length < 16 || !data?.length) throw new Error('WAV 缺少格式或音频数据');
  let tag = fmt.readUInt16LE(0);
  const channels = fmt.readUInt16LE(2), sampleRate = fmt.readUInt32LE(4), bits = fmt.readUInt16LE(14), block = fmt.readUInt16LE(12);
  if (tag === 0xfffe) {
    if (fmt.length < 40 || fmt.readUInt16LE(16) < 22 || fmt.readUInt16LE(16) + 18 > fmt.length) throw new Error('WAV 扩展格式损坏');
    // PCM and IEEE_FLOAT share this GUID suffix; all other subtypes remain unsupported.
    if (!fmt.subarray(28, 40).equals(Buffer.from('00001000800000aa00389b71', 'hex'))) throw new Error('不支持的 WAV subtype GUID');
    tag = fmt.readUInt32LE(24);
    if (tag !== 1 && tag !== 3) throw new Error('不支持的 WAV subtype GUID');
    if (fmt.readUInt16LE(18) !== bits) throw new Error('不支持不同有效位数的 WAV 扩展格式');
  }
  if ((tag !== 1 && tag !== 3) || (tag === 1 && ![8,16,24,32].includes(bits)) || (tag === 3 && ![32,64].includes(bits))) throw new Error('不支持的 WAV 编码');
  if (![1,2].includes(channels) || sampleRate < 8000 || sampleRate > 192000 || block !== channels * bits / 8 || fmt.readUInt32LE(8) !== sampleRate * block || data.length % block) throw new Error('WAV 声道或采样帧损坏');
  // Keep only checked format/data chunks, eliminating ancillary padding ambiguities in the decoder.
  const canonical = Buffer.alloc(44 + data.length + data.length % 2);
  canonical.write('RIFF'); canonical.writeUInt32LE(canonical.length - 8, 4); canonical.write('WAVE', 8);
  canonical.write('fmt ', 12); canonical.writeUInt32LE(16, 16); fmt.copy(canonical, 20, 0, 16); canonical.writeUInt16LE(tag, 20);
  canonical.write('data', 36); canonical.writeUInt32LE(data.length, 40); data.copy(canonical, 44);
  return decoder.decode(canonical.buffer.slice(canonical.byteOffset, canonical.byteOffset + canonical.byteLength) as ArrayBuffer);
}
