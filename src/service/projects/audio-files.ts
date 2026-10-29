import {createHash} from 'node:crypto';
import {openSync,closeSync,fstatSync,readSync,constants} from 'node:fs';
import {ServiceError} from './errors.ts';
export const maxAudioBytes=512*2**20;
/** Allocate only the validated size from one opened file; never read a grown file unboundedly. */
export function readAudioFile(path:string,limit=maxAudioBytes,expectedBytes?:number){
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const info=fstatSync(fd);if(!info.isFile()||!Number.isSafeInteger(info.size)||info.size>limit)throw new ServiceError('INVALID_AUDIO','音频文件超出处理范围');if(expectedBytes!==undefined&&info.size!==expectedBytes)throw new ServiceError('SOURCE_CHANGED','音频文件长度发生变化');const bytes=Buffer.allocUnsafe(info.size);let at=0;while(at<bytes.length){const count=readSync(fd,bytes,at,bytes.length-at,at);if(!count)throw new ServiceError('SOURCE_CHANGED','音频文件读取期间发生变化');at+=count;}if(fstatSync(fd).size!==info.size)throw new ServiceError('SOURCE_CHANGED','音频文件读取期间发生变化');return bytes;}finally{closeSync(fd);}
}
/** Startup integrity checks hash a bounded stream instead of allocating each whole recording. */
export function verifyAudioFile(path:string,sha256:string,limit=maxAudioBytes,expectedBytes?:number){
 const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const info=fstatSync(fd);if(!info.isFile()||info.size>limit||expectedBytes!==undefined&&info.size!==expectedBytes)throw new ServiceError('SOURCE_CHANGED','音频文件长度发生变化');const hash=createHash('sha256'),chunk=Buffer.allocUnsafe(65536);let at=0;while(at<info.size){const count=readSync(fd,chunk,0,Math.min(chunk.length,info.size-at),at);if(!count)throw new ServiceError('SOURCE_CHANGED','音频读取期间发生变化');hash.update(chunk.subarray(0,count));at+=count;}if(fstatSync(fd).size!==info.size||hash.digest('hex')!==sha256)throw new ServiceError('SOURCE_CHANGED','音频原件哈希不符');}finally{closeSync(fd);}
}

/** Verify and stream from the same descriptor, keeping memory bounded and paths
 * immune to replacement between the integrity check and opening the response. */
export async function openVerifiedAudioFile(path:string,sha256:string,expectedBytes:number,signal:AbortSignal){
 const {open}=await import('node:fs/promises');
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
 try{
  const before=await file.stat();if(!before.isFile()||before.size!==expectedBytes||before.size>maxAudioBytes)throw new ServiceError('SOURCE_CHANGED','音频文件长度发生变化');
  const digest=createHash('sha256'),chunk=Buffer.allocUnsafe(65536);let at=0;
  while(at<before.size){signal.throwIfAborted();const {bytesRead}=await file.read(chunk,0,Math.min(chunk.length,before.size-at),at);if(!bytesRead)throw new ServiceError('SOURCE_CHANGED','音频文件读取期间发生变化');digest.update(chunk.subarray(0,bytesRead));at+=bytesRead;}
  const after=await file.stat();if(after.size!==before.size||after.mtimeMs!==before.mtimeMs||digest.digest('hex')!==sha256)throw new ServiceError('SOURCE_CHANGED','音频原件哈希不符');
  signal.throwIfAborted();return file;
 }catch(e){await file.close();throw e;}
}
