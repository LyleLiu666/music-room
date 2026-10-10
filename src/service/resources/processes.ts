import {execFileSync} from 'node:child_process';
/** Read the OS process protocol, not a process-name heuristic. Zombies no longer hold model memory. */
export function groupMembers(group: number) {
  const output=execFileSync('/bin/ps',['-axo','pid=,pgid=,stat='],{encoding:'utf8',timeout:2000,maxBuffer:4*1024*1024});
  return output.trim().split('\n').flatMap(line=>{
    const [pid,pgid,state]=line.trim().split(/\s+/);
    return Number(pgid)===group&&!state?.startsWith('Z')?[Number(pid)]:[];
  });
}
/** In managed mode every workload inherits its already registered supervisor group. */
export function signalWorkload(childPid:number|undefined,managed:boolean,signal:NodeJS.Signals){
  if(!childPid)return;
  if(!managed){try{process.kill(-childPid,signal);}catch(error:any){if(error.code!=='ESRCH')throw error;}return;}
  for(const pid of groupMembers(process.pid))if(pid!==process.pid){
    try{process.kill(pid,signal);}catch(error:any){if(error.code!=='ESRCH')throw error;}
  }
}
