// Read-only verification of completed, real trial jobs. Never schedules inference.
import {readFileSync,existsSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {homedir} from 'node:os';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=process.argv[2]||join(homedir(),'Music/MusicRoom/experiments/yue2');
const state=JSON.parse(readFileSync(join(root,'index.json')));
const plans=state.jobs.filter(j=>j.kind==='plan'&&j.status==='succeeded');
const renders=state.jobs.filter(j=>j.kind==='render'&&j.status==='succeeded');
assert.ok(plans.length,'Need a completed real plan');assert.ok(renders.length,'Need a completed real render');
const digest=s=>createHash('sha256').update(s).digest('hex');
const results={plans:[],renders:[]};
for(const job of plans){const path=join(root,'jobs',job.id),plan=JSON.parse(readFileSync(join(path,'plan/plan.json')));assert.equal(existsSync(join(path,'song')),false,'Plan-only must not produce audio stages');assert.equal(plan.truncated,false);assert.equal(state.versions.find(v=>v.id===job.resultVersion).hash,digest(plan.abc));results.plans.push({id:job.id,abcTokens:plan.abc_ids.length,planOnly:true});}
for(const job of renders){const path=join(root,'jobs',job.id),score=readFileSync(join(path,'song/score.abc')),summary=JSON.parse(readFileSync(join(path,'summary.json'))),request=JSON.parse(readFileSync(join(path,'request.json')));assert.equal(digest(score),job.hash);assert.equal(digest(request.request.params.abc),job.hash);const audio=readFileSync(join(path,'song/audio.flac'));assert.equal(audio.subarray(0,4).toString(),'fLaC');assert.ok(statSync(join(path,'song/audio.flac')).size>1000);if(job.input.instrumental){assert.equal(request.request.params.cfg_scale,2);assert.deepEqual(request.request.loras.map(x=>x.name),['ar_lora_inst_v3abc.bf16','nar_lora_joint_v4.bf16']);assert.match(request.request.params.lyrics,/^(?:\s*\[[a-z][a-z0-9 _-]*\]\s*)+$/i);}results.renders.push({id:job.id,scoreHash:job.hash,seconds:summary.seconds,truncated:summary.truncated,seed:summary.seed,preset:summary.preset});}
console.log(JSON.stringify(results,null,2));
