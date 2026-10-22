import {mkdir,readFile,writeFile,copyFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
if(process.platform==='darwin'){
 const root=fileURLToPath(new URL('../',import.meta.url)),output=join(root,'public/resource-native');
 await mkdir(output,{recursive:true});
 const program=`footprint-darwin-${process.arch}`,source=join(root,'native/resources/footprint.c');
 execFileSync('/usr/bin/clang',['-O2','-Wall','-Wextra',source,'-o',join(output,program)],{stdio:'inherit'});
 execFileSync('/usr/bin/codesign',['--force','--sign','-',join(output,program)],{stdio:'pipe'});
 await copyFile(source,join(output,'footprint.c'));
 const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
 await writeFile(join(output,'manifest.json'),JSON.stringify({version:2,program,programSha256:hash(await readFile(join(output,program))),source:'footprint.c',sourceSha256:hash(await readFile(source))},null,2)+'\n');
}
