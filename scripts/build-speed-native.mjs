import {mkdir,readFile,writeFile,rm,cp,copyFile,chmod} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createHash} from 'node:crypto';

if(process.platform==='darwin'){
 const root=fileURLToPath(new URL('../',import.meta.url)),directory=join(root,'public/speed-native'),build=join(root,'build/speed-native');
 const revision='1d95888bec3ae0a17c0c4af791810d5a63f6bc35',archiveHash='0d6fe8fcc54d8e0b7da1a67ebdb0129dd62f983ecbfb66650c65f977d46fe20f';
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex'),archive=join(build,'rubberband-4.0.0.tar.gz');
 await mkdir(build,{recursive:true});await mkdir(directory,{recursive:true});
 let bytes=await readFile(archive).catch(e=>{if(e.code!=='ENOENT')throw e;});
 if(!bytes){const response=await fetch(`https://codeload.github.com/breakfastquay/rubberband/tar.gz/${revision}`,{signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('Rubber Band source download failed');bytes=Buffer.from(await response.arrayBuffer());if(hash(bytes)!==archiveHash)throw Error('Rubber Band source hash mismatch');await writeFile(archive,bytes);}
 if(hash(bytes)!==archiveHash)throw Error('Rubber Band source cache hash mismatch');
 const unpack=join(build,'unpack'),source=join(build,'speed-native-source');
 await rm(unpack,{recursive:true,force:true});await mkdir(unpack);
 execFileSync('/usr/bin/tar',['-xzf',archive,'-C',unpack]);
 await rm(source,{recursive:true,force:true});await mkdir(source);
 await cp(join(unpack,`rubberband-${revision}`),join(source,'rubberband'),{recursive:true});
 for(const name of ['render.cpp','build.sh'])await copyFile(join(root,'native/speed',name),join(source,name));
 await copyFile(join(source,'rubberband/COPYING'),join(source,'COPYING'));
 const instructions=`Music Room separate speed helper: Rubber Band 4.0.0 R3 offline\nSource commit: ${revision}\nSource archive SHA-256: ${archiveHash}\n\nThe helper and linked Rubber Band code are GPL-2.0-or-later. See COPYING and\nrubberband/README.md for copyright and bundled dependency notices.\nApple Accelerate is supplied by the operating system.\n\nComplete corresponding source and build script are included in this archive.\nOn macOS with Xcode Command Line Tools, run: sh build.sh\nInvocation: rubberband-speed input.wav output.wav rate\nInput is canonical 16-bit PCM WAV, mono/stereo, 8–96 kHz, at most 600 s.\nKeep stdin open: EOF terminates the helper. Rate range: 0.5–2.0.\nThe enclosing application invokes this executable as a separate process.\n`;
 await writeFile(join(source,'README.txt'),instructions);
 const program=`rubberband-darwin-${process.arch}`;
 execFileSync('/bin/sh',[join(source,'build.sh'),join(directory,program)],{stdio:'inherit'});await chmod(join(directory,program),0o755);
 const sourceZip=join(directory,'source.zip');await rm(sourceZip,{force:true});
 execFileSync('/usr/bin/ditto',['-c','-k','--keepParent',source,sourceZip]);
 await writeFile(join(directory,'manifest.json'),JSON.stringify({engine:'Rubber Band R3',version:'4.0.0',revision,archiveSha256:archiveHash,program,programSha256:hash(await readFile(join(directory,program))),source:'source.zip',sourceSha256:hash(await readFile(sourceZip)),license:'GPL-2.0-or-later',options:['offline','finer','channels-together','default-window'],peakLimit:.98},null,2)+'\n');
 await writeFile(join(directory,'README.txt'),instructions);await copyFile(join(source,'COPYING'),join(directory,'COPYING'));
 // The old AVAudioUnitTimePitch executable must not remain in the shipped bundle.
 await rm(join(directory,`render-darwin-${process.arch}`),{force:true});
}
