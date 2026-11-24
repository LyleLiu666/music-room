import {join} from 'node:path';
import {mkdirSync,accessSync,constants} from 'node:fs';
import {coverProfile} from './ace-cover.ts';

export const coverArchives=[
 ['ace.tar.gz',`https://codeload.github.com/ServeurpersoCom/acestep.cpp/tar.gz/${coverProfile.revision}`,'03be6fb9f19caa80a60df2113d275b0cea0fd197f3d2985a3f9cd8d515213613'],
 ['ggml.tar.gz','https://codeload.github.com/ServeurpersoCom/ggml/tar.gz/ef4555b7aede4467a5de803b103615e0a5f30dd8','5e9c6bc3f06804d437d1ff4cbc5070593de3f3e0a25bd9dd34029e28e94a4c6d'],
] as const;
export const coverProgramAsset='ace-cover-native/ace-synth';
export const coverProgramManifest='ace-cover-native/manifest.json';
export const coverBuildOptions=['-DCMAKE_BUILD_TYPE=Release','-DBUILD_SHARED_LIBS=OFF','-DGGML_NATIVE=OFF'] as const;
export function coverCmake(){
 const program=['/opt/homebrew/bin/cmake','/usr/local/bin/cmake','/Applications/CMake.app/Contents/bin/cmake'].find(path=>{
  try{accessSync(path,constants.X_OK);return true;}catch{return false;}
 });
 if(!program)throw Error('从源码准备翻唱程序需要 CMake，可用 brew install cmake 安装');
 return program;
}
export async function buildCoverProgram(staging:string,archives:string,run:(program:string,args:string[])=>Promise<string>){
 const cmake=coverCmake(),ggml=join(staging,'ggml');
 await run('/usr/bin/tar',['-xzf',join(archives,coverArchives[0][0]),'--strip-components','1','-C',staging]);
 mkdirSync(ggml,{recursive:true});
 await run('/usr/bin/tar',['-xzf',join(archives,coverArchives[1][0]),'--strip-components','1','-C',ggml]);
 await run(cmake,['-S',staging,'-B','out',...coverBuildOptions]);
 await run(cmake,['--build','out','--target','ace-synth','-j','2']);
 const program=join(staging,'out','ace-synth');
 const libraries=await run('/usr/bin/otool',['-L',program]);
 if(libraries.includes('libggml'))throw Error('翻唱程序未静态链接推理库');
 return program;
}
