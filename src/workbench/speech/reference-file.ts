/** Browser reference extraction accepts bounded, uncompressed input before allocating PCM. */
export async function readReferenceWav(file:Blob){
 if(file.size>50*2**20)throw Error('参考 WAV 不能超过 50 MiB');const b=new DataView(await file.slice(0,65536).arrayBuffer()),tag=(at:number)=>String.fromCharCode(...Array.from({length:4},(_,i)=>b.getUint8(at+i)));const invalid=()=>{throw Error('请选择 10 分钟以内、单声道或立体声的 PCM WAV；压缩音频、视频或较长录音请先导出人声片段');};
 if(b.byteLength<44||tag(0)!=='RIFF'||tag(8)!=='WAVE'||b.getUint32(4,true)+8!==file.size)invalid();let rate=0,block=0,channels=0;
 for(let at=12;at+8<=b.byteLength;){const length=b.getUint32(at+4,true),end=at+8+length;if(end>file.size)invalid();if(tag(at)==='fmt '){if(rate||length<16||end>b.byteLength)invalid();const format=b.getUint16(at+8,true),bits=b.getUint16(at+22,true);channels=b.getUint16(at+10,true);rate=b.getUint32(at+12,true);block=b.getUint16(at+20,true);if(![1,2].includes(channels)||rate<8000||rate>96000||!((format===1&&[16,24,32].includes(bits))||(format===3&&bits===32))||block!==channels*bits/8)invalid();}if(tag(at)==='data'){if(!rate||!block||!length||end+length%2!==file.size||length%block||length/(block*rate)>600)invalid();return file.arrayBuffer();}at=end+length%2;}
 return invalid();
}
