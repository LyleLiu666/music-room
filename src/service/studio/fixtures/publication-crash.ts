// Child-process fault injector. Never imported by a runtime entry point.
import {writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {MusicService} from '../../service.ts';
import {testResources} from '../../resources/testing.ts';
import {encodeWav} from '../../../wav.ts';
const [root,phase,soundId,versionId]=process.argv.slice(2);
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const service=await MusicService.open(root,()=>{throw Error('crash must happen before rendering');},async()=>new Uint8Array(),false,unused,undefined,undefined,testResources());
const original=service.store.atomicJSON.bind(service.store);
function crash(){writeFileSync(join(root,'fault-reached'),phase);process.kill(process.pid,'SIGKILL');}
service.store.atomicJSON=(path,value:any)=>{
 const library=path.endsWith('/sound-library/index.json');
 const score=path.endsWith('/projects/crash/project.json')&&value.revisions.length>1;
 const purge=path.endsWith('/studio.json')&&value.versions.some((v:any)=>v.id===versionId&&v.purgePending);
 if(phase==='library-before-index'&&library||phase==='score-before-manifest'&&score)crash();
 original(path,value);
 if(phase==='library-after-index'&&library||phase==='score-after-manifest'&&score||phase==='mix-after-manifest'&&score||phase==='purge-after-intent'&&purge)crash();
};
if(phase.startsWith('library-'))await service.soundLibrary.import({name:'tone.wav',requestId:'crash-import',bytes:new Uint8Array(encodeWav([new Float32Array(8000)],8000))});
else if(phase.startsWith('score-'))await service.studio.importScore({soundId,compositionJson:readFileSync(new URL('../../../music/authoring/example.json',import.meta.url),'utf8')});
else if(phase==='mix-after-manifest')await service.studio.saveMix({versionId,requestId:'crash-mix',mix:{volume:.5}});
else if(phase==='purge-after-intent')await service.studio.purge({kind:'version',id:versionId});
throw Error(`Fault not reached: ${phase}`);
