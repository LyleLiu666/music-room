import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import type {Composition} from '../../music/authoring/validate.mjs';
import type {RenderMix} from './renderer.ts';
export type RenderSnapshot = {composition:Composition;mix:RenderMix};
export type RenderResult = {wav:Uint8Array;peak:number;rms:number;attenuation:number;engine:string};
export type Renderer = (snapshot:RenderSnapshot,stage:(stage:string)=>void)=>{result:Promise<RenderResult>;cancel:()=>void};
export function processRenderer(command=process.execPath,args=[fileURLToPath(new URL('./worker-entry.ts',import.meta.url))]): Renderer {
  return (snapshot,stage)=> {
    const child=spawn(command,args,{stdio:['pipe','pipe','pipe']}); let timer:ReturnType<typeof setTimeout>|undefined;
    let failure:Error|undefined;let stderr='',count=0,stats: Omit<RenderResult,'wav'>|undefined; const chunks:Buffer[]=[];
    const cancel=()=> {if(child.exitCode===null){child.kill('SIGTERM');timer??=setTimeout(()=>child.kill('SIGKILL'),1500);timer.unref();}};
    const result=new Promise<RenderResult>((resolve,reject)=> {
      child.on('error',reject);
      child.stdin.on('error',()=>{}); // early cancellation can close stdin before input drains
      child.stdout.on('data',chunk=>{count+=chunk.length;if(count>120_000_000){cancel();return;}chunks.push(chunk);});
      child.stderr.on('data',chunk=> {
        stderr+=chunk.toString();
        if(stderr.length>32000) {cancel();return;}
        let at:number;
        while((at=stderr.indexOf('\n'))>=0) {
          const line=stderr.slice(0,at);stderr=stderr.slice(at+1);
          try {const message=JSON.parse(line);if(message.stage){try{stage(String(message.stage));}catch(e){failure=e instanceof Error?e:new Error(String(e));cancel();}}if(message.result)stats=message.result;}
          catch {stderr=line+'\n'+stderr;break;}
        }
      });
      child.on('close',(code,signal)=> {
        if(timer)clearTimeout(timer);
        if(failure || code!==0 || !stats || count>120_000_000) {reject(failure??new Error(`渲染进程失败 (${signal??code}) ${stderr.slice(0,1000)}`));return;}
        resolve({...stats,wav:new Uint8Array(Buffer.concat(chunks))});
      });
      child.stdin.end(JSON.stringify(snapshot));
    });
    return {result,cancel};
  };
}
