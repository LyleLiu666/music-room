import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import decoder from 'wav-decoder';
import {encodeWav} from '../../src/wav.ts';

const revision='1d95888bec3ae0a17c0c4af791810d5a63f6bc35';
const project=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const [sourceArg,outputArg,libraryArg]=process.argv.slice(2);
if(!sourceArg||!outputArg||!libraryArg)throw Error('Usage: node run.mjs source.wav output-directory rubberband-source');
const source=resolve(sourceArg),out=resolve(outputArg),library=resolve(libraryArg);
await mkdir(out,{recursive:true});
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
async function run(command,args){
 return new Promise((resolve,reject)=>{
  const child=spawn(command,args,{stdio:['pipe','pipe','pipe']});let output='',error='';
  // Native renderer owns its lifetime through this pipe; leave it open until exit.
  child.stdin.on('error',()=>{});child.stdout.on('data',b=>output+=b);child.stderr.on('data',b=>error=(error+b).slice(-8000));
  const timer=setTimeout(()=>child.kill('SIGKILL'),120000);
  child.once('error',reject);child.once('close',code=>{clearTimeout(timer);code===0?resolve(output.trim()):reject(Error(error||`Command exited ${code}`));});
 });
}
assert.equal(await run('git',['-C',library,'rev-parse','HEAD']),revision,'use the pinned Rubber Band 4.0.0 source');
assert.equal(await run('git',['-C',library,'status','--porcelain']),'','library source must be unmodified');
const swift=await readFile(join(project,'scripts/speed-preview-trial/render.swift'),'utf8');
assert.equal(swift.split('stretch.overlap = 8').length,2,'baseline parameter changed; review this experiment');
await writeFile(join(out,'render-smooth.swift'),swift.replace('stretch.overlap = 8','stretch.overlap = 32'));
await run('/usr/bin/xcrun',['swiftc','-O',join(out,'render-smooth.swift'),'-o',join(out,'render-smooth')]);
await run('/usr/bin/xcrun',['clang++','-O3','-std=c++17','-I',library,join(project,'scripts/speed-quality-trial/render-rubberband.cpp'),join(library,'single/RubberBandSingle.cpp'),'-framework','Accelerate','-o',join(out,'render-rubberband')]);
const decode=async bytes=>decoder.decode(new Uint8Array(bytes).buffer);
const stats=channels=>{
 let energy=0,peak=0,count=0;
 for(const channel of channels)for(const x of channel){assert.ok(Number.isFinite(x));energy+=x*x;peak=Math.max(peak,Math.abs(x));count++;}
 return {rms:Math.sqrt(energy/count),peak};
};
async function render(input,kind,rate){
 const {sampleRate,channelData}=await decode(input),frames=channelData[0].length;
 if(kind==='A'){
  const inputPath=join(out,'native-input.wav'),outputPath=join(out,'native-output.wav');
  await writeFile(inputPath,input);await run(join(out,'render-smooth'),[inputPath,outputPath,String(rate)]);
  return decode(await readFile(outputPath));
 }
 const raw=new Float32Array(frames*channelData.length);
 for(let i=0;i<frames;i++)for(let c=0;c<channelData.length;c++)raw[i*channelData.length+c]=channelData[c][i];
 const inputPath=join(out,'input.f32'),outputPath=join(out,'output.f32');
 await writeFile(inputPath,new Uint8Array(raw.buffer));
 await run(join(out,'render-rubberband'),[inputPath,outputPath,String(sampleRate),String(channelData.length),String(rate),'full']);
 const samples=new Float32Array(new Uint8Array(await readFile(outputPath)).buffer);
 assert.equal(samples.length,Math.round(frames/rate)*channelData.length,'offline engine must return full duration without padding/cropping');
 const channels=channelData.map(()=>new Float32Array(samples.length/channelData.length));
 for(let i=0;i<channels[0].length;i++)for(let c=0;c<channels.length;c++)channels[c][i]=samples[i*channels.length+c];
 return {sampleRate,channelData:channels};
}

// Check signal integrity, separately from the human listening decision.
const sr=22050,length=sr*3;
const tone=new Uint8Array(encodeWav([
 Float32Array.from({length},(_,i)=>.2*Math.sin(2*Math.PI*440*i/sr)),
 Float32Array.from({length},(_,i)=>i>length-sr*.2?.2*Math.sin(2*Math.PI*660*i/sr):0),
],sr));
const checks=[];
for(const kind of ['A','B']){
 const result=await render(tone,kind,.5);assert.equal(result.sampleRate,sr);assert.equal(result.channelData.length,2);
 for(const channel of result.channelData)assert.equal(channel.length,length*2);
 stats(result.channelData);
 const [left,right]=result.channelData;let crossings=0;
 for(let i=sr;i<2*sr;i++)if(left[i]>=0&&left[i-1]<0)crossings++;
 assert.ok(Math.abs(crossings-440)<=3,`${kind} pitch: ${crossings}`);
 assert.ok(stats([left.subarray(0,sr*.04)]).rms>.03,'first sound retained');
 assert.ok(stats([right.subarray(-sr*.3)]).rms>.03,'last sound retained');
 assert.ok(stats([right.subarray(0,sr)]).peak<1e-6,'channels stay separate');
 const starts=Array.from({length:7},(_,i)=>.2+.4*i);
 const pulse=new Uint8Array(encodeWav([Float32Array.from({length},(_,i)=>{
  const time=i/sr,start=starts.find(start=>time>=start&&time<start+.04);
  return start===undefined?0:.3*Math.sin(Math.PI*(time-start)/.04)**2*Math.sin(2*Math.PI*440*time);
 })],sr));
 const samples=(await render(pulse,kind,.5)).channelData[0];let last=-sr;const onsets=[];
 for(let i=0;i<samples.length;i++)if(Math.abs(samples[i])>.04){if(i-last>sr*.02)onsets.push(i/sr);last=i;}
 assert.equal(onsets.length,starts.length,`${kind} must not repeat or drop short sounds`);
 onsets.forEach((time,i)=>assert.ok(Math.abs(time-starts[i]*2)<.025,`${kind} onset drift`));
 checks.push({kind,pitchHz:crossings,shortSounds:onsets.length,firstAndLastRetained:true,stereoPreserved:true});
}
const input=await readFile(source),original=await decode(input),outputs=[];
for(const kind of ['A','B']){
 const result=await render(input,kind,.5);
 assert.equal(result.sampleRate,original.sampleRate);
 for(const channel of result.channelData)assert.equal(channel.length,original.channelData[0].length*2);
 outputs.push({kind,...result,before:stats(result.channelData)});
}
// Match RMS while reserving headroom for peaks; never clip before normalization.
const targetRms=Math.min(...outputs.map(x=>Math.min(x.before.rms,.98*x.before.rms/x.before.peak)));
const files=[];
for(const result of outputs){
 const gain=targetRms/result.before.rms,channels=result.channelData.map(c=>c.map(x=>x*gain));
 const bytes=new Uint8Array(encodeWav(channels,result.sampleRate));
 const file=join(out,`shen-teng-050-${result.kind}.wav`);await writeFile(file,bytes);
 const decoded=await decode(bytes),after=stats(decoded.channelData);assert.ok(after.peak<.99);
 files.push({kind:result.kind,file,sha256:hash(bytes),seconds:channels[0].length/result.sampleRate,before:result.before,after,gain});
}
assert.equal(hash(await readFile(source)),hash(input),'source unchanged');
const report={sourceSha256:hash(input),rate:.5,rubberBandRevision:revision,checks,files,listeningVerdict:'pending',productionChanged:false};
await writeFile(join(out,'quality-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
