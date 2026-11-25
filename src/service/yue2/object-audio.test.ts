import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectStore} from '../projects/store.ts';
import {YuE2Client} from './client.ts';
import type {MusicObjectAudio} from './object-audio.ts';

test('YuE2 keeps local originals until verified release, then supports reload, score, processing and purge', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'music-object-audio-')));
  t.after(() => rm(root, {recursive: true, force: true}));
  const directory = join(root, 'engine');
  const id = 'a'.repeat(32), song = join(directory, 'data', 'songs', id, 'song');
  const file = join(song, 'audio.flac'), original = Buffer.from('fLaCtest audio');
  await mkdir(song, {recursive: true});
  await writeFile(file, original);
  await writeFile(join(song, 'score.abc'), 'X:1');
  await writeFile(join(directory, '.music-room-yue2.json'), '{"format":"music-room-yue2","version":1}');
  const workspace = join(root, 'workspace');
  let store = await ProjectStore.open(workspace);
  await mkdir(store.path('engines'), {recursive: true});
  store.atomicJSON(store.path('engines', 'yue2-jobs.json'), {version: 1, jobs: [{
    job: {id, status: 'done', kind: 'create'}, directory, upstreamId: id,
    bytes: original.length, hash: createHash('sha256').update(original).digest('hex'),
  }]});
  const engine = {status: async () => ({directory}), history: async () => []} as any;
  const objects = new Map<string, Uint8Array>();
  let offline = true;
  const storage: MusicObjectAudio = {
    namespace: 'test/private/music', playbackOrigin: 'https://minio.example',
    async upload(key, path) { if (offline) throw Error('offline'); objects.set(key, await readFile(path)); },
    async read(key) { const data = objects.get(key); assert.ok(data); return data; },
    async verify(key) { if (offline || !objects.has(key)) throw Error('offline'); },
    async playback(key) { return this.playbackOrigin + '/' + key; },
    async remove(key) { if (offline) throw Error('offline'); objects.delete(key); },
  };
  let client = new YuE2Client(engine, store, {} as any, storage);
  t.after(async () => { await client.close(); await store.close(); });

  await assert.rejects(client.archiveAudio(id), /offline/);
  assert.deepEqual(await readFile(file), original);
  assert.equal(await client.playback(id), undefined);
  offline = false;
  assert.deepEqual(await client.archiveAudio(id), {archived: true, local: true});
  assert.deepEqual(await readFile(file), original);
  assert.match((await client.playback(id))!, /^https:\/\/minio\.example\//);

  offline = true;
  await assert.rejects(client.archiveAudio(id, true), /offline/);
  assert.deepEqual(await readFile(file), original);
  offline = false;
  await writeFile(file, Buffer.from('fLaCtest edit!'));
  await assert.rejects(client.archiveAudio(id, true), /本地原件已变化/);
  assert.equal((await readFile(file)).toString(), 'fLaCtest edit!');
  await writeFile(file, original);
  assert.deepEqual(await client.archiveAudio(id, true), {archived: true, local: false});
  await assert.rejects(readFile(file), {code: 'ENOENT'});

  await client.close();
  await store.close();
  store = await ProjectStore.open(workspace);
  client = new YuE2Client(engine, store, {} as any, storage);
  assert.equal((await client.job(id)).job.status, 'done');
  assert.equal((await client.job(id)).audioUrl, '/yue2-audio/' + id);
  assert.equal(await client.score(id), 'X:1');
  assert.deepEqual(Buffer.from(await client.audio(id)), original);

  offline = true;
  await assert.rejects(client.purgeAudio(id), /offline/);
  await assert.rejects(client.playback(id), {code: 'NOT_FOUND'});
  assert.equal(objects.size, 1);
  offline = false;
  await client.purgeAudio(id);
  await client.purgeAudio(id);
  assert.equal(objects.size, 0);
  await assert.rejects(readFile(join(song, 'score.abc')), {code: 'ENOENT'});
});
