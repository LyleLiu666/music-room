import {installTask} from '../resources/installation.ts';
import {randomUUID} from 'node:crypto';
import {existsSync,lstatSync,mkdirSync,openSync,closeSync,writeFileSync,readFileSync,readdirSync,realpathSync,unlinkSync} from 'node:fs';
import {isAbsolute,join} from 'node:path';
import {homedir} from 'node:os';
import type {ResourceCoordinator} from '../resources/coordinator.ts';
import type {ResourceExecution} from '../resources/contracts.ts';
import type {YuE2Job} from './contracts.ts';
import {ProjectStore,ServiceError} from '../projects/store.ts';

export type YuE2Phase='uninstalled'|'preparing'|'stopped'|'starting'|'running'|'stopping'|'failed'|'unsupported';
export type YuE2Status={phase:YuE2Phase;directory?:string;defaultDirectory:string;installed:boolean;autoStart:boolean;modelsReady:boolean;canGenerate:boolean;url?:string;message:string;error?:string;logs:string[]};
export type YuE2Context={signal:AbortSignal;report:(line:string)=>void;owner:string;trackProcess?:(pid:number)=>void;lease?:ResourceExecution['lease'];budget?:number};
export type YuE2Process={url:string;headers?:Record<string,string>;exited:Promise<number|null>;status:()=>Promise<{modelsPresent:boolean;fake:boolean}>;stop:()=>Promise<void>};
export type YuE2Driver={resourceProfile?:Record<string,unknown>;unsupported:()=>string|undefined;installed:(directory:string)=>boolean;modelsReady?:(directory:string)=>boolean;history?:(directory:string)=>Promise<YuE2Job[]>;prepare:(directory:string,models:boolean,context:YuE2Context)=>Promise<void>;launch:(directory:string,context:YuE2Context)=>Promise<YuE2Process>;chooseDirectory:()=>Promise<string|undefined>};
type Config={version:1;directory:string;autoStart:boolean};
const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error:any){return error.code!=='ESRCH';}};

