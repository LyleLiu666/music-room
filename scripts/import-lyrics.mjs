// Import an explicitly reviewed alignment into the local workspace, verifying the audio identity.
import {readFile,mkdir,writeFile,rename,rm} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {readLyrics} from '../src/service/studio/lyrics.ts';
const [workspaceArg,alignmentArg]=process.argv.slice(2);if(!workspaceArg||!alignmentArg)throw Error('Usage: node scripts/import-lyrics.mjs WORKSPACE ALIGNMENT_JSON');
const workspace=resolve(workspaceArg),alignment=JSON.parse(await readFile(resolve(alignmentArg),'utf8')),studio=JSON.parse(await readFile(join(workspace,'studio.json'),'utf8'));
const version=studio.versions.find(v=>v.id===alignment.summary.id);if(!version||version.deleted||version.purged||version.state!=='succeeded'||!version.audioPath)throw Error('请选择已完成且可访问的版本');
const runtime=JSON.parse(await readFile(join(workspace,'.music-room.runtime.json'),'utf8'));if(resolve(runtime.workspace)!==workspace)throw Error('运行中的服务工作目录不匹配');
const response=await fetch(runtime.url+version.audioPath,{headers:{authorization:'Bearer '+runtime.token},signal:AbortSignal.timeout(60000)});if(!response.ok)throw Error('读取音频失败');const sha=createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');if(sha!==alignment.summary.audioSha256)throw Error('时间轴与当前音频不匹配，未导入');
const document={format:'music-room-lyrics',version:1,versionId:version.id,audioPath:version.audioPath,audioSha256:sha,duration:alignment.summary.duration,draft:true,source:'reviewed-alignment-import',lines:alignment.lines.map(({text,start,end})=>({text,start,end}))};
const staging=join(workspace,'lyrics-import-'+randomUUID());await mkdir(staging);try{
 await writeFile(join(staging,version.id+'.json'),JSON.stringify(document,null,2));const verified=readLyrics(staging,version);if(verified.kind!=='synced')throw Error('歌词验证失败');
 const directory=join(workspace,'lyrics');await mkdir(directory,{recursive:true});const target=join(directory,version.id+'.json');const existing=await readFile(target,'utf8').catch(e=>{if(e.code!=='ENOENT')throw e;return undefined;});const content=JSON.stringify(document,null,2);
 if(existing!==undefined&&existing!==content)throw Error('该版本已有不同的歌词修订，未覆盖');
 if(existing===undefined)await rename(join(staging,version.id+'.json'),target);
 console.log(JSON.stringify({versionId:version.id,lines:document.lines.length,audioVerified:true,path:target}));
}finally{await rm(staging,{recursive:true,force:true});}
