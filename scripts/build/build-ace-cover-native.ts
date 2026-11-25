import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,copyFile,rm,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {coverArchives,coverBuildOptions,buildCoverProgram} from '../../src/service/studio/ace-cover-program.ts';
import {coverProfile} from '../../src/service/studio/ace-cover.ts';

if(process.platform==='darwin'&&process.arch==='arm64'){
 const cache=resolve('build/ace-cover-native'),out=resolve('public/ace-cover-native');
 await mkdir(cache,{recursive:true});await mkdir(out,{recursive:true});
 const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
 const binary=join(out,'ace-synth'),manifest=join(out,'manifest.json');
 const aceLicense=join(out,'acestep-license.txt'),ggmlLicense=join(out,'ggml-license.txt');
 let ready=false;
 try{
  const meta=JSON.parse(await readFile(manifest,'utf8'));
  ready=meta.revision===coverProfile.revision&&JSON.stringify(meta.configure)===JSON.stringify(coverBuildOptions)&&meta.sha256===sha(await readFile(binary))&&
   /MIT License/i.test(await readFile(aceLicense,'utf8'))&&/MIT License/i.test(await readFile(ggmlLicense,'utf8'));
 }catch{/* Build when a cached program is absent. */}
 if(!ready){
  for(const [name,url,digest] of coverArchives){
   const path=join(cache,name);
   const cached=await readFile(path).catch(()=>undefined);
   if(cached&&sha(cached)===digest)continue;
   const response=await fetch(url);
   if(!response.ok)throw Error(`翻唱源码下载失败：${response.status}`);
   const bytes=new Uint8Array(await response.arrayBuffer());
   if(sha(bytes)!==digest)throw Error('翻唱源码校验失败');
   await writeFile(path,bytes);
  }
  const stage=await mkdtemp(join(cache,'compile-'));
  try{
   const built=await buildCoverProgram(stage,cache,async(program,args)=>execFileSync(program,args,{cwd:stage,encoding:'utf8',maxBuffer:8*1024*1024}));
   await copyFile(built,binary);
   await copyFile(join(stage,'LICENSE'),aceLicense);
   await copyFile(join(stage,'ggml','LICENSE'),ggmlLicense);
   await writeFile(manifest,JSON.stringify({revision:coverProfile.revision,configure:coverBuildOptions,sha256:sha(await readFile(binary))},null,2));
  }finally{await rm(stage,{recursive:true,force:true});}
 }
}
