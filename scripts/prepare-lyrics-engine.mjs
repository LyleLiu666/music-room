// Reuse explicitly supplied local Qwen models and Python environment; no network downloads.
import {cp,mkdir,readFile,writeFile,rename,rm,realpath,stat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const [workspace,environment,asr,aligner]=process.argv.slice(2);if(!aligner)throw Error('Usage: node scripts/prepare-lyrics-engine.mjs WORKSPACE VENV ASR_MODEL ALIGNER_MODEL');
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('当前歌词引擎仅验证了 Apple Silicon macOS');
const parent=join(resolve(workspace),'engines'),target=join(parent,'lyrics'),staging=target+'.preparing';await mkdir(parent,{recursive:true});
if(await stat(target).catch(()=>null))throw Error('歌词引擎已经存在，未覆盖');
await mkdir(staging);try{
 for(const [source,name] of [[environment,'venv'],[asr,'asr-model'],[aligner,'aligner-model']])await cp(await realpath(source),join(staging,name),{recursive:true,mode:constants.COPYFILE_FICLONE,verbatimSymlinks:true});
 for(const name of ['asr-model','aligner-model'])JSON.parse(await readFile(join(staging,name,'config.json'),'utf8'));
 execFileSync(join(staging,'venv/bin/python'),['-c','import qwen_asr, torch, soundfile, psutil; assert torch.backends.mps.is_available()'],{stdio:'inherit',timeout:180000,env:{...process.env,HF_HUB_OFFLINE:'1',TRANSFORMERS_OFFLINE:'1'}});
 await writeFile(join(staging,'installed.json'),JSON.stringify({version:1,backend:'qwen3-asr-0.6b-and-forced-aligner-0.6b',platform:process.platform,arch:process.arch,installedAt:new Date().toISOString()},null,2));await rename(staging,target);console.log(target);
}catch(error){await rm(staging,{recursive:true,force:true});throw error;}
