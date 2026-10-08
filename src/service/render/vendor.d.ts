declare module 'wav-decoder' {
  const decoder: { decode(buffer:ArrayBuffer):Promise<{sampleRate:number;channelData:Float32Array[]}> };
  export default decoder;
}
