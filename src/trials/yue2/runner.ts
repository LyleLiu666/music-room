import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createResources} from '../../service/resources/runtime.ts';
import {ownedCommand} from '../../service/resources/commands.ts';
import {inspectMusicContext} from '../../service/yue2/context.ts';
import {yueProfile} from '../../service/resources/profiles.ts';
import type {Job} from './trials.ts';
export function createRunner(root:string){
 const resources=createResources();resources.register('yue2',{resident:()=>undefined,unload:async()=>{}});
 return {close:()=>resources.close(),status:()=>resources.status(),run:async(job:Job,path:string,signal:AbortSignal,report:(s:string)=>void,status:(s:string)=>void)=>{
  const installed=JSON.parse(readFileSync(join(root,'installed.json'),'utf8'));
  if(installed.revision!==yueProfile.revision||installed.directory!==root)throw Error('试用仅支持已锁定的本机 YuE2 版本');
  const context=await inspectMusicContext(root,{...job.input,ending:'as-described',abc:job.request.params.abc});if(context.issue)throw Error(context.issue);
  await resources.run({id:job.id,engine:'yue2',signal,demand:resources.estimate('yue2',{resourceProfile:yueProfile,...job.input,context}),onState:s=>status(s.stage),execute:async execution=>{
   execution.running();await ownedCommand(join(root,'.venv/bin/python'),['-B',fileURLToPath(new URL('./model.py',import.meta.url)),root,path,String(execution.budgets.memory/2**30)],path,{...execution,report});
  }});
 }};
}
