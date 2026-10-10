import {testResources} from '../resources/testing.ts';
import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,rm,writeFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';import {MusicService} from '../service.ts';import {encodeWav} from '../../wav.ts';
const unused={unsupported:()=>undefined,installed:()=>false,chooseDirectory:async()=>undefined,prepare:async()=>{},launch:async()=>{throw Error('unused');}};
const wav=new Uint8Array(encodeWav([new Float32Array(44100).fill(.1)],44100));
const speech={installed:()=>true,prepare:async()=>{},generate:async(_:string,r:{outputPath:string})=>{await writeFile(r.outputPath,wav);},cleanReference:async(_:string,r:{outputPath:string})=>{await writeFile(r.outputPath,wav);}};
test('conversion-only references disappear from every TTS picker, reject both generation APIs and survive restart for SVC',async()=>{
 const root=await mkdtemp(join(tmpdir(),'voice-usage-'));const open=()=>MusicService.open(root,()=>{throw Error('unused');},async()=>new Uint8Array(),false,unused,speech,undefined,testResources());let service=await open();
 try{await service.call('create_project',{projectId:'film',title:'测试'});const sound=await service.call('studio_create_sound',{projectId:'film',title:'旁白',kind:'speech'}),voice=service.speech.addVoice('保留演唱音色',wav);
  assert.ok((await service.call('tts_library',{})).voices.some(v=>v.id===voice.id));
  await service.call('tts_update_voice',{voiceId:voice.id,usage:'conversion'});
  assert.ok(!(await service.call('tts_library',{})).voices.some(v=>v.id===voice.id));assert.ok(!(await service.call('studio_library',{})).voices.some(v=>v.id===voice.id));
  for(const operation of ['tts_generate','studio_generate'] as const)await assert.rejects(service.call(operation,{soundId:sound.id,voiceId:voice.id,text:'不应生成'}),/仅用于音色转换/);
  assert.ok((await service.call('svc_library',{})).voices.some(v=>v.id===voice.id));assert.deepEqual(service.speech.voiceAudio(voice.id),wav);
  const cleaned=service.speech.cleanVoice(voice.id);assert.equal(cleaned.usage,'conversion');
  await service.close();service=await open();assert.ok(!(await service.call('tts_library',{})).voices.some(v=>v.id===voice.id));assert.ok((await service.call('svc_library',{})).voices.some(v=>v.id===voice.id));
 }finally{await service.close();await rm(root,{recursive:true,force:true});}
});
