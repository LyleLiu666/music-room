import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, openSync, readFileSync, realpathSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {z} from 'zod';

const configSchema = z.strictObject({
  endpoint: z.string().min(1), bucket: z.string().min(1), prefix: z.string().min(1),
  accessKeyId: z.string().min(1), secretAccessKey: z.string().min(1),
  region: z.string().min(1).optional(), allowRelease: z.boolean().optional(),
});
export type MusicObjectAudioConfig = z.infer<typeof configSchema>;

export function readMusicObjectAudioConfig(workspace: string, env = process.env, home = homedir()): MusicObjectAudioConfig | undefined {
  if (env.MUSIC_ROOM_MINIO_ENDPOINT) {
    const config = configSchema.safeParse({
      endpoint: env.MUSIC_ROOM_MINIO_ENDPOINT, bucket: env.MUSIC_ROOM_MINIO_BUCKET,
      prefix: env.MUSIC_ROOM_MINIO_PREFIX, accessKeyId: env.MUSIC_ROOM_MINIO_ACCESS_KEY,
      secretAccessKey: env.MUSIC_ROOM_MINIO_SECRET_KEY, region: env.MUSIC_ROOM_MINIO_REGION,
      allowRelease: env.MUSIC_ROOM_MINIO_ALLOW_RELEASE === '1',
    });
    if (!config.success) throw Error('MinIO 环境变量配置不完整');
    return config.data;
  }
  const defaultWorkspace = join(realpathSync(home), 'Music', 'MusicRoom');
  const name = workspace === defaultWorkspace ? 'minio.json' :
    'minio-' + createHash('sha256').update(workspace).digest('hex') + '.json';
  const path = join(home, 'Library', 'Application Support', 'MusicRoom', name);

  let fd: number;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw Error('无法打开 MinIO 私有配置，请检查文件类型和权限');
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 || stat.uid !== process.getuid?.() ||
        stat.nlink !== 1 || stat.size > 16_384) {
      throw Error('MinIO 私有配置必须是当前用户拥有的 0600 普通文件');
    }
    try { return configSchema.parse(JSON.parse(readFileSync(fd, 'utf8'))); }
    catch { throw Error('MinIO 私有配置 JSON 内容无效'); }
  } finally { closeSync(fd); }
}
