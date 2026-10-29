import type {IncomingMessage,ServerResponse} from 'node:http';
import type {FileHandle} from 'node:fs/promises';
import {pipeline} from 'node:stream/promises';

/** A single byte range. Multipart ranges are deliberately rejected. */
function rangeOf(header:string,size:number):{start:number;end:number}|undefined{
 const match=/^bytes=(\d*)-(\d*)$/.exec(header);if(!match||!size)return;
 const [,left,right]=match;if(!left&&!right)return;
 const a=left?Number(left):undefined,b=right?Number(right):undefined;
 if(a!==undefined&&!Number.isSafeInteger(a)||b!==undefined&&!Number.isSafeInteger(b))return;
 if(a===undefined){if(!b)return;return {start:Math.max(0,size-b),end:size-1};}
 if(a>=size||b!==undefined&&b<a)return;
 return {start:a,end:Math.min(b??size-1,size-1)};
}
export async function streamAudioFile(req:IncomingMessage,res:ServerResponse,file:FileHandle,size:number,signal:AbortSignal,filename:string){
 try{
  signal.throwIfAborted();
  const range=req.headers.range?rangeOf(req.headers.range,size):undefined;
  const headers={'content-type':'audio/wav','cache-control':'no-store','accept-ranges':'bytes','content-disposition':`attachment; filename="${filename}"`};
  if(req.headers.range&&!range){res.writeHead(416,{...headers,'content-range':`bytes */${size}`,'content-length':0});res.end();return;}
  res.writeHead(range?206:200,{...headers,'content-length':range?range.end-range.start+1:size,...(range?{'content-range':`bytes ${range.start}-${range.end}/${size}`}:{})});
  await pipeline(file.createReadStream({autoClose:false,start:range?.start??0,end:range?.end,highWaterMark:65536}),res,{signal});
 }finally{await file.close();}
}
