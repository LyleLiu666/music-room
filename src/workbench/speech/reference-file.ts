/** Browser reference extraction accepts bounded, uncompressed input before allocating PCM. */
export async function readReferenceWav(file:Blob){
 if(file.size>50*2**20)throw Error('参考 WAV 不能超过 50 MiB');const b=new DataView(await file.slice(0,65536).arrayBuffer()),tag=(at:number)=>String.fromCharCode(...Array.from({length:4},(_,i)=>b.getUint8(at+i)));const invalid=()=>{throw Error('请选择 10 分钟以内、单声道或立体声的 PCM WAV；压缩音频、视频或较长录音请先导出人声片段');};
 if(b.byteLength<44||tag(0)!=='RIFF'||tag(8)!=='WAVE'||b.getUint32(4,true)+8!==file.size)invalid();let rate=0,block=0,channels=0;
 for(let at=12;at+8<=b.byteLength;){const length=b.getUint32(at+4,true),end=at+8+length;if(end>file.size)invalid();if(tag(at)==='fmt '){if(rate||length<16||end>b.byteLength)invalid();const format=b.getUint16(at+8,true),bits=b.getUint16(at+22,true);channels=b.getUint16(at+10,true);rate=b.getUint32(at+12,true);block=b.getUint16(at+20,true);if(![1,2].includes(channels)||rate<8000||rate>96000||!((format===1&&[16,24,32].includes(bits))||(format===3&&bits===32))||block!==channels*bits/8)invalid();}if(tag(at)==='data'){if(!rate||!block||!length||end+length%2!==file.size||length%block||length/(block*rate)>600)invalid();return file.arrayBuffer();}at=end+length%2;}
 return invalid();
}

/** Inspect compressed audio duration before allocating its decoded PCM. */
export async function readReferenceAudio(file:Blob){
 if(file.size>50*2**20)throw Error('参考音频不能超过 50 MiB');
 const header=new Uint8Array(await file.slice(0,12).arrayBuffer());
 const tag=(at:number)=>String.fromCharCode(...header.slice(at,at+4));
 if(tag(0)==='RIFF')return readReferenceWav(file);
 if(header.length<12||tag(4)!=='ftyp')throw Error('请选择 WAV 或 M4A 音频');
 const url=URL.createObjectURL(file),audio=document.createElement('audio');
 try{
  await new Promise<void>((resolve,reject)=>{
   const timer=setTimeout(()=>finish(Error('读取 M4A 超时，请重新选择文件')),15000);
   const finish=(error?:Error)=>{clearTimeout(timer);audio.onloadedmetadata=null;audio.onerror=null;error?reject(error):resolve();};
   audio.onloadedmetadata=()=>finish(Number.isFinite(audio.duration)&&audio.duration>0&&audio.duration<=600?undefined:Error('请选择 10 分钟以内的 M4A 音频'));
   audio.onerror=()=>finish(Error('无法读取这个 M4A，请使用 AAC 编码的 M4A 或 PCM WAV'));
   audio.preload='metadata';audio.src=url;
  });
  return await file.arrayBuffer();
 }finally{audio.removeAttribute('src');audio.load();URL.revokeObjectURL(url);}
}
