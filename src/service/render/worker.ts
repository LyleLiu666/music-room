import {readFile} from 'node:fs/promises';
import {renderScore,type AssetReader} from './renderer.ts';
import {validateComposition} from '../../music/authoring/validate.mjs';
export async function runRenderWorker(read:AssetReader) {
  let input='';for await (const chunk of process.stdin) {input+=chunk.toString();if(input.length>5_000_000)throw new Error('渲染输入过大');}
  const x=JSON.parse(input),doc=validateComposition(JSON.stringify(x.composition));
  const {wav,...result}=await renderScore(doc.score,read,x.mix,stage=>process.stderr.write(JSON.stringify({stage})+'\n'));
  process.stderr.write(JSON.stringify({result})+'\n');
  await new Promise<void>((resolve,reject)=>process.stdout.write(wav,error=>error?reject(error):resolve()));
}
// Source invocation. The packaged main invokes this function with embedded assets.
if (process.argv[1] && new URL(import.meta.url).pathname===process.argv[1]) {
  runRenderWorker(path=>readFile(new URL(`../../../public/${path}`,import.meta.url))).catch(error=>{console.error(error.message);process.exitCode=1;});
}
