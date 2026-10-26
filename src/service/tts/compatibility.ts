import type {SpeechDriver} from './speech.ts';

/** Explicit form/API contract: a reference transcript opts into Breeze. */
export function createCompatibleSpeechDriver(legacy:SpeechDriver,breeze:SpeechDriver):SpeechDriver {
 const old={...legacy,engineName:'IndexTTS 2.0' as const},fresh={...breeze,engineName:'Breeze TTS 2' as const};
 const select=(request:{referenceText?:string})=>request.referenceText?.trim()?fresh:old;
 const unload=async()=>{await legacy.unload?.();await breeze.unload?.();};
 return {...legacy,engineName:'Breeze TTS 2 / IndexTTS 2.0',engineLabel:'有文字稿：MLX 4bit · 无文字稿：'+legacy.engineLabel,select,
  installed:root=>legacy.installed(root)||breeze.installed(root),
  prepare:async(root,context)=>{await legacy.prepare(root,context);await breeze.prepare(root,context);},
  generate:async(root,request,context)=>{const driver=select(request);if(driver===fresh)await legacy.unload?.();await driver.generate(root,request,context);},
  unload,close:async()=>{await legacy.close?.();await breeze.close?.();},
 };
}
