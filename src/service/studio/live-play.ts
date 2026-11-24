import {randomInt} from 'node:crypto';
import {z} from 'zod';
import {SCORE_ID_PATTERN} from '../../music/authoring/validate.mjs';
import {ServiceError} from '../projects/store.ts';
import {installTask} from '../resources/installation.ts';
import type {ResourceCoordinator} from '../resources/coordinator.ts';
import type {ResourceTaskState} from '../resources/contracts.ts';
import {userCancelled,ResourceError} from '../resources/contracts.ts';
import type {SoundLibrary} from './sound-library.ts';
import {LiveRing,liveFramesPerSecond,type LiveBlock} from './live-ring.ts';
import {liveProfile} from './live-assets.ts';
import type {LiveDriver,LiveStream,LiveStyle} from './live-runtime.ts';

const id=z.string().regex(SCORE_ID_PATTERN);
export const liveStyle=z.object({left:z.string().trim().min(1).max(240),right:z.string().trim().min(1).max(240),mix:z.number().finite().min(0).max(1)}).strict();
export const liveStartSchema=z.object({sessionId:z.string().regex(/^live-[a-z0-9-]{1,58}$/)}).strict();
export const liveNextSchema=z.object({sessionId:id,offset:z.number().int().nonnegative(),heardFrame:z.number().int().nonnegative(),style:liveStyle}).strict();
export const liveSaveSchema=z.object({sessionId:id,requestId:id,heardFrame:z.number().int().nonnegative(),title:z.string().trim().min(1).max(120)}).strict();
type Phase='queued'|'loading'|'running'|'stopping'|'stopped'|'failed';
type Session={
 id:string;phase:Phase;message:string;ring:LiveRing;controller:AbortController;done:Promise<void>;
 stream?:LiveStream;pending?:Promise<LiveBlock>;resource?:ResourceTaskState;
 leaseTimer?:ReturnType<typeof setTimeout>;mix?:number;ack:number;released:boolean;
};
const failed=(message:string):never=>{throw new ServiceError('CONFLICT',message);};
const liveStage=(session:Session)=>({id:session.id,phase:session.phase,message:session.message,resource:session.resource});
const inactive=(session:Session)=>session.phase==='failed'||session.phase==='stopped';

