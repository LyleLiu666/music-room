import {readFileSync,existsSync,lstatSync,realpathSync,unlinkSync,mkdirSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {StdioServerTransport} from '@modelcontextprotocol/sdk/server/stdio.js';
import {MusicService,type ServiceCaller} from '../service/service.ts';
import {processRenderer} from '../service/render/process.ts';
import {runRenderWorker} from '../service/render/worker.ts';
import {musicMcp} from '../interfaces/mcp.ts';
import {parseOperation} from '../interfaces/operations.ts';
import {serveHttp,type Runtime,type WebAssets} from './http.ts';
export async function remoteCall(runtime:Runtime,name:string,args:Record<string,unknown>) {
  const response=await fetch(`${runtime.url}/api/${name}`,{method:'POST',headers:{'content-type':'application/json',authorization:`Bearer ${runtime.token}`},body:JSON.stringify(args),signal:AbortSignal.timeout(30000)});
  const value=await response.json() as any;if(!response.ok){const e=new Error(value.message) as Error&{code:string};e.code=value.code;throw e;}return value;
}
export function readRuntime(directory:string):Runtime|undefined {
  const root=realpathSync(directory),file=join(root,'.music-room.runtime.json');
  if(!existsSync(file))return;
  if(lstatSync(file).isSymbolicLink())throw new Error('运行描述文件不能是符号链接');
  const r=JSON.parse(readFileSync(file,'utf8')) as Runtime;
  if(r.workspace!==root || !/^http:\/\/127\.0\.0\.1:\d+$/.test(r.url) || !/^[a-f0-9]{64}$/.test(r.token) || !Number.isInteger(r.pid)||r.pid<=0)throw new Error('运行描述文件无效');
  try {process.kill(r.pid,0);} catch(e:any){if(e.code==='ESRCH')return;throw e;}return r;
}
function options(argv:string[]) {
  const mode=argv[0]??'serve',args=argv.slice(1),out:Record<string,string>={};
  if(!['serve','mcp','status','call','--help','help','render-worker'].includes(mode))throw new Error('未知命令，请运行 --help');
  if(mode==='call'){out.operation=args.shift()??'';}
  for(let i=0;i<args.length;i+=2){if(!['--workspace','--port','--input'].includes(args[i]) || !args[i+1] || args[i+1].startsWith('--'))throw new Error('参数无效：'+args[i]);out[args[i].slice(2)]=args[i+1];}
  const port=out.port===undefined?0:Number(out.port);if(!Number.isInteger(port)||port<0||port>65535)throw new Error('端口必须在 0–65535');
  return {mode,workspace:resolve(out.workspace??join(homedir(),'Music','MusicRoom')),port,input:out.input,operation:out.operation};
}
export async function main(argv:string[],assets:WebAssets,selfArgs:string[]) {
  const opt=options(argv);
  if(opt.mode==='help'||opt.mode==='--help'){console.log('Music Room\n  serve [--workspace DIRECTORY] [--port PORT]\n  mcp [--workspace DIRECTORY]  # stdio MCP; connects to or starts local service\n  status [--workspace DIRECTORY]\n  call OPERATION --input request.json [--workspace DIRECTORY]\nDefault workspace: ~/Music/MusicRoom. No Electron, browser runtime or model download.');return;}
  if(opt.mode==='render-worker'){await runRenderWorker(assets.read);return;}
  mkdirSync(opt.workspace,{recursive:true,mode:0o700});
  let runtime=readRuntime(opt.workspace);
  let owned: {service:MusicService;http:Awaited<ReturnType<typeof serveHttp>>}|undefined;
  let closing=false;
  const cleanup=async()=> {
    if(closing)return;closing=true;
    if(owned){
      const file=owned.service.store.path('.music-room.runtime.json');
      if(existsSync(file)&&JSON.parse(readFileSync(file,'utf8')).token===owned.http.runtime.token)unlinkSync(file);
      await owned.service.jobs.close();await owned.http.close();await owned.service.store.close();
    }
  };
  if(!runtime && (opt.mode==='serve'||opt.mode==='mcp')) {
    const renderer=processRenderer(process.execPath,[...selfArgs,'render-worker']);
    for(let attempt=0;attempt<30 && !runtime;attempt++) {
      let service: MusicService;
      try {service=await MusicService.open(opt.workspace,renderer,assets.read);}
      catch(error:any) {
        if(error.code!=='WORKSPACE_LOCKED')throw error;
        // Another agent can own the lock before it has published the HTTP descriptor.
        await new Promise(r=>setTimeout(r,100));runtime=readRuntime(opt.workspace);continue;
      }
      try {
        const http=await serveHttp(service,assets,opt.port,process.execPath,selfArgs);owned={service,http};runtime=http.runtime;
        service.store.atomicJSON(service.store.path('.music-room.runtime.json'),runtime);
      }catch(e){if(owned)await owned.http.close();await service.close();throw e;}
    }
  }
  if(!runtime)throw new Error('没有正在运行的服务。请先运行 music-room serve --workspace <目录>');
  const endpoint=runtime;
  const call:ServiceCaller=(name,args)=>remoteCall(endpoint,name,parseOperation(name,args));
  // A live PID does not guarantee the descriptor belongs to a usable service.
  try {await call('status',{});}catch(error){await cleanup();throw error;}
  if(opt.mode==='status'||opt.mode==='call') {
    const args=opt.input?JSON.parse(await readFile(opt.input,'utf8')):{};
    console.log(JSON.stringify(await call(opt.mode==='status'?'status':opt.operation,args),null,2));return;
  }
  if(opt.mode==='serve'&&!owned){console.log(JSON.stringify({url:endpoint.url,workspace:endpoint.workspace,reused:true}));return;}
  const shutdown=()=>{void cleanup().then(()=>process.exit(0),error=>{console.error(error);process.exit(1);});};
  process.once('SIGINT',shutdown);process.once('SIGTERM',shutdown);
  if(opt.mode==='mcp') {
    console.error(`Music Room: ${endpoint.url} (workspace ${endpoint.workspace})`);
    const server=musicMcp(call),transport=new StdioServerTransport();
    server.server.onclose=shutdown;await server.connect(transport);
  } else console.log(JSON.stringify({url:endpoint.url,workspace:endpoint.workspace,mcp:`${endpoint.url}/mcp`}));
}
