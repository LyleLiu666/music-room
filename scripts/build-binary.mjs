import {readFile,readdir,mkdir,writeFile,stat,copyFile,chmod} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {execFileSync} from 'node:child_process';
const root=resolve('.'),dir=join(root,'build'),out=join(root,'release');await mkdir(dir,{recursive:true});await mkdir(out,{recursive:true});
const bun=process.env.BUN_BINARY??'bun',version=execFileSync(bun,['--version'],{encoding:'utf8'}).trim();
if(version!=='1.4.2')throw new Error(`本次已验证 Bun 1.4.2，当前 ${version}。更换版本请更新独立二进制验收与构建记录。`);
const files=[];
async function collect(folder,prefix='') {
  for(const entry of await readdir(folder,{withFileTypes:true})) {
    const name=prefix+entry.name,path=join(folder,entry.name);
    if(entry.isDirectory())await collect(path,name+'/');
    else if(entry.isFile() && (name==='index.html'||name==='speech.html'||name==='score.html'||name==='credits.html'||name==='project-license.txt'||name==='service-licenses.txt'||name.startsWith('assets/')||name.startsWith('samples/')||name.startsWith('tts-presets/')||name.startsWith('yue2-runtime/')||name.startsWith('authoring-kit/')||name==='music-authoring-kit.zip'))files.push(name);
  }
}
await copyFile(join(root,'LICENSE'),join(root,'dist/project-license.txt'));
await collect(join(root,'dist'));files.sort();
let source="import {main} from '../src/server/main.ts';\n";
for(let i=0;i<files.length;i++)source+=`import asset${i} from ${JSON.stringify(join(root,'dist',files[i]))} with { type: 'file' };\n`;
source+=`const files:Record<string,string>={${files.map((f,i)=>`${JSON.stringify(f)}:asset${i}`).join(',')}};\n`;
source+=`main(process.argv.slice(2),{embedded:true,has:path=>Object.hasOwn(files,path),read:async path=>{if(!Object.hasOwn(files,path))throw new Error('内嵌文件不存在');return new Uint8Array(await Bun.file(files[path]).arrayBuffer());}},[]).catch(error=>{console.error(error.message);process.exitCode=1;});\n`;
await writeFile(join(dir,'binary-entry.ts'),source);
execFileSync(bun,[join(root,'scripts/compile-binary.mjs'),join(dir,'binary-entry.ts'),join(out,'music-room')],{stdio:'inherit'});
if(process.platform==='darwin'){
  try{execFileSync('/usr/bin/codesign',['--verify','--strict',join(out,'music-room')],{stdio:'pipe'});}
  catch{execFileSync('/usr/bin/codesign',['--force','--sign','-',join(out,'music-room')],{stdio:'inherit'});execFileSync('/usr/bin/codesign',['--verify','--strict',join(out,'music-room')],{stdio:'inherit'});}
}
execFileSync(join(out,'music-room'),['--help'],{stdio:'pipe',timeout:10000});
const bytes=(await stat(join(out,'music-room'))).size,assetsBytes=(await Promise.all(files.map(f=>stat(join(root,'dist',f))))).reduce((sum,s)=>sum+s.size,0);
await copyFile(join(root,'scripts/start-music-room.sh'),join(out,'start.sh'));await chmod(join(out,'start.sh'),0o755);
const manifest={name:'music-room',platform:process.platform,arch:process.arch,bun:version,binaryBytes:bytes,embeddedAssetBytes:assetsBytes,embeddedFiles:files,exclusions:['exports/*.wav (originals remain in repository)','development screenshots','node_modules','models','Chromium / Electron']};
await writeFile(join(out,'build-manifest.json'),JSON.stringify(manifest,null,2));
console.log(JSON.stringify({binary:'release/music-room',MiB:Math.round(bytes/1048576*100)/100,embeddedFiles:files.length,bun:version}));