/** One owned engine, with its entire installation outside the application binary. */
export class YuE2Engine {
  private store:ProjectStore;private driver:YuE2Driver;private config?:Config;private owner=randomUUID();private lockedDirectory?:string;
  private phase:YuE2Phase='uninstalled';private error?:string;private logs:string[]=[];private message='尚未启用 YuE2';
  private expectedExit?:YuE2Process;private process?:YuE2Process;private active?:{kind:'prepare'|'start';controller:AbortController;done:Promise<void>};private closing=false;
  private resources?:ResourceCoordinator;
  private constructor(store:ProjectStore,driver:YuE2Driver,resources?:ResourceCoordinator){this.resources=resources;this.store=store;this.driver=driver;resources?.register('yue2',{resident:()=>this.process?{memory:0}:undefined,unload:()=>this.unload()});}
  static async open(store:ProjectStore,driver:YuE2Driver,resources?:ResourceCoordinator) {
    const engine=new YuE2Engine(store,driver,resources),path=store.path('engines','yue2.json');
    if(existsSync(path)) {
      try {
        if(lstatSync(path).isSymbolicLink())throw new Error('YuE2 设置文件不能是符号链接');
        const value=JSON.parse(readFileSync(path,'utf8')) as Config;
        if(value.version!==1 || typeof value.directory!=='string'||!isAbsolute(value.directory) || typeof value.autoStart!=='boolean')throw new ServiceError('CORRUPT_ENGINE','YuE2 设置格式无效');
        engine.config=value;engine.phase=driver.installed(value.directory)?'stopped':'uninstalled';engine.message=resources?(value.autoStart?'YuE2 已启用，生成时按需加载':'YuE2 尚未启用'):'YuE2 尚未启动';
      }catch(error){engine.fail(error);}
    }
    const reason=driver.unsupported();if(reason){engine.phase='unsupported';engine.message=reason;}
    else if(!resources&&engine.config?.autoStart)void engine.start().catch(error=>engine.fail(error));
    return engine;
  }
  private report=(line:string)=>{
    const clean=line.replace(/\x1b\[[0-9;?]*[A-Za-z]/g,'').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'').trim().slice(-700);
    if(clean){if(this.phase!=='running')this.message=clean;this.logs.push(clean);this.logs=this.logs.slice(-60);}
  };
  private fail(error:unknown){this.phase='failed';this.error=error instanceof Error?error.message:String(error);this.report(`YuE2 操作失败：${this.error}`);}
  private persist(autoStart:boolean) {
    if(!this.config)return;
    const next={...this.config,autoStart};mkdirSync(this.store.path('engines'),{recursive:true});
    this.store.atomicJSON(this.store.path('engines','yue2.json'),next);this.config=next;
  }
  async status():Promise<YuE2Status> {
    const installed=!!this.config&&this.driver.installed(this.config.directory);let modelsReady=installed&&!!this.resources&&!!this.config&&!!this.driver.modelsReady?.(this.config.directory);
    const running=this.process;
    if(running&&this.phase==='running') {
      try {const status=await running.status();if(this.process===running&&this.phase==='running'){modelsReady=status.modelsPresent&&!status.fake;this.message='YuE2 服务已启动';}}
      catch(error){if(this.process===running)this.message=`YuE2 状态暂时无法读取：${error instanceof Error?error.message:String(error)}`;}
    }
    return {phase:this.phase,directory:this.config?.directory,defaultDirectory:join(homedir(),'Music','YuE2'),installed,autoStart:this.config?.autoStart??false,modelsReady,canGenerate:modelsReady&&!this.closing&&(this.resources?!!this.config?.autoStart:this.phase==='running'),url:this.phase==='running'?this.process?.url:undefined,message:this.message,error:this.error,logs:[...this.logs]};
  }
  async chooseDirectory(){return {directory:await this.driver.chooseDirectory()};}
  private check(){if(this.closing)throw new ServiceError('CLOSED','服务正在退出');const reason=this.driver.unsupported();if(reason)throw new ServiceError('YUE2_UNSUPPORTED',reason);}
  private directory(input:string) {
    if(!isAbsolute(input))throw new ServiceError('INVALID_DIRECTORY','请选择绝对路径的空文件夹');
    if(existsSync(input)&&lstatSync(input).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','引擎目录不能是符号链接');
    mkdirSync(input,{recursive:true,mode:0o700});const directory=realpathSync(input),marker=join(directory,'.music-room-yue2.json');
    if(existsSync(marker)) {
      if(lstatSync(marker).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','引擎标记不能是符号链接');
      const value=JSON.parse(readFileSync(marker,'utf8'));
      if(value.format!=='music-room-yue2'||value.version!==1)throw new ServiceError('INVALID_DIRECTORY','该文件夹不是工作台管理的 YuE2 安装目录');
    } else {
      if(readdirSync(directory).some(name=>name!=='.DS_Store'))throw new ServiceError('INVALID_DIRECTORY','首次安装请选择空文件夹，避免覆盖已有文件');
    }
    return directory;
  }
  private acquire(directory:string) {
    if(this.lockedDirectory===directory)return;
    const path=join(directory,'.music-room-yue2.lock');let fd:number;
    try {fd=openSync(path,'wx',0o600);}catch(error:any){
      if(error.code!=='EEXIST')throw error;
      if(lstatSync(path).isSymbolicLink())throw new ServiceError('UNSAFE_PATH','引擎锁不能是符号链接');
      const old=JSON.parse(readFileSync(path,'utf8'));
      if(!Number.isInteger(old.pid)||old.pid<=0||typeof old.owner!=='string')throw new ServiceError('CORRUPT_ENGINE','引擎锁格式无效');
      if(alive(old.pid)||Number.isInteger(old.workerPid)&&alive(old.workerPid))throw new ServiceError('YUE2_BUSY','该 YuE2 目录正在使用，请连接原工作台或等待它退出');
      const recovery=join(directory,'.music-room-yue2.recovery');let recoveryFd:number;
      try{recoveryFd=openSync(recovery,'wx',0o600);}catch{throw new ServiceError('YUE2_BUSY','该 YuE2 目录正在恢复，请稍后重试');}
      try {
        const current=JSON.parse(readFileSync(path,'utf8'));
        if(current.owner!==old.owner || alive(current.pid) || Number.isInteger(current.workerPid)&&alive(current.workerPid))throw new ServiceError('YUE2_BUSY','该 YuE2 目录正在使用');
        unlinkSync(path);fd=openSync(path,'wx',0o600);
      }finally{closeSync(recoveryFd);unlinkSync(recovery);}
    }
    try {writeFileSync(fd,JSON.stringify({pid:process.pid,owner:this.owner}));}finally{closeSync(fd);}
    this.lockedDirectory=directory;
  }
  private release() {
    if(!this.lockedDirectory)return;const path=join(this.lockedDirectory,'.music-room-yue2.lock');
    if(existsSync(path)&&JSON.parse(readFileSync(path,'utf8')).owner===this.owner)unlinkSync(path);
    this.lockedDirectory=undefined;
  }
  private begin(kind:'prepare'|'start',fn:(context:YuE2Context)=>Promise<void>) {
    const controller=new AbortController(),active={kind,controller,done:Promise.resolve()};this.active=active;
    this.error=undefined;this.phase=kind==='prepare'?'preparing':'starting';
    active.done=Promise.resolve().then(()=>fn({signal:controller.signal,report:this.report,owner:this.owner})).catch(async error=>{
      try{await this.stopOwned();this.release();}catch(cleanupError){this.report(`清理 YuE2 失败：${cleanupError instanceof Error?cleanupError.message:String(cleanupError)}`);}
      if(controller.signal.aborted){this.phase='stopped';this.message='YuE2 已停止';}else this.fail(error);
    }).finally(()=>{if(this.active===active)this.active=undefined;});
  }
  async prepare(input:string,models:boolean) {
    this.check();if(this.active)throw new ServiceError('YUE2_BUSY','YuE2 正在准备或启动，请等待完成或先停止');
    const queue=this.resources?.snapshot();if(queue&&[...(queue.active?[queue.active]:[]),...queue.queued].some(task=>task.engine==='yue2'))throw new ServiceError('YUE2_BUSY','音乐正在排队或生成，请先完成或取消，再准备环境');
    const directory=this.directory(input);
    if(this.process&&this.config?.directory!==directory)throw new ServiceError('YUE2_BUSY','更换安装目录前请先停止 YuE2');
    mkdirSync(this.store.path('engines'),{recursive:true});
    const marker=join(directory,'.music-room-yue2.json');
    if(!existsSync(marker)){const fd=openSync(marker,'wx',0o600);try{writeFileSync(fd,JSON.stringify({format:'music-room-yue2',version:1}));}finally{closeSync(fd);}}
    this.config={version:1,directory,autoStart:false};this.persist(false);
    this.begin('prepare',async context=>{
      context.report(models?'准备运行环境及生成模型':'准备运行环境（不下载模型）');
      const execute=async(execution?:ResourceExecution)=>{this.acquire(directory);await this.stopOwned();await this.driver.prepare(directory,models,{...context,signal:execution?.signal??context.signal,trackProcess:execution?.trackProcess,lease:execution?.lease});};
      if(this.resources)await installTask(this.resources,{id:'install-yue2',directory,diskBytes:this.driver.installed(directory)&&(!models||this.driver.modelsReady?.(directory))?0:30*2**30,signal:context.signal,onState:state=>{this.message=state.message??'准备音乐 · '+state.stage;},execute});else await execute();if(context.signal.aborted)throw context.signal.reason;
      if(this.resources){this.phase='stopped';this.message='YuE2 已准备，生成时按需加载';this.release();}else await this.launch(context);this.persist(true);
    });return this.status();
  }
  async start() {
    this.check();if(this.process&&this.phase==='running'||this.active?.kind==='start')return this.status();
    if(this.active)throw new ServiceError('YUE2_BUSY','YuE2 正在准备，请等待完成');
    if(!this.config||!this.driver.installed(this.config.directory))throw new ServiceError('YUE2_NOT_INSTALLED','请先在页面选择目录并准备 YuE2 环境');
    if(this.resources){this.persist(true);this.message='YuE2 已启用，生成时按需加载';return this.status();}
    this.begin('start',async context=>{this.acquire(this.config!.directory);await this.launch(context);this.persist(true);});return this.status();
  }
  async activate(execution:ResourceExecution) {
    this.check();if(this.active)throw new ServiceError('YUE2_BUSY','YuE2 正在准备');
    if(!this.config||!this.driver.installed(this.config.directory))throw new ServiceError('YUE2_NOT_INSTALLED','请先准备 YuE2');
    execution.signal.throwIfAborted();this.acquire(this.config.directory);
    try{await this.launch({signal:execution.signal,report:this.report,owner:this.owner,trackProcess:execution.trackProcess,lease:execution.lease,budget:execution.budgets.memory});}
    catch(error){await this.unload();throw error;}
  }
  async history(){return this.config?await this.driver.history?.(this.config.directory)??[]:[];}
  resourceProfile(){return this.driver.resourceProfile;}
  headers(){return this.process?.headers??{};}
  async unload(){await this.stopOwned();this.release();if(!this.active){this.phase='stopped';this.message='YuE2 已释放，生成时按需加载';}}
  private async launch(context:YuE2Context) {
    this.phase='starting';context.report('正在启动 YuE2');
    const run=await this.driver.launch(this.config!.directory,context);
    if(context.signal.aborted){await run.stop();throw context.signal.reason;}
    this.process=run;this.phase='running';this.message='YuE2 服务已启动';context.report(this.message);
    void run.exited.then(code=>{
      if(this.process!==run||this.expectedExit===run)return;this.process=undefined;
      try{this.release();}catch(error){this.report(`释放引擎目录锁失败：${error instanceof Error?error.message:String(error)}`);}
      this.fail(new Error(`YuE2 进程已退出（${code??'信号'}），可以重新启动`));
    }).catch(error=>{if(this.process===run){this.process=undefined;this.fail(error);}});
  }
  private async stopOwned(){const run=this.process;if(run){this.expectedExit=run;try{await run.stop();if(this.process===run)this.process=undefined;}finally{if(this.expectedExit===run)this.expectedExit=undefined;}}}
  async stop() {
    this.persist(false);await this.shutdown();return this.status();
  }
  private async shutdown() {
    this.phase='stopping';const active=this.active;active?.controller.abort(new Error('用户停止 YuE2'));
    if(active)await active.done;await this.stopOwned();this.release();this.phase='stopped';this.message='YuE2 已停止';
  }
  async close(){if(this.closing)return;this.closing=true;await this.shutdown();}
  async endpoint() {const state=await this.status();if(!state.canGenerate||!state.url)throw new ServiceError('YUE2_UNAVAILABLE','YuE2 尚未就绪，请先安装模型并启动');return state.url;}
}
