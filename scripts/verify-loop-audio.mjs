import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const output = new URL('../test-results/loop-audio/', import.meta.url);
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
 const page = await browser.newPage();
 await page.goto(`${process.env.MUSIC_ROOM_URL || 'http://127.0.0.1:5173'}/score.html`);
 await page.waitForFunction(() => !!window.musicRoom);
 const result = await page.evaluate(async () => {
  const engine = window.musicRoom.engine;
  await engine.prepare();
  const score = { title: 'Loop timing fixture', bpm: 960, duration: 2.5, bars: Array.from({length:10},()=>({chord:'C',section:0})), sections:[{name:'Fixture',startBar:0,bars:10,subtitle:'',color:'#fff'}], notes:[{track:'kick',pitch:36,beat:4,duration:.5,velocity:1}, {track:'snare',pitch:38,beat:8,duration:1,velocity:1}] };
  engine.setScore(score);
  const context = engine.context, chunks = [];
  const source = `class Capture extends AudioWorkletProcessor { process(inputs) { this.port.postMessage(inputs[0]?.[0]?.slice() ?? new Float32Array(128)); return true; } } registerProcessor('capture', Capture);`;
  const blobUrl = URL.createObjectURL(new Blob([source], {type:'text/javascript'}));
  await context.audioWorklet.addModule(blobUrl); URL.revokeObjectURL(blobUrl);
  const recorder = new AudioWorkletNode(context,'capture');
  recorder.port.onmessage = event => chunks.push(event.data);
  const silent = context.createGain(); silent.gain.value=0;
  engine.output.connect(recorder).connect(silent).connect(context.destination);
  engine.setLoop({startBeat:4,endBeat:8});
  const wait = ms => new Promise(resolve=>setTimeout(resolve,ms));
  // Force first effect initialization to outlast the startup lookahead.
  // Audio start must be chosen after construction, not before it.
  const createConvolver=context.createConvolver.bind(context);let slowFirst=true;
  context.createConvolver=()=>{if(slowFirst){slowFirst=false;const until=performance.now()+100;while(performance.now()<until){} } return createConvolver();};
  engine.play();context.createConvolver=createConvolver;
  await wait(5700);
  const loopPosition=engine.currentTime();
  engine.pause(); await wait(100);
  const samples = new Float32Array(chunks.reduce((sum,c)=>sum+c.length,0));
  let cursor=0; for(const chunk of chunks){samples.set(chunk,cursor);cursor+=chunk.length;}
  const rate=context.sampleRate, onsets=[];
  for(let i=1;i<samples.length;i++) if(Math.abs(samples[i])>.035 && Math.abs(samples[i-1])<=.035 && (!onsets.length || (i-onsets.at(-1)) / rate > .16)) onsets.push(i);
  const periods=onsets.slice(1).map((n,i)=>(n-onsets[i])/rate);
  const first=onsets[0], cycleFrames=Math.round(.25*rate);
  let worstDifference=0, stableDifference=0; const cycleRms=[];
  for(let cycle=0;cycle<20;cycle++) {
   let power=0, energy=0, stable=0; for(let i=0;i<cycleFrames;i++){ const x=samples[onsets[cycle]+i] ?? 0; power+=(samples[first+i]-x)**2; energy+=x*x; stable+=((samples[onsets[1]+i] ?? 0)-x)**2; }
   cycleRms.push(Math.sqrt(energy/cycleFrames));
   worstDifference=Math.max(worstDifference,Math.sqrt(power/cycleFrames));
   if(cycle>=1) stableDifference=Math.max(stableDifference,Math.sqrt(stable/cycleFrames));
  }
  const tail=samples.slice(-Math.round(.045*rate));
  let residual=0; for(const x of tail) residual=Math.max(residual,Math.abs(x));
  chunks.length = 0;
  engine.setScore({...score,notes:[{track:'bass',pitch:45,beat:0,duration:16,velocity:1},{track:'snare',pitch:38,beat:8,duration:1,velocity:1}]});
  engine.setLoop({startBeat:4,endBeat:8}); engine.play();
  await wait(850); engine.pause(); await wait(100);
  let heldPower=0, heldFrames=0;
  for(const chunk of chunks) for(const x of chunk){heldPower+=x*x;heldFrames++;}
  const heldNoteRms=Math.sqrt(heldPower/heldFrames);
  recorder.disconnect(); silent.disconnect(); engine.output.disconnect(recorder);
  return { sampleRate:rate, cycles:onsets.length, periods, maximumPeriodError:Math.max(...periods.map(x=>Math.abs(x-.25))), worstDifference, stableDifference, cycleRms, residual, loopPosition, heldNoteRms };
 });
 console.log(JSON.stringify(result));
 await writeFile(new URL('verification.json',output),JSON.stringify(result,null,2));
 assert.ok(result.cycles>=20, 'capture at least 20 actual playback cycles');
 assert.ok(result.maximumPeriodError<=.01, 'actual output timing error must stay within 10ms');
 assert.ok(result.worstDifference<.001, 'the first playback cycle must be complete after synthesis and effect initialization');
 assert.ok(result.stableDifference<.001, 'each recorded loop must repeat the same audio without accumulating tails or playing outside notes');
 assert.ok(result.residual<.00001, 'pause must clear audio and effect tails');
 assert.ok(result.heldNoteRms>.005, 'a note begun before the selection must actually sound when restored');
 assert.ok(result.loopPosition>=.25 && result.loopPosition<.5);
 await writeFile(new URL('verification.json',output),JSON.stringify(result,null,2));
 console.log('Real audio loop and held-note verification passed.');
} finally { await browser.close(); }
