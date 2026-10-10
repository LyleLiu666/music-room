import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, rmSync, writeFileSync, readFileSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {ResourceLease, processIdentity} from './lease.ts';
function fixture() {const directory = mkdtempSync(join(tmpdir(), 'music-lease-')); return {directory, path: join(directory, 'heavy-task.json'),
  a: new ResourceLease(directory), b: new ResourceLease(directory), close: () => rmSync(directory, {recursive: true, force: true})};}
test('two workspaces share one lease and can hand it back after cleanup', () => {
  const f = fixture(); try {assert.equal(f.a.acquire(), true); assert.equal(f.a.acquire(), true);
    assert.equal(f.b.acquire(), false); f.a.release(); assert.equal(f.b.acquire(), true); f.b.release();} finally {f.close();}
});
test('dead parent cannot release a lease while its registered supervisor still lives', async () => {
  const f = fixture(), child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']); await once(child, 'spawn');
  try {
    writeFileSync(f.path, JSON.stringify({version: 1, owner: 'stale', parent: {pid: 99999999, started: 'dead'}, workers: [processIdentity(child.pid!)!]}));
    assert.equal(f.b.acquire(), false); child.kill('SIGKILL'); await once(child, 'close');
    assert.equal(f.b.acquire(), true); f.b.release();
  } finally {child.kill('SIGKILL'); f.close();}
});
test('registered process must actually exit before release; repeated release is harmless', async () => {
  const f = fixture(), child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']); await once(child, 'spawn');
  try {f.a.acquire(); f.a.track(child.pid!); assert.throws(() => f.a.release(), /尚未退出/);
    assert.equal(f.b.acquire(), false); child.kill('SIGKILL'); await once(child, 'close'); f.a.release(); f.a.release();
    assert.equal(f.b.acquire(), true); f.b.release();} finally {child.kill('SIGKILL'); f.close();}
});
test('PID reused by an unrelated process is not killed or mistaken for original owner', () => {
  const f = fixture(); try {
    const identity = processIdentity(process.pid)!;
    writeFileSync(f.path, JSON.stringify({version: 1, owner: 'stale', parent: {...identity, started: 'different start time'}, workers: []}));
    assert.equal(f.a.acquire(), true); process.kill(process.pid, 0); f.a.release();
  } finally {f.close();}
});
test('corrupt and symlinked leases block recovery rather than delete unknown data', () => {
  const f = fixture(); try {
    writeFileSync(f.path, '{'); assert.throws(() => f.a.acquire()); assert.equal(readFileSync(f.path, 'utf8'), '{');
    rmSync(f.path); const original = join(f.directory, 'original'); writeFileSync(original, 'keep'); symlinkSync(original, f.path);
    assert.throws(() => f.a.acquire(), /符号链接/); assert.equal(readFileSync(original, 'utf8'), 'keep');
  } finally {f.close();}
});
test('an orphan model in a registered group blocks recovery after the supervisor exits', async () => {
 const f=fixture();
 const source=`const {spawn}=require('node:child_process');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});process.stdout.write(String(child.pid)+'\\n');setInterval(()=>{},1000);`;
 const supervisor=spawn(process.execPath,['-e',source],{detached:true,stdio:['ignore','pipe','pipe']});const ready=once(supervisor.stdout,'data');await once(supervisor,'spawn');let modelPid:number|undefined;
 try{f.a.acquire();f.a.track(supervisor.pid!);modelPid=Number((await ready)[0].toString().trim());
  assert.ok(modelPid);supervisor.kill('SIGKILL');await once(supervisor,'close');
  const r=JSON.parse(readFileSync(f.path,'utf8'));r.parent={pid:99999999,started:'dead'};writeFileSync(f.path,JSON.stringify(r));
  assert.equal(f.b.acquire(),false,'exited group leader alone is not release proof');process.kill(modelPid!,'SIGKILL');
  for(let i=0;i<100&&processIdentity(modelPid!);i++)await new Promise(r=>setTimeout(r,5));
  assert.equal(f.b.acquire(),true);f.b.release();
 }finally{if(modelPid)try{process.kill(modelPid,'SIGKILL');}catch{}supervisor.kill('SIGKILL');f.close();}
});
