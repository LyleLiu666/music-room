import {randomUUID} from 'node:crypto';
import type {IncomingMessage} from 'node:http';
import type {ResourceCoordinator} from '../service/resources/coordinator.ts';
import {ServiceError} from '../service/projects/store.ts';
/** Short file reads stay independent of model execution, with bounded retained response buffers. */
export class BufferGate {
 private busy=0;private waiting:{enter:()=>void;reject:(e:unknown)=>void;detach:()=>void}[]=[];
 private capacity:number;private maxQueue:number;
 constructor(capacity:number,maxQueue=32){this.capacity=capacity;this.maxQueue=maxQueue;}
 private acquire(signal:AbortSignal):Promise<()=>void>{signal.throwIfAborted();if(this.busy>=this.capacity&&this.waiting.length>=this.maxQueue)return Promise.reject(new ServiceError('IO_BUSY','文件读取繁忙，请稍后重试'));return new Promise((resolve,reject)=>{const entry={enter:()=>{},reject,detach:()=>signal.removeEventListener('abort',abort)},abort=()=>{const index=this.waiting.indexOf(entry);if(index>=0){this.waiting.splice(index,1);entry.detach();reject(signal.reason);}};entry.enter=()=>{entry.detach();this.busy++;let released=false;resolve(()=>{if(released)return;released=true;this.busy--;this.waiting.shift()?.enter();});};if(this.busy<this.capacity)entry.enter();else{this.waiting.push(entry);signal.addEventListener('abort',abort,{once:true});}});}
 async run<T>(signal:AbortSignal,execute:()=>Promise<T>){const release=await this.acquire(signal);try{signal.throwIfAborted();return await execute();}finally{release();}}
}
/** Leave the request paused until admission; Node/socket backpressure keeps queued inputs small. */
export async function importRequest<T>(resources:ResourceCoordinator,req:IncomingMessage,limit:number,signal:AbortSignal,execute:(bytes:Buffer,signal:AbortSignal)=>Promise<T>){
 const declared=req.headers['content-length'];if(declared!==undefined&&(!/^\d+$/.test(declared)||Number(declared)>limit))throw new ServiceError('TOO_LARGE','上传音频超过大小限制');
 const bytes=declared===undefined?limit:Number(declared);
 return resources.run({id:`upload-${randomUUID()}`,engine:'import',signal,demand:resources.estimate('import',{bytes}),execute:async context=>{context.running();context.signal.throwIfAborted();const abort=()=>req.destroy(new Error('上传已取消'));context.signal.addEventListener('abort',abort,{once:true});try{const chunks:Buffer[]=[];let size=0;for await(const chunk of req){context.signal.throwIfAborted();size+=chunk.length;if(size>limit)throw new ServiceError('TOO_LARGE','上传音频超过大小限制');chunks.push(chunk);}context.signal.throwIfAborted();return await execute(Buffer.concat(chunks),context.signal);}finally{context.signal.removeEventListener('abort',abort);}}});
}
