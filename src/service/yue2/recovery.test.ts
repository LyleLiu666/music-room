import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile,rm,symlink,realpath} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir,homedir} from 'node:os';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readMusicRecovery,sameMusicGeneration} from './recovery.ts';

test('recovery advertises only committed intact stages and supports legacy plan-only output',async()=>{
 const root=await realpath(await mkdtemp(join(tmpdir(),'music-recovery-'))),id='a'.repeat(32),song=join(root,'data/songs',id),cp=join(song,'checkpoints');
 try{
  await writeFile(join(root,'.music-room-yue2.json'),JSON.stringify({format:'music-room-yue2',version:1}));await mkdir(join(song,'plan'),{recursive:true});
  const files:Record<string,string>={};for(const n of ['plan.json','abc_tokens.npy','prefix.npy','score.abc']){const value=n==='plan.json'?JSON.stringify({truncated:false}):'fixture';await writeFile(join(song,'plan',n),value);files[n]=createHash('sha256').update(value).digest('hex');}
  await writeFile(join(song,'plan/plan_manifest.json'),JSON.stringify(files));assert.equal(readMusicRecovery(root,id),'plan');
  await mkdir(join(cp,'plan'),{recursive:true});const indexed:Record<string,string>={};for(const n of [...Object.keys(files),'plan_manifest.json']){const value=await readFile(join(song,'plan',n));await writeFile(join(cp,'plan',n),value);indexed['plan/'+n]=createHash('sha256').update(value).digest('hex');}
  await mkdir(join(cp,'semantic'));await writeFile(join(cp,'semantic/result.json'),'{}');indexed['semantic/result.json']=createHash('sha256').update('{}').digest('hex');
  await writeFile(join(cp,'state.json'),JSON.stringify({version:1,stage:'semantic',fingerprint:'a'.repeat(64),files:indexed}));assert.equal(readMusicRecovery(root,id),'semantic');
  await writeFile(join(cp,'semantic/result.json'),'corrupt');assert.equal(readMusicRecovery(root,id),undefined);
  await rm(join(cp,'semantic/result.json'));await symlink(join(song,'plan/plan.json'),join(cp,'semantic/result.json'));assert.equal(readMusicRecovery(root,id),undefined);
 }finally{await rm(root,{recursive:true,force:true});}
});
test('recovery matches exact generation inputs, including mode, lyrics, score, seed and target',()=>{
 const a={style:'piano',lyrics:'[instrumental]',instrumental:true,preset:'fast' as const,seed:42};
 assert.equal(sameMusicGeneration(a,{...a,title:'renamed',ending:'natural'}),true);
 for(const change of [{instrumental:false},{lyrics:'other'},{style:'other'},{seed:43},{targetDuration:180},{abc:'score'},{preset:'quality' as const}])assert.equal(sameMusicGeneration(a,{...a,...change}),false);
});
test('pinned Python stage checkpoints survive interrupted jobs without redoing completed stages',t=>{
 const python=process.env.MUSIC_ROOM_YUE2_PYTHON??join(homedir(),'Music/YuE2/.venv/bin/python');
 if(!existsSync(python)){t.skip('Pinned YuE2 Python with NumPy is not installed; run recovery_runtime_test.py there.');return;}
 execFileSync(python,['-B','src/service/yue2/recovery_runtime_test.py'],{stdio:'pipe'});
});
