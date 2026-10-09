import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemo, createProject, createSound, startVersion, finishVersion, deleteVersion, restoreVersion, activeVersions, setFinal, recoverJobs } from '../public/prototypes/sound-first/model.mjs';

test('a project contains independent sounds, each with independent versions', () => {
  const state=createDemo(); const project=createProject(state,'新项目');
  const riff=createSound(project,{title:'开场',kind:'clip'}),speech=createSound(project,{title:'旁白',kind:'speech'});
  const a=startVersion(riff,'温暖'), b=startVersion(speech,'欢迎回来');
  finishVersion(state,project.id,riff.id,a.id,'done');
  assert.equal(a.status,'done'); assert.equal(b.status,'running'); assert.equal(project.sounds.length,2);
  assert.equal(state.projects[0].sounds[0].versions.length,2);
});
test('deletion is reversible and preserves child provenance, favourites and unique numbering',()=>{
  const state=createDemo(),sound=state.projects[0].sounds[0],first=sound.versions[0];first.kept=true;
  setFinal(sound,first.id);const child=startVersion(sound,'改一点',first.id);finishVersion(state,state.projects[0].id,sound.id,child.id,'done');
  deleteVersion(sound,first.id);assert.equal(sound.finalId,null);assert.equal(child.parentId,first.id);assert.equal(activeVersions(sound).includes(first),false);
  const next=startVersion(sound,'再试一次');assert.equal(next.number,4);
  restoreVersion(sound,first.id);assert.equal(first.kept,true);assert.equal(activeVersions(sound).length,4);assert.equal(sound.finalId,null);
});
test('only completed visible versions can be final; starting again never replaces final',()=>{
  const s=createDemo().projects[0].sounds[0];setFinal(s,s.versions[0].id);const final=s.finalId;
  const v=startVersion(s,'新尝试');assert.throws(()=>setFinal(s,v.id));assert.equal(s.finalId,final);
  assert.throws(()=>deleteVersion(s,v.id));
});
test('late results cannot revive cancelled jobs or update another selected sound',()=>{
  const state=createDemo(),project=state.projects[0],s=project.sounds[0],v=startVersion(s,'尝试');
  finishVersion(state,project.id,s.id,v.id,'cancelled');finishVersion(state,project.id,s.id,v.id,'done');assert.equal(v.status,'cancelled');
  const pending=startVersion(s,'重试');recoverJobs(state);assert.equal(pending.status,'failed');assert.match(pending.error,/中断/);
});
test('empty names are rejected without creating empty projects or sounds',()=>{
  const state=createDemo();assert.throws(()=>createProject(state,'  '));assert.throws(()=>createSound(state.projects[0],{title:'',kind:'clip'}));
});