export class LivePlay {
 private resources:ResourceCoordinator;
 private library:SoundLibrary;
 private driver:LiveDriver;
 private directory:string;
 private session?:Session;
 private preparation?:{controller:AbortController;done:Promise<void>};
 private preparationMessage?:string;
 private closing=false;
 constructor(resources:ResourceCoordinator,library:SoundLibrary,driver:LiveDriver,directory:string){
  this.resources=resources;this.library=library;this.driver=driver;this.directory=directory;
  resources.register('magenta-live',{resident:()=>undefined,unload:async()=>{}});
 }
 status(){
  const session=this.session;
  return {installed:this.driver.installed(),preparing:!!this.preparation,message:this.preparationMessage,session:session?liveStage(session):undefined};
 }
 prepare(){
  if(this.closing)failed('服务正在退出');
  if(this.preparation||this.driver.installed())return this.status();
  const controller=new AbortController();
  this.preparationMessage='等待准备 Magenta 模型';
  const done=installTask(this.resources,{id:'install-magenta-live',directory:this.directory,diskBytes:5_000_000_000,signal:controller.signal,
   execute:execution=>this.driver.prepare(execution,message=>{this.preparationMessage=message;})
  }).then(()=>{this.preparationMessage=undefined;}).catch(error=>{this.preparationMessage=error instanceof Error?error.message:String(error);})
   .finally(()=>{this.preparation=undefined;});
  this.preparation={controller,done};
  return this.status();
 }
 async cancelPreparation(){
  this.preparation?.controller.abort();await this.preparation?.done;return this.status();
 }
 private touch(session:Session){
  clearTimeout(session.leaseTimer);
  if(inactive(session)||session.controller.signal.aborted)return;
  session.leaseTimer=setTimeout(()=>session.controller.abort(new ResourceError('CANCELLED','演奏窗口已断开')),20000);
  session.leaseTimer.unref?.();
 }
 start(id:string){
  if(this.closing)failed('服务正在退出');
  if(this.session?.id===id){this.touch(this.session);return liveStage(this.session);}
  if(this.session&&!this.session.released)failed('已有一个演奏窗口，请先停止');
  if(!this.driver.installed())failed('请先准备 Magenta 模型');
  const session:Session={id,phase:'queued',message:'等待演奏资源',ring:new LiveRing(),controller:new AbortController(),done:Promise.resolve(),ack:0,released:false};
  this.session=session;
  session.done=this.resources.run({id,engine:'magenta-live',signal:session.controller.signal,demand:this.resources.estimate('magenta-live',{resourceProfile:liveProfile}),
   onState:resource=>{
    session.resource=resource;
    if(session.phase==='stopping')return;
    if(resource.stage==='loading'){session.phase='loading';session.message='正在加载 Magenta';}
    if(resource.stage==='waiting_resources'||resource.stage==='queued')session.message=resource.message??'等待演奏资源';
   },
   execute:async execution=>{
    const stream=await this.driver.open(execution,randomInt(0,2147483648));
    try{
     execution.running();
     session.stream=stream;
     session.phase='running';session.message='可以开始演奏';
    }finally{
     await stream.done;
    }
   },
  }).catch(error=>{
   const cancelled=userCancelled(session.controller.signal)||error instanceof ResourceError&&error.code==='CANCELLED';
   if(session.phase!=='failed'){session.phase=cancelled?'stopped':'failed';session.message=cancelled?'已停止演奏':error instanceof Error?error.message:String(error);}
  }).finally(()=>{
   clearTimeout(session.leaseTimer);session.stream=undefined;session.released=true;
   if(!inactive(session)){session.phase='stopped';session.message='已停止演奏';}
  });
  this.touch(session);
  return liveStage(session);
 }
 private get(id:string){const session=this.session;if(!session||session.id!==id)return failed('演奏会话已结束');return session;}
 async next(args:z.output<typeof liveNextSchema>){
  const session=this.get(args.sessionId);
  if(inactive(session)||session.phase==='stopping')return {session:liveStage(session)};
  this.touch(session);
  if(args.heardFrame>session.ring.end)failed('播放位置超过已生成音频');
  session.ack=Math.max(session.ack,args.heardFrame);
  const existing=session.ring.get(args.offset);
  let block:LiveBlock|undefined=existing;
  if(!block&&session.phase==='running'&&session.stream){
   if(args.offset!==session.ring.end)failed('演奏缓冲区的位置不一致');
   if(session.ring.end-session.ack<3*liveFramesPerSecond){
    session.pending??=this.render(session,args.style);
    block=await session.pending;
   }
  }
  return {session:liveStage(session),block:block?{offset:block.offset,fromMix:block.fromMix,toMix:block.toMix,pcm:Buffer.from(block.pcm).toString('base64')}:undefined};
 }
 private async render(session:Session,style:LiveStyle){
  try{
   const pcm=await session.stream!.next(style);
   session.controller.signal.throwIfAborted();
   const block=session.ring.append(pcm,session.mix??style.mix,style.mix);session.mix=style.mix;
   return block;
  }catch(error){
   if(!session.controller.signal.aborted&&!inactive(session)){
    session.phase='failed';session.message=error instanceof Error?error.message:String(error);
    session.controller.abort(new ResourceError('CANCELLED',session.message));
   }
   throw error;
  }finally{session.pending=undefined;}
 }
 async save(args:z.output<typeof liveSaveSchema>){
  const existing=this.library.verifyRequest(args.requestId);
  if(existing){
   if(existing.origin!=='live-capture'||existing.source.sessionId!==args.sessionId||existing.source.heardFrame!==args.heardFrame||existing.title!==args.title)return failed('回留请求与上次不同');
   return existing;
  }
  const session=this.get(args.sessionId);
  if(session.phase!=='running')failed('请在演奏时留下片段');
  this.touch(session);
  const bytes=session.ring.capture(args.heardFrame);
  return this.library.import({name:`${args.requestId}.wav`,title:args.title,requestId:args.requestId,bytes,
   source:{kind:'live-capture',sessionId:session.id,heardFrame:args.heardFrame}});
 }
 async stop(id:string){
  const session=this.get(id);
  if(!inactive(session)){session.phase='stopping';session.message='正在释放 Magenta';session.controller.abort();}
  await session.done;
  return liveStage(session);
 }
 async close(){
  this.closing=true;
  await Promise.all([this.cancelPreparation(),this.session&&this.stop(this.session.id)]);
 }
}
