/** Keep every character while bounding each native model request to the measured envelope. */
export function speechSegments(text:string):string[]{
 if(!text.trim()||text.length>8000)throw new Error('语音正文需为 1–8000 字');
 const parts:string[]=[];let offset=0;
 while(offset<text.length){
  let end=Math.min(offset+140,text.length);
  if(end<text.length){
   if(/[\uD800-\uDBFF]/.test(text[end-1]))end--;
   const candidate=text.slice(offset,end);let boundary=0;
   for(let i=0;i<candidate.length;i++)if('。！？.!?；;\n'.includes(candidate[i]))boundary=i+1;
   if(boundary)end=offset+boundary;
  }
  parts.push(text.slice(offset,end));offset=end;
 }
 return parts;
}

/** Join validated PCM16 WAV payloads; reject changing formats and unbounded output. */
export function joinSpeechWaves(waves:Uint8Array[]):Buffer{
 let format:Buffer|undefined;const pcm:Buffer[]=[];let total=0;
 for(const wave of waves){
  const b=Buffer.from(wave.buffer,wave.byteOffset,wave.byteLength);let current:Buffer|undefined,data:Buffer|undefined;
  for(let offset=12;offset+8<=b.length;){const size=b.readUInt32LE(offset+4),end=offset+8+size;
   if(end>b.length)throw new Error('分段音频不完整');
   const tag=b.toString('ascii',offset,offset+4);if(tag==='fmt ')current=b.subarray(offset+8,offset+24);if(tag==='data')data=b.subarray(offset+8,end);offset=end+(size%2);
  }
  if(!current||!data||format&&!format.equals(current))throw new Error('分段音频格式不一致');
  format??=current;total+=data.length;if(total>256*2**20)throw new Error('生成音频超过大小上限，请分成多个片段');pcm.push(data);
 }
 if(!format)throw new Error('未生成音频');
 const header=Buffer.alloc(44);header.write('RIFF');header.writeUInt32LE(36+total,4);header.write('WAVEfmt ',8);header.writeUInt32LE(16,16);format.copy(header,20);header.write('data',36);header.writeUInt32LE(total,40);
 return Buffer.concat([header,...pcm]);
}
