import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink, rename } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ProjectStore } from './store.ts';
const example = JSON.parse(await readFile(new URL('../../music/authoring/example.json', import.meta.url), 'utf8'));
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'music-store-'));
  const store = await ProjectStore.open(root);
  t.after(async () => { await store.close(); await rm(root, {recursive:true,force:true}); });
  return {root,store};
}
test('project import publishes immutable versions, explicit parents, feedback and restart', async t => {
  const {root,store} = await fixture(t);
  await store.importRevision(example);
  await store.importRevision({...example,revision:{id:'window-study-v2',label:'回答变化'}}, example.revision.id);
  const project = await store.project('window-study');
  assert.equal(project.revisions.length,2); assert.equal(project.revisions[1].parentId,example.revision.id);
  await assert.rejects(store.importRevision(example), /已存在/);
  await assert.rejects(store.importRevision({...example,revision:{id:'window-study-v3',label:'bad'}},'missing'), /父版本/);
  await store.addFeedback('window-study','window-study-v1','保留 riff，鼓轻一些',{start:0,end:5});
  assert.equal((await store.feedback('window-study'))[0].text,'保留 riff，鼓轻一些');
  await store.close(); const reopened = await ProjectStore.open(root);
  assert.equal((await reopened.documents()).length,2);
  assert.equal((await reopened.revision('window-study','window-study-v1')).composition.score.notes.length,example.score.notes.length);
  await reopened.close();
});
test('single writer, concurrent identities and explicit title/parent checks', async t => {
  const {root,store} = await fixture(t);
  await assert.rejects(ProjectStore.open(root), /正在使用/);
  const results = await Promise.allSettled([store.importRevision(example),store.importRevision(example)]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  await assert.rejects(store.importRevision({...example,work:{...example.work,title:'另一首'},score:{...example.score,title:'另一首'},revision:{id:'different',label:'x'}}),/标题/);
  await assert.rejects(store.createProject('../escape','bad'),/ID/);
  await assert.rejects(store.addFeedback('window-study','window-study-v1','',{start:0,end:1}),/反馈/);
  await assert.rejects(store.addFeedback('window-study','window-study-v1','x',{start:4,end:30}),/范围/);
});
test('write failures and tampered source do not silently publish or overwrite', async t => {
  const {root,store} = await fixture(t);
  await store.importRevision(example);
  const before = await readFile(join(root,'projects/window-study/project.json'),'utf8');
  const blocked = join(root,'projects/window-study/revisions/window-study-v2');
  await symlink(tmpdir(),blocked);
  await assert.rejects(store.importRevision({...example,revision:{id:'window-study-v2',label:'x'}}),/链接|已存在/);
  assert.equal(await readFile(join(root,'projects/window-study/project.json'),'utf8'),before);
  await writeFile(join(root,'projects/window-study/revisions/window-study-v1/score.json'),'{}');
  await assert.rejects(store.revision('window-study','window-study-v1'),/原件|哈希/);
});
test('moved projects keep relative files; duplicate version ID across projects is rejected', async t => {
  const {store} = await fixture(t);
  await store.importRevision(example);
  await assert.rejects(store.importRevision({...example,work:{id:'other',title:'窗边练习'}}),/已存在/);
  assert.equal((await store.project('window-study')).revisions[0].scorePath,'revisions/window-study-v1/score.json');
});

test('manifest commit failure rolls back only the unpublished new version', async t => {
  const {root,store} = await fixture(t);
  await store.importRevision(example);
  const before = await readFile(join(root,'projects/window-study/project.json'),'utf8');
  const original = store.atomicJSON.bind(store);
  store.atomicJSON = () => { throw new Error('disk full'); };
  await assert.rejects(store.importRevision({...example,revision:{id:'window-study-v2',label:'x'}}),/disk full/);
  store.atomicJSON = original;
  assert.equal(await readFile(join(root,'projects/window-study/project.json'),'utf8'),before);
  await store.importRevision({...example,revision:{id:'window-study-v2',label:'x'}});
  assert.equal((await store.project('window-study')).revisions.length,2);
});
test('copy-free workspace move and stale owner recovery', async t => {
  const {root,store} = await fixture(t); await store.importRevision(example); await store.close();
  const moved = `${root}-moved`; await rename(root,moved);
  t.after(()=>rm(moved,{recursive:true,force:true}));
  await writeFile(join(moved,'.music-room.lock'),JSON.stringify({pid:2147483647,owner:'old'}));
  const reopened = await ProjectStore.open(moved);
  try { assert.equal((await reopened.revision('window-study','window-study-v1')).composition.work.title,example.work.title); }
  finally { await reopened.close(); }
});
