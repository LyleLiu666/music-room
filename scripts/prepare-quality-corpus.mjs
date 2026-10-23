import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {encodeWav} from '../src/wav.ts';
const require=createRequire(import.meta.url),decoder=require('wav-decoder');
const out=resolve('test-results/quality');await mkdir(join(out,'prepared'),{recursive:true});
const catalogue=JSON.parse(await readFile('tests/quality/cases.json','utf8'));
const sourcePaths=['tests/quality/cases.json','public/tts-presets/official.wav','public/tts-presets/tianjin.wav','public/exports/rain-letter-v2/song.wav'];
const sources={};for(const path of sourcePaths)sources[path]=createHash('sha256').update(await readFile(path)).digest('hex');
const voice=decoder.decode.sync(await readFile(sourcePaths[1])),music=decoder.decode.sync(await readFile(sourcePaths[3]));
const rate=voice.sampleRate,mono=voice.channelData[0],mixed=Float32Array.from(mono,(v,i)=>{
 const at=i*music.sampleRate/rate,left=Math.floor(at),fraction=at-left,background=(music.channelData[0][left]??0)*(1-fraction)+(music.channelData[0][left+1]??0)*fraction;
 return Math.max(-.95,Math.min(.95,v*.7+background*.15));
});
const path=join(out,'prepared/voice-with-background.wav');await writeFile(path,new Uint8Array(encodeWav([mixed],rate)));sources['prepared/voice-with-background.wav']=createHash('sha256').update(await readFile(path)).digest('hex');
const metadata={preparedAt:new Date().toISOString(),sourceRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sources,mixture:'official voice at 0.7 gain + first matching-duration rain-letter-v2 channel at 0.15 gain, linear resampling to voice rate',cases:catalogue.cases.length};
await writeFile(join(out,'corpus.json'),JSON.stringify(metadata,null,2));
// A template deliberately remains pending and cannot pass the evidence gate.
const template={realInference:false,sourceRevision:metadata.sourceRevision,modelRevision:'',hardware:'',results:catalogue.cases.map(c=>({caseId:c.id,status:'pending',reviewedBy:'',reviewedAt:'',scores:{clarity:null,continuity:null,completeness:null,noArtifacts:null},findings:[],artifacts:[]}))};
await writeFile(join(out,'review-template.json'),JSON.stringify(template,null,2));console.log(JSON.stringify({out,cases:metadata.cases,sources:Object.keys(sources).length}));
