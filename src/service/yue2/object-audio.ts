import {DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client} from '@aws-sdk/client-s3';
import {getSignedUrl} from '@aws-sdk/s3-request-presigner';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import type {MusicObjectAudioConfig} from './object-audio-config.ts';
import {ServiceError} from '../projects/errors.ts';

export const musicAudioLimit = 120_000_000;
export type AudioDigest = {hash: string; bytes: number};
export type MusicObjectAudio = {
  namespace: string;
  playbackOrigin: string;
  upload(key: string, path: string, digest: AudioDigest, signal?: AbortSignal): Promise<void>;
  read(key: string, digest: AudioDigest, signal?: AbortSignal): Promise<Uint8Array>;
  verify(key: string, digest: AudioDigest, signal?: AbortSignal): Promise<void>;
  playback(key: string): Promise<string>;
  remove(key: string): Promise<void>;
};

export function openMusicObjectAudio(config?: MusicObjectAudioConfig): MusicObjectAudio | undefined {
  if (!config) return;
  let endpoint: URL;
  try { endpoint = new URL(config.endpoint); } catch { throw Error('MinIO 地址无效'); }
  const loopback = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost';
  if ((endpoint.protocol !== 'https:' && !(loopback && endpoint.protocol === 'http:')) ||
      !/^[a-z0-9.-]+$/.test(endpoint.hostname) || endpoint.pathname !== '/' || endpoint.search || endpoint.hash || endpoint.username || endpoint.password) {
    throw Error('MinIO 地址必须是 HTTPS 来源，测试可使用本机 HTTP');
  }
  const {bucket, prefix, accessKeyId, secretAccessKey} = config;
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket) ||
      !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(prefix) || !accessKeyId || !secretAccessKey) {
    throw Error('MinIO 需要有效的私有桶、工作区前缀和专用凭据');
  }
  const client = new S3Client({
    endpoint: endpoint.origin, forcePathStyle: true, region: config.region ?? 'us-east-1',
    credentials: {accessKeyId, secretAccessKey}, maxAttempts: 1,
    requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
  });
  const object = (key: string) => ({Bucket: bucket, Key: prefix + '/' + key});
  const deadline = (signal?: AbortSignal) => {
    const timeout = AbortSignal.timeout(90_000);
    return {abortSignal: signal ? AbortSignal.any([signal, timeout]) : timeout};
  };
  async function download(key: string, digest: AudioDigest, keep: boolean, signal?: AbortSignal) {
    try {
      const result = await client.send(new GetObjectCommand(object(key)), deadline(signal));
      const body = result.Body as (AsyncIterable<Uint8Array> & {destroy(): void}) | undefined;
      if (!body) throw Error('missing body');
      try {
        if (result.ContentLength !== digest.bytes || digest.bytes > musicAudioLimit) throw Error('size mismatch');
        const hash = createHash('sha256');
        const bytes = keep ? new Uint8Array(digest.bytes) : undefined;
        let offset = 0;
        for await (const chunk of body) {
          if (offset + chunk.length > digest.bytes) throw Error('size mismatch');
          hash.update(chunk);
          bytes?.set(chunk, offset);
          offset += chunk.length;
        }
        if (offset !== digest.bytes || hash.digest('hex') !== digest.hash) throw Error('checksum mismatch');
        return bytes;
      } finally { body.destroy(); }
    } catch {
      throw new ServiceError('MUSIC_STORAGE_UNAVAILABLE', '无法读取或校验 MinIO 原音频');
    }
  }
  return {
    namespace: endpoint.origin + '/' + bucket + '/' + prefix,
    playbackOrigin: endpoint.origin,
    async upload(key, path, digest, signal) {
      const body = createReadStream(path);
      try {
        await client.send(new PutObjectCommand({
          ...object(key), Body: body, ContentLength: digest.bytes,
          ContentType: 'audio/flac', CacheControl: 'private, no-store', IfNoneMatch: '*',
        }), deadline(signal));
      } catch (error) {
        // A prior attempt may have uploaded the same immutable key.
        if ((error as {$metadata?: {httpStatusCode?: number}}).$metadata?.httpStatusCode !== 412) {
          throw new ServiceError('MUSIC_STORAGE_UNAVAILABLE', '上传 MinIO 音频失败，本地原件已保留');
        }
      } finally { body.destroy(); }
      await download(key, digest, false, signal);
    },
    async read(key, digest, signal) { return (await download(key, digest, true, signal))!; },
    async verify(key, digest, signal) { await download(key, digest, false, signal); },
    playback(key) { return getSignedUrl(client, new GetObjectCommand(object(key)), {expiresIn: 900}); },
    async remove(key) {
      try { await client.send(new DeleteObjectCommand(object(key)), deadline()); }
      catch { throw new ServiceError('MUSIC_STORAGE_UNAVAILABLE', '无法删除 MinIO 音频，请稍后重试'); }
    },
  };
}
