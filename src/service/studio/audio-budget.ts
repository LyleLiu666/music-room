import {ServiceError} from '../projects/store.ts';
/** Parse bounded headers before codecs allocate full PCM arrays. */
export function audioShape(bytes:Uint8Array){
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);let frames=0,channels=0,rate=0;
 if(b.subarray(0,4).toString()==='fLaC'){
  if(b.length<42||(b[4]&127)!==0||b.readUIntBE(5,3)!==34)throw new ServiceError('INVALID_AUDIO','FLAC 缺少有效长度信息');
  const high=b.readUInt32BE(18),low=b.readUInt32BE(22);rate=high>>>12;channels=((high>>>9)&7)+1;frames=(high&15)*4294967296+low;
 }else if(b.length>=44&&b.subarray(0,4).toString()==='RIFF'&&b.subarray(8,12).toString()==='WAVE'){
  let sampleBytes=0,dataBytes=0;
  for(let at=12;at+8<=b.length;){const length=b.readUInt32LE(at+4),name=b.subarray(at,at+4).toString();if(at+8+length>b.length)throw new ServiceError('INVALID_AUDIO','WAV 长度无效');
   if(name==='fmt '&&length>=16){channels=b.readUInt16LE(at+10);rate=b.readUInt32LE(at+12);sampleBytes=b.readUInt16LE(at+22)/8;}if(name==='data')dataBytes=length;at+=8+length+(length%2);
  }frames=dataBytes/(sampleBytes*channels);
 }
 if(!Number.isSafeInteger(frames)||frames<1||frames>96000*600||![1,2].includes(channels)||rate<8000||rate>96000)throw new ServiceError('INVALID_AUDIO','音频长度、声道或采样率超出处理范围');
 return {frames,channels,rate};
}
export function speedPeak(bytes:Uint8Array,tempo:number){const {frames,channels}=audioShape(bytes);return Math.ceil(bytes.length*3+frames*channels*4*(1+1/tempo)+frames/tempo*channels*2*3+64*1048576);}
