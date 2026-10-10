import {createResources} from '../src/service/resources/runtime.ts';
import {installTask} from '../src/service/resources/installation.ts';
import {parseArgs} from 'node:util';
import {createHash} from 'node:crypto';
import {createReadStream,constants} from 'node:fs';
import {mkdir,copyFile,chmod,writeFile,rename,stat} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const {values}=parseArgs({options:{workspace:{type:'string'},binary:{type:'string'},'seed-model':{type:'string'},'separator-model':{type:'string'},commit:{type:'string'}}});
if(process.platform!=='darwin'||process.arch!=='arm64')throw Error('此安装包仅验证了 Apple Silicon macOS');
for(const key of ['workspace','binary','seed-model','separator-model','commit'])if(!values[key])throw Error(`缺少 --${key}`);
if(!/^[a-f0-9]{40}$/.test(values.commit))throw Error('commit 需要完整的源码提交 SHA');
const digest=async path=>{const h=createHash('sha256');for await(const b of createReadStream(path)){controller.signal.throwIfAborted();h.update(b);}return h.digest('hex');};
const directory=join(resolve(values.workspace),'engines','voice-conversion'),resources=createResources(),controller=new AbortController();const stop=()=>controller.abort();process.once('SIGTERM',stop);process.once('SIGINT',stop);
try{await installTask(resources,{id:'install-conversion',directory,diskBytes:4*2**30,signal:controller.signal,execute:async execution=>{
const seedSha='03740be5b4b55ae677c34d63514ff879aaedd6a77fd31773938166fb84debf93',sepSha='f8c54ba35df95aafea7881eac214b58ec18a73cbcb6ff5a90f4b762631a286b6';
for(const [arg,size,sha] of [['seed-model',3629186560,seedSha],['separator-model',84059168,sepSha]])if((await stat(values[arg])).size!==size||await digest(values[arg])!==sha)throw Error(`${arg} 未通过固定模型校验`);
await mkdir(directory,{recursive:true});
const programSha256=await digest(values.binary);
for(const [arg,name]of [['binary','audiocpp_cli'],['seed-model','seed-vc-f16.gguf'],['separator-model','htdemucs-f16.gguf']]){const target=join(directory,name),partial=target+'.installing';execution.signal.throwIfAborted();await copyFile(values[arg],partial,constants.COPYFILE_FICLONE);execution.signal.throwIfAborted();if(arg==='binary')await chmod(partial,0o755);await rename(partial,target);}
const installed={format:'music-room-conversion-engine',version:1,commit:values.commit,programSha256,modelSha256:seedSha,separationSha256:sepSha,installedAt:new Date().toISOString()};
await writeFile(join(directory,'installed.json.partial'),JSON.stringify(installed,null,2));await rename(join(directory,'installed.json.partial'),join(directory,'installed.json'));console.log(JSON.stringify({directory,...installed},null,2));

}});}finally{process.removeListener('SIGTERM',stop);process.removeListener('SIGINT',stop);await resources.close();}
