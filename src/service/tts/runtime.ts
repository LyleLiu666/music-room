import {fileURLToPath} from 'node:url';
import type {AssetReader} from '../render/renderer.ts';
import {createPythonSpeechDriver} from './python-runtime.ts';
import {createNativeSpeechDriver} from './native-runtime.ts';
export {sourceRevision} from './python-runtime.ts';
/** Native inference is the default on the verified Apple Silicon platform. */
export function createSpeechDriver(command=process.execPath,args=[fileURLToPath(new URL('../../server/dev.ts',import.meta.url)),'tts-worker'],read?:AssetReader){
 const choice=process.env.MUSIC_ROOM_TTS_BACKEND;
 if(choice&&choice!=='python'&&choice!=='audio-cpp')throw new Error('MUSIC_ROOM_TTS_BACKEND 需要 python 或 audio-cpp');
 const python=createPythonSpeechDriver(command,args,read);
 if(choice==='python'||!choice&&(process.platform!=='darwin'||process.arch!=='arm64'))return python;
 return createNativeSpeechDriver(command,[...args.slice(0,-1),'tts-native-worker'],read,{cleanReference:python.cleanReference});
}
