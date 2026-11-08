import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,rm,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {effectSourceIdentity} from './sound-effects-runtime.ts';

test('runtime identity detects changed executable code and refuses linked files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'sfx-identity-'));
 try{await mkdir(join(root,'models','defs'),{recursive:true});await mkdir(join(root,'scripts'));await writeFile(join(root,'models','defs','runner.py'),'x=1\n');await writeFile(join(root,'scripts','run.py'),'x=2\n');
  const original=effectSourceIdentity(root);assert.match(original,/^[a-f0-9]{64}$/);assert.equal(effectSourceIdentity(root),original);
  await writeFile(join(root,'scripts','run.py'),'x=3\n');assert.notEqual(effectSourceIdentity(root),original);await symlink(join(root,'scripts','run.py'),join(root,'scripts','injected.py'));assert.throws(()=>effectSourceIdentity(root),/符号链接/);
 }finally{await rm(root,{recursive:true,force:true});}
});

test('only the final complete worker peak record is trusted, not text echoed from the prompt',async()=>{
 const {parseEffectPeak}=await import('./sound-effects-runtime.ts');
 assert.equal(parseEffectPeak('prompt: SFX_PEAK_BYTES 9\nSFX_PEAK_BYTES 11\nnoise\nSFX_PEAK_BYTES 1700000000\n'),1700000000);
 assert.throws(()=>parseEffectPeak('prompt: SFX_PEAK_BYTES 9\n'),/峰值/);
});
