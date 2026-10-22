/** Keep bounded audio bytes in memory. Response.blob() may require browser disk
 * cache even when the network request itself succeeds. */
export async function readAudioBlob(response:Response,limit=256*1048576):Promise<Blob>{
 const tooLarge=()=>Error('音频文件超出播放器处理范围');
 const declared=response.headers.get('content-length');
 if(declared!==null&&Number(declared)>limit){await response.body?.cancel();throw tooLarge();}
 const reader=response.body?.getReader();if(!reader)throw Error('音频内容为空');
 const parts:Uint8Array[]=[];let size=0;
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>limit){await reader.cancel();throw tooLarge();}parts.push(value);}
 }finally{reader.releaseLock();}
 if(!size)throw Error('音频内容为空');
 const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
 return new Blob([bytes],{type:response.headers.get('content-type')??'application/octet-stream'});
}
