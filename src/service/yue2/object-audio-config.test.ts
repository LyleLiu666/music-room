import test from 'node:test';
import assert from 'node:assert/strict';
import {chmod, mkdir, mkdtemp, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {readMusicObjectAudioConfig} from './object-audio-config.ts';

test('private MinIO settings survive a launcher restart and are scoped to one workspace', async t => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'music-minio-config-')));
  t.after(() => rm(home, {recursive:true,force:true}));
  const workspace = join(home, 'Music', 'MusicRoom');
  const directory = join(home, 'Library', 'Application Support', 'MusicRoom');
  const file = join(directory, 'minio.json');
  await mkdir(directory, {recursive:true,mode:0o700});
  const config = {endpoint:'https://storage.example',bucket:'music-room',prefix:'main',
    accessKeyId:'fixture-key',secretAccessKey:'fixture-secret'};
  assert.equal(readMusicObjectAudioConfig(workspace, {}, home), undefined);
  await writeFile(file, JSON.stringify(config), {mode:0o600});
  assert.deepEqual(readMusicObjectAudioConfig(workspace, {}, home),config);
  assert.equal(readMusicObjectAudioConfig(workspace+'-preview', {}, home),undefined);
  assert.equal(readMusicObjectAudioConfig(workspace, {MUSIC_ROOM_MINIO_ALLOW_RELEASE:'1'}, home)?.allowRelease,undefined);
  await chmod(file, 0o644);
  assert.throws(()=>readMusicObjectAudioConfig(workspace, {}, home),/0600/);
  await rm(file);
  await symlink(join(home, 'nonexistent'),file);
  assert.throws(()=>readMusicObjectAudioConfig(workspace, {}, home),/无法打开/);
});
