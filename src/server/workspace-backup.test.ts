import test, {type TestContext} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createServer} from 'node:net';
import {cp, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectStore} from '../service/projects/store.ts';
import {createWorkspaceBackup, verifyWorkspaceBackup, WorkspaceBackupError} from './workspace-backup.ts';

const historical = new URL('../../tests/fixtures/workspace-2026-10-10/', import.meta.url);
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
async function fixture(t: TestContext) {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'music-backup-test-'));
  const source = join(root, 'source'), destination = join(root, 'backup');
  await mkdir(source);
  t.after(() => rm(root, {recursive: true, force: true}));
  return {root, source, destination};
}
async function put(root: string, path: string, bytes: string | Uint8Array) {
  const parts = path.split('/');
  await mkdir(join(root, ...parts.slice(0, -1)), {recursive: true});
  await writeFile(join(root, ...parts), bytes);
}
async function inventory(root: string, prefix = ''): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const name of (await readdir(join(root, prefix))).sort()) {
    const path = prefix ? `${prefix}/${name}` : name, stat = await lstat(join(root, path));
    result[path] = stat.isDirectory() ? 'directory' : digest(await readFile(join(root, path)));
    if (stat.isDirectory()) Object.assign(result, await inventory(root, path));
  }
  return result;
}
async function rejectsCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => {
    assert.ok(error instanceof WorkspaceBackupError);
    assert.equal(error.code, code);
    return true;
  });
}
async function assertAbsent(path: string) {
  await assert.rejects(lstat(path), {code: 'ENOENT'});
}

test('complete pinned historical workspace, unknown data, empty directories and large audio are copied byte-exactly without source changes', async t => {
  const {source, destination} = await fixture(t);
  await cp(new URL('workspace/', historical), source, {recursive: true});
  await mkdir(join(source, 'empty-history'));
  await put(source, 'future-format/history.json', '{"decisions":["keep","delete"],"parent":"old"}');
  await put(source, 'audio/master.wav', Buffer.alloc(3 * 1024 * 1024 + 17, 0xa7));
  await put(source, 'music-room.log', 'historical diagnostics');
  await put(source, 'credentials.json', '{"token":"private-backup-fixture-secret"}');
  await put(source, 'manifest.json', 'user-owned manifest must not be replaced');
  const before = await inventory(source), provenance = JSON.parse(await readFile(new URL('provenance.json', historical), 'utf8'));
  const result = await createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination});
  assert.equal(result.backupDirectory, destination);
  assert.equal(result.workspaceDirectory, join(destination, 'workspace'));
  assert.equal(result.manifestPath, join(destination, 'manifest.json'));
  assert.deepEqual(await inventory(result.workspaceDirectory), before);
  assert.deepEqual(await inventory(source), before);
  for (const [path, expected] of Object.entries(provenance.sha256)) {
    const original = await readFile(join(source, path)), copied = await readFile(join(result.workspaceDirectory, path));
    assert.equal(digest(copied), expected);
    assert.deepEqual(copied, original);
  }
  const manifestText = await readFile(result.manifestPath, 'utf8'), manifest = JSON.parse(manifestText);
  assert.equal(manifest.format, 'music-room-workspace-backup');
  assert.equal(manifest.version, 1);
  assert.equal(manifestText.includes(source), false);
  assert.equal(manifestText.includes('private-backup-fixture-secret'), false);
  const files = manifest.entries.filter((entry: {type: string}) => entry.type === 'file');
  assert.equal(result.fileCount, files.length);
  assert.equal(result.totalBytes, files.reduce((sum: number, entry: {bytes: number}) => sum + entry.bytes, 0));
  for (const entry of files) {
    const bytes = await readFile(join(source, entry.path));
    assert.equal(entry.bytes, bytes.length);
    assert.equal(entry.sha256, digest(bytes));
  }
  assert.deepEqual(await verifyWorkspaceBackup(destination), result);
});

test('rejects actual ProjectStore ownership before HTTP runtime is published; does not touch the source', async t => {
  const {source, destination} = await fixture(t), store = await ProjectStore.open(source);
  try {
    const before = await inventory(source);
    await rejectsCode(createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination}), 'WORKSPACE_RUNNING');
    assert.deepEqual(await inventory(source), before);
    await assertAbsent(destination);
  } finally { await store.close(); }
});

