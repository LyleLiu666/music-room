import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../test-results/full-audio/', import.meta.url);
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
  const errors=[]; page.on('pageerror', error=>errors.push(error.message));
  await page.goto(`${process.env.MUSIC_ROOM_URL || 'http://127.0.0.1:5173'}/#rain-letter-v2`);
  await page.waitForFunction(()=>!!window.musicRoom);
  await page.locator('#view-start').fill('9'); await page.locator('#view-start').press('Tab');
  await page.locator('#select-view').click(); await page.locator('#loop').click();
  assert.deepEqual(await page.evaluate(()=>window.musicRoom.engine.loop),{startBeat:32,endBeat:48});
  const downloadEvent=page.waitForEvent('download',{timeout:180000});
  await page.locator('#export').click();
  await page.getByRole('button',{name:'选择雨巷来信 第一版',exact:true}).click();
  await page.locator('#volume').fill('0');
  const download=await downloadEvent;
  assert.equal(download.suggestedFilename(),'rain-letter-v2.wav');
  await download.saveAs(new URL('export.wav',root).pathname);
  await page.route('**/test-audio.wav',route=>route.fulfill({path:new URL('export.wav',root).pathname,contentType:'audio/wav'}));
  const metrics = await page.evaluate(async () => {
    const response = await fetch('./test-audio.wav');
    const context = new OfflineAudioContext(2, 1, 44100);
    const buffer = await context.decodeAudioData(await response.arrayBuffer());
    const channels = [buffer.getChannelData(0), buffer.getChannelData(1)];
    let peak = 0, sum = 0, nonFinite = 0, clips = 0, difference = 0;
    const windows = [];
    for (let second = 0; second < 180; second++) {
      let power = 0;
      for (let i = second * 44100; i < (second + 1) * 44100; i++) for (let c = 0; c < 2; c++) {
        const x = channels[c][i];
        if (!Number.isFinite(x)) nonFinite++;
        peak = Math.max(peak, Math.abs(x)); if (Math.abs(x) >= .999) clips++;
        power += x * x; sum += x * x;
        if (c === 0) difference += (x - channels[1][i]) ** 2;
      }
      windows.push(Math.sqrt(power / 88200));
    }
    const waveform = Array.from({length: 720}, (_, index) => {
      let maximum = 0;
      for (let i = index * 11025; i < (index + 1) * 11025; i += 4) maximum = Math.max(maximum, Math.abs(channels[0][i]), Math.abs(channels[1][i]));
      return maximum;
    });
    return { duration: buffer.duration, sampleRate: buffer.sampleRate, channels: buffer.numberOfChannels, frames: buffer.length, peak, rms: Math.sqrt(sum / (buffer.length * 2)), nonFinite, clips, stereoDifference: Math.sqrt(difference / buffer.length), secondRms: windows, waveform };
  });
  assert.equal(metrics.duration, 180); assert.equal(metrics.channels, 2); assert.equal(metrics.sampleRate, 44100);
  assert.equal(metrics.nonFinite, 0); assert.equal(metrics.clips, 0);
  assert.ok(metrics.peak > .1 && metrics.peak < .91);
  assert.ok(metrics.stereoDifference > .002, 'stereo image must exist');
  assert.ok(metrics.secondRms.slice(0, 178).every(x => x > .0001), 'no unplanned silent gaps');
  assert.ok(metrics.secondRms[179] < metrics.secondRms[175] * .7, 'outro must decay');

  const shortRender = await page.evaluate(async () => {
    const engine=window.musicRoom.engine, original=engine.score;
    engine.setScore({title:'Short score',bpm:120,duration:4,bars:original.bars.slice(0,2),sections:[{...original.sections[0],startBar:0,bars:2}],notes:[{track:'kick',pitch:36,beat:0,duration:.5,velocity:1}]});
    engine.mix.muted=new Set(['melody','piano','rhodes','pluck','flute','strings','bass','kick','snare','hat','cymbal']);
    const result=await engine.render();engine.setScore(original);
    return {duration:result.buffer.duration,peak:result.peak,bytes:result.wav.byteLength};
  });
  assert.deepEqual(shortRender,{duration:4,peak:0,bytes:705644});
  await page.getByRole('button',{name:'选择雨巷来信 第二版 · Riff',exact:true}).click();
  await page.locator('#view-start').fill('9'); await page.locator('#view-start').press('Tab');
  await page.locator('#select-view').click();
  await page.screenshot({path:new URL('desktop.png',root).pathname,fullPage:true});
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  await page.screenshot({path:new URL('mobile.png',root).pathname,fullPage:true});
  assert.deepEqual(errors,[]);
  const checks=['full export while looping','WAV snapshot survives version switch and volume change','180-second stereo WAV','no clipping or unplanned gaps','outro decay','independent short fully muted score'];
  await writeFile(new URL('verification.json',root),JSON.stringify({checks,metrics,shortRender,errors},null,2));
  console.log(JSON.stringify({duration:metrics.duration,peak:metrics.peak,rms:metrics.rms,clips:metrics.clips,shortRender,errors}));
} finally {await browser.close();}
