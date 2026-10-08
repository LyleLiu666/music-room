import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runtimeEnvironment,workerCommand} from './worker.ts';
import {cleanDownloadPartials} from './runtime.ts';

test('all engine caches, Python and temporary files stay in selected directory; credentials are not inherited',()=>{
  const root='/tmp/用户选择 YuE2';
  const env=runtimeEnvironment(root,{HOME:'/Users/test',ANTHROPIC_API_KEY:'secret',HF_TOKEN:'secret',HTTPS_PROXY:'http://proxy'});
  for(const name of ['UV_CACHE_DIR','UV_PYTHON_INSTALL_DIR','HF_HOME','HF_HUB_CACHE','HF_XET_CACHE','TMPDIR','PYTHONPYCACHEPREFIX','YUE2_STUDIO_HOME'])assert.ok(env[name]!.startsWith(root+'/')||env[name]===root,name);
  assert.equal(env.HOME,'/Users/test');assert.equal(env.ANTHROPIC_API_KEY,undefined);assert.equal(env.HF_TOKEN,undefined);assert.equal(env.HTTPS_PROXY,'http://proxy');
});
test('loss of parent stdin stops the owned process tree, including a child process',async()=>{
  const root=mkdtempSync(join(tmpdir(),'yue2 parent lease '));
  let worker:ReturnType<typeof spawn>|undefined;
  try{
    mkdirSync(join(root,'bin'));writeFileSync(join(root,'.music-room-yue2.lock'),JSON.stringify({pid:process.pid,owner:'lease'}));
    writeFileSync(join(root,'bin','uv'),'#!/bin/sh\nsleep 60 &\nprintf "%s" "$!" > child.pid\nwait\n',{mode:0o755});
    const child=spawn(process.execPath,[fileURLToPath(new URL('./worker-entry.ts',import.meta.url))],{stdio:['pipe','pipe','pipe']});
    worker=child;let diagnostics='';child.stderr.on('data',chunk=>diagnostics+=chunk);
    const closed=new Promise<number|null>(resolve=>child.once('close',resolve));child.stdin.write(JSON.stringify({directory:root,owner:'lease',step:'venv'})+'\n');
    for(let n=0;!existsSync(join(root,'child.pid'))&&n<500;n++)await new Promise(r=>setTimeout(r,20));
    assert.ok(existsSync(join(root,'child.pid')),diagnostics);const pid=Number(readFileSync(join(root,'child.pid'),'utf8'));
    child.stdin.end();await closed;
    for(let n=0;n<50;n++){try{process.kill(pid,0);}catch{return;}await new Promise(r=>setTimeout(r,20));}
    assert.fail('owned child survived parent stdin closing');
  }finally{worker?.stdin?.end();rmSync(root,{recursive:true,force:true});}
});
test('worker uses only fixed commands and requires ownership of the managed directory',()=>{
  const root=mkdtempSync(join(tmpdir(),'yue2 worker '));
  try{
    const task={directory:root,step:'venv' as const,owner:'test-owner'};
    assert.throws(()=>workerCommand(task),/所属/);
    writeFileSync(join(root,'.music-room-yue2.lock'),JSON.stringify({pid:process.pid,owner:task.owner}));
    mkdirSync(join(root,'bin'));const command=workerCommand(task);
    assert.equal(command.command,join(root,'bin','uv'));assert.deepEqual(command.args.slice(0,4),['venv','--managed-python','--python','3.12']);
    assert.equal(command.args.at(-1),join(root,'.venv'));
    assert.throws(()=>workerCommand({...task,step:'rm' as any}),/Invalid option/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('retry removes abandoned model download partials while preserving completed weights and other files',()=>{
  const root=mkdtempSync(join(tmpdir(),'yue2 partials ')),downloads=join(root,'models','converted','.cache','huggingface','download');
  try{mkdirSync(downloads,{recursive:true});writeFileSync(join(downloads,'abandoned.incomplete'),'partial');writeFileSync(join(downloads,'weights.metadata'),'metadata');writeFileSync(join(root,'models','converted','ar-8bit.safetensors'),'complete');writeFileSync(join(root,'keep.incomplete'),'unrelated');cleanDownloadPartials(root);assert.equal(existsSync(join(downloads,'abandoned.incomplete')),false);assert.ok(existsSync(join(downloads,'weights.metadata')));assert.ok(existsSync(join(root,'models','converted','ar-8bit.safetensors')));assert.ok(existsSync(join(root,'keep.incomplete')));}finally{rmSync(root,{recursive:true,force:true});}
});