test('live runtime PID is refused even without a lock or responsive HTTP service', async t => {
  const {source, destination} = await fixture(t);
  const token = 'a'.repeat(64);
  await put(source, '.music-room.runtime.json', JSON.stringify({pid: process.pid, workspace: source, url: 'http://127.0.0.1:1', token}));
  await assert.rejects(createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination}), (error: unknown) => {
    assert.ok(error instanceof WorkspaceBackupError);
    assert.equal(error.code, 'WORKSPACE_RUNNING');
    assert.equal(error.message.includes(token), false);
    assert.equal(error.message.includes(source), false);
    return true;
  });
  await assertAbsent(destination);
});

test('stale runtime and owner markers are the only exclusions and never leak their credentials', async t => {
  const {source, destination} = await fixture(t), token = 'b'.repeat(64);
  await put(source, '.music-room.lock', JSON.stringify({pid: 2147483647, owner: 'old-owner-secret'}));
  await put(source, '.music-room.runtime.json', JSON.stringify({pid: 2147483647, workspace: source, url: 'http://127.0.0.1:1', token}));
  await put(source, 'nested/.music-room.runtime.json', 'user data, not a root runtime marker');
  await put(source, '.hidden-file', 'keep');
  const before = await inventory(source), result = await createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination});
  assert.deepEqual(await inventory(source), before);
  await assertAbsent(join(result.workspaceDirectory, '.music-room.lock'));
  await assertAbsent(join(result.workspaceDirectory, '.music-room.runtime.json'));
  assert.equal(await readFile(join(result.workspaceDirectory, 'nested/.music-room.runtime.json'), 'utf8'), 'user data, not a root runtime marker');
  const text = await readFile(result.manifestPath, 'utf8');
  assert.equal(text.includes(token), false);
  assert.equal(text.includes('old-owner-secret'), false);
  assert.deepEqual(JSON.parse(text).excludedRuntimeFiles, ['.music-room.lock', '.music-room.runtime.json']);
});

for (const marker of ['.music-room.lock', '.music-room.runtime.json', '.music-room.recovery']) {
  test(`malformed/uncertain ownership fails closed: ${marker}`, async t => {
    const {source, destination} = await fixture(t);
    await put(source, marker, 'secret-invalid-json');
    await rejectsCode(createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination}), 'WORKSPACE_STATE_UNSAFE');
    await assertAbsent(destination);
  });
}

test('refuses equal/nested destinations and source-inside-destination; no source writes', async t => {
  const {root, source} = await fixture(t);
  await put(source, 'history.json', 'keep');
  const before = await inventory(source);
  for (const destination of [source, join(source, 'backup'), join(source, 'new/deep-backup'), root]) {
    await rejectsCode(createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination}), 'UNSAFE_PATH');
    assert.deepEqual(await inventory(source), before);
  }
});

for (const kind of ['empty-directory', 'nonempty-directory', 'file', 'symlink'] as const) {
  test(`never overwrites an existing destination: ${kind}`, async t => {
    const {root, source, destination} = await fixture(t);
    await put(source, 'data', 'new');
    if (kind === 'file') await writeFile(destination, 'old');
    else if (kind === 'symlink') await symlink(source, destination);
    else { await mkdir(destination); if (kind === 'nonempty-directory') await put(destination, 'keep', 'old'); }
    const stat = await lstat(destination);
    await rejectsCode(createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination}), 'DESTINATION_EXISTS');
    assert.equal((await lstat(destination)).ino, stat.ino);
    assert.deepEqual((await readdir(root)).sort(), ['backup', 'source']);
    if (kind === 'file') assert.equal(await readFile(destination, 'utf8'), 'old');
    if (kind === 'nonempty-directory') assert.equal(await readFile(join(destination, 'keep'), 'utf8'), 'old');
  });
}

for (const target of ['file', 'directory', 'broken', 'runtime-marker'] as const) {
  test(`refuses source symlinks including ${target}, without copying partial data`, async t => {
    const {root, source, destination} = await fixture(t);
    await put(source, 'ordinary', 'safe');
    const outside = join(root, 'outside');
    if (target === 'directory') await mkdir(outside);
    else if (target !== 'broken') await writeFile(outside, 'not part of workspace');
    await symlink(outside, join(source, target === 'runtime-marker' ? '.music-room.runtime.json' : 'link'));
    await rejectsCode(createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination}), 'UNSAFE_ENTRY');
    await assertAbsent(destination);
    assert.equal((await readdir(root)).some(name => name.startsWith('.music-room-backup-')), false);
  });
}

test('rejects symlink source roots and destination aliases back into source', async t => {
  const {root, source, destination} = await fixture(t), alias = join(root, 'alias');
  await symlink(source, alias);
  await rejectsCode(createWorkspaceBackup({sourceDirectory: alias, destinationDirectory: destination}), 'UNSAFE_ENTRY');
  await rejectsCode(createWorkspaceBackup({sourceDirectory: source, destinationDirectory: join(alias, 'backup')}), 'UNSAFE_PATH');
  await assertAbsent(destination);
});

test('refuses unsupported socket entries, never silently omitting them', async t => {
  const {source, destination} = await fixture(t), server = createServer();
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(join(source, 'socket'), resolve); });
  try {
    await rejectsCode(createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination}), 'UNSAFE_ENTRY');
    await assertAbsent(destination);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

for (const corruption of ['same-size-bytes', 'truncate', 'missing', 'extra-file', 'extra-directory', 'symlink', 'manifest-traversal', 'manifest-omission', 'manifest-secret-field'] as const) {
  test(`verification rejects corruption: ${corruption}; does not repair or delete anything`, async t => {
    const {root, source, destination} = await fixture(t);
    await put(source, 'audio/kept.wav', Buffer.from([0, 1, 2, 255]));
    const result = await createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination});
    const file = join(result.workspaceDirectory, 'audio/kept.wav');
    if (corruption === 'same-size-bytes') await writeFile(file, Buffer.from([0, 1, 3, 255]));
    if (corruption === 'truncate') await writeFile(file, 'x');
    if (corruption === 'missing') await rm(file);
    if (corruption === 'extra-file') await put(result.workspaceDirectory, 'unexpected', 'keep');
    if (corruption === 'extra-directory') await mkdir(join(result.workspaceDirectory, 'unexpected'));
    if (corruption === 'symlink') { await rm(file); await symlink(join(root, 'source/audio/kept.wav'), file); }
    if (corruption.startsWith('manifest-')) {
      const manifest = JSON.parse(await readFile(result.manifestPath, 'utf8'));
      if (corruption === 'manifest-traversal') manifest.entries.find((entry: {type: string}) => entry.type === 'file').path = '../source/audio/kept.wav';
      if (corruption === 'manifest-omission') manifest.entries = [];
      if (corruption === 'manifest-secret-field') manifest.token = 'must-not-be-accepted';
      await writeFile(result.manifestPath, JSON.stringify(manifest));
    }
    await assert.rejects(verifyWorkspaceBackup(destination), WorkspaceBackupError);
    assert.equal((await lstat(destination)).isDirectory(), true);
    assert.deepEqual(await readFile(join(source, 'audio/kept.wav')), Buffer.from([0, 1, 2, 255]));
  });
}

test('verification requires a committed manifest outside the copied workspace', async t => {
  const {source, destination} = await fixture(t);
  await put(source, 'data', 'keep');
  const result = await createWorkspaceBackup({sourceDirectory: source, destinationDirectory: destination});
  await rm(result.manifestPath);
  await assert.rejects(verifyWorkspaceBackup(destination), WorkspaceBackupError);
  assert.equal(await readFile(join(result.workspaceDirectory, 'data'), 'utf8'), 'keep');
});

test('restoration verifies content, opens as a real workspace and never overwrites existing work', async t => {
  const {root,source,destination}=await fixture(t);
  await cp(new URL('workspace/', historical),source,{recursive:true});
  await put(source,'future/note.txt','保留未知文件');
  await createWorkspaceBackup({sourceDirectory:source,destinationDirectory:destination});
  const restored=join(root,'restored');
  const {restoreWorkspaceBackup}=await import('./workspace-backup.ts');
  const result=await restoreWorkspaceBackup({backupDirectory:destination,destinationDirectory:restored});
  assert.equal(result.workspaceDirectory,restored);
  assert.deepEqual(await inventory(restored),await inventory(source));
  const store=await ProjectStore.open(restored);await store.close();
  const before=await inventory(restored);
  await rejectsCode(restoreWorkspaceBackup({backupDirectory:destination,destinationDirectory:restored}),'DESTINATION_EXISTS');
  assert.deepEqual(await inventory(restored),before);
  await writeFile(join(destination,'workspace/future/note.txt'),'broken');
  await rejectsCode(restoreWorkspaceBackup({backupDirectory:destination,destinationDirectory:join(root,'corrupt-restored')}),'BACKUP_CHANGED');
  await assertAbsent(join(root,'corrupt-restored'));
});

test('backup and restore preserve executable permissions needed by bundled runtimes',async t=>{
 const {root,source,destination}=await fixture(t);await put(source,'tools/worker','#!/bin/sh\nexit 0\n');
 const {chmod}=await import('node:fs/promises');await chmod(join(source,'tools/worker'),0o750);
 const {restoreWorkspaceBackup}=await import('./workspace-backup.ts');
 await createWorkspaceBackup({sourceDirectory:source,destinationDirectory:destination});
 await restoreWorkspaceBackup({backupDirectory:destination,destinationDirectory:join(root,'restored')});
 assert.equal((await lstat(join(root,'restored/tools/worker'))).mode&0o777,0o750);
});

test('CLI backup, verification and restore work without starting models or a server',async t=>{
 const {root,source,destination}=await fixture(t);await put(source,'nested/song.wav','original bytes');
 const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');const run=promisify(execFile);
 const command=new URL('./dev.ts',import.meta.url).pathname;
 const invoke=async(args:string[])=>JSON.parse((await run(process.execPath,[command,...args],{timeout:10000})).stdout);
 assert.equal((await invoke(['backup','--workspace',source,'--destination',destination])).fileCount,1);
 assert.equal((await invoke(['verify-backup','--backup',destination])).fileCount,1);
 const restored=join(root,'restored');assert.equal((await invoke(['restore-backup','--backup',destination,'--destination',restored])).workspaceDirectory,restored);
 assert.equal(await readFile(join(restored,'nested/song.wav'),'utf8'),'original bytes');
 await assertAbsent(join(source,'.music-room.runtime.json'));await assertAbsent(join(restored,'.music-room.runtime.json'));
 await assert.rejects(invoke(['restore-backup','--backup',destination,'--destination',source]));
 assert.equal(await readFile(join(source,'nested/song.wav'),'utf8'),'original bytes');
});

for(const mode of [0o444,0o400])test(`read-only ${mode.toString(8)} files survive backup and restore`,async t=>{
 const {root,source,destination}=await fixture(t);await put(source,'score.json','{}');const {chmod}=await import('node:fs/promises');await chmod(join(source,'score.json'),mode);
 const {restoreWorkspaceBackup}=await import('./workspace-backup.ts');await createWorkspaceBackup({sourceDirectory:source,destinationDirectory:destination});
 const target=join(root,'restored');await restoreWorkspaceBackup({backupDirectory:destination,destinationDirectory:target});
 assert.equal(await readFile(join(target,'score.json'),'utf8'),'{}');assert.equal((await lstat(join(target,'score.json'))).mode&0o777,mode);
});

for(const operation of ['backup','restore'] as const)test(`${operation} SIGKILL cannot strand source ownership or expose incomplete restored work`,async t=>{
 const {root,source,destination}=await fixture(t);for(let i=0;i<100;i++)await put(source,`data-${String(i).padStart(3,'0')}`,Buffer.alloc(65536,i));
 const {spawn}=await import('node:child_process'),{once}=await import('node:events');
 const target=join(root,'restored');if(operation==='restore')await createWorkspaceBackup({sourceDirectory:source,destinationDirectory:destination});
 const child=spawn(process.execPath,[new URL('./dev.ts',import.meta.url).pathname,...(operation==='backup'?['backup','--workspace',source,'--destination',destination]:['restore-backup','--backup',destination,'--destination',target])],{stdio:'ignore'});const exited=once(child,'exit');
 t.after(async()=>{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await exited;}});
 const until=Date.now()+10000;let observed=false;
 while(Date.now()<until){try{if(operation==='backup'){const lock=JSON.parse(await readFile(join(source,'.music-room.lock'),'utf8'));observed=lock.pid===child.pid;}else{await readFile(join(target,'data-000'));observed=true;}}catch{}if(observed)break;await new Promise(r=>setTimeout(r,1));}
 assert.ok(observed,'observe in-progress operation');child.kill('SIGKILL');await exited;
 if(operation==='backup'){const store=await ProjectStore.open(source);await store.close();}
 else{assert.ok((await readdir(target)).filter(n=>n.startsWith('data-')).length<100);await assert.rejects(ProjectStore.open(target),/恢复.*未完成/);}
});
