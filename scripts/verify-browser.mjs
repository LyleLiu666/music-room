import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = new URL('../public/exports/rain-letter-v2/', import.meta.url);
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1200 }, acceptDownloads: true });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(process.env.MUSIC_ROOM_URL || 'http://127.0.0.1:5173');
  await page.waitForFunction(() => !!window.musicRoom);
  await page.getByRole('button', { name: '播放', exact: false }).click();
  await page.waitForFunction(() => window.musicRoom.engine.playing, { timeout: 30000 });
  assert.ok(await page.evaluate(() => window.musicRoom.engine.ready));
  const before = await page.evaluate(() => window.musicRoom.engine.currentTime());
  await page.waitForTimeout(350);
  assert.ok(await page.evaluate(() => window.musicRoom.engine.currentTime()) > before);
  await page.getByRole('button', { name: '暂停', exact: false }).click();
  assert.equal(await page.evaluate(() => window.musicRoom.engine.playing), false);
  await page.getByRole('button', { name: '副歌 01:20', exact: true }).click();
  assert.equal(await page.evaluate(() => window.musicRoom.engine.position), 80);
  await page.getByRole('button', { name: '独奏主旋律钢琴', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => [...window.musicRoom.engine.mix.solo]), ['melody']);
  await page.getByRole('button', { name: '静音贝斯', exact: true }).click();
  assert.ok(await page.evaluate(() => window.musicRoom.engine.mix.muted.has('bass')));
  await page.getByRole('combobox', { name: '旋律音色' }).selectOption('flute');
  assert.equal(await page.evaluate(() => window.musicRoom.engine.mix.lead), 'flute');
  // Verify the actual audio-routing behavior, not just button states.
  await page.evaluate(() => {
    const engine = window.musicRoom.engine; engine.play(80);
  });
  await page.waitForTimeout(140);
  const routed = await page.evaluate(() => {
    const engine = window.musicRoom.engine;
    return { melody: engine.graph.buses.get('melody').gain.value, bass: engine.graph.buses.get('bass').gain.value, strings: engine.graph.buses.get('strings').gain.value };
  });
  assert.ok(routed.melody > .5 && routed.bass < .001 && routed.strings < .001);
  await page.evaluate(() => window.musicRoom.engine.pause());
  await page.getByRole('button', { name: '选择雨巷来信 第二版 · Riff', exact: true }).click();
  const switched = await page.evaluate(() => {
    const { engine, songId, score } = window.musicRoom;
    return { songId, notes: score.notes.length, playing: engine.playing, position: engine.position, solo: engine.mix.solo.size, muted: engine.mix.muted.size, lead: engine.mix.lead };
  });
  assert.deepEqual(switched, { songId: 'rain-letter-v2', notes: 1878, playing: false, position: 0, solo: 0, muted: 0, lead: 'piano' });
  assert.ok((await page.locator('#score-download').getAttribute('href')).includes('rain-letter-v2'));
  const midiEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'MIDI', exact: true }).click();
  const midiDownload = await midiEvent;
  assert.equal(midiDownload.suggestedFilename(), 'rain-letter-v2.mid');
  await midiDownload.saveAs(new URL('song.mid', root).pathname);
  // Switching an actively playing composition stops it before replacing its score.
  await page.getByRole('button', { name: '播放', exact: false }).click();
  await page.waitForFunction(() => window.musicRoom.engine.playing);
  await page.getByRole('button', { name: '选择雨巷来信 第一版', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => ({ playing: window.musicRoom.engine.playing, graph: !!window.musicRoom.engine.graph, notes: window.musicRoom.score.notes.length })), { playing: false, graph: false, notes: 3709 });
  await page.getByRole('button', { name: '选择雨巷来信 第二版 · Riff', exact: true }).click();
  await page.getByRole('button', { name: '回到开头' }).click();
  await page.screenshot({ path: new URL('music-room.png', root).pathname, fullPage: true });
  process.stdout.write('Playback, pause, seek, mixer routing, version switching and independent MIDI export passed.\n');
  const downloadEvent = page.waitForEvent('download', { timeout: 180000 });
  const exportFailure = page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('导出失败'), null, { timeout: 180000 }).then(async () => { throw new Error(await page.locator('#status').textContent()); });
  await page.getByRole('button', { name: '导出 WAV', exact: false }).click();
  // The in-flight export must keep its captured composition even if the user
  // switches to another piece before decoding/rendering has finished.
  await page.getByRole('button', { name: '选择雨巷来信 第一版', exact: true }).click();
  const reporter = setInterval(async () => {
    try { process.stdout.write((await page.locator('#export').textContent()) + '\n'); } catch { /* browser closed */ }
  }, 15000);
  let download;
  try { download = await Promise.race([downloadEvent, exportFailure]); } finally { clearInterval(reporter); }
  assert.equal(download.suggestedFilename(), 'rain-letter-v2.wav');
  await download.saveAs(new URL('song.wav', root).pathname);
  await page.route('**/exports/rain-letter-v2/song.wav', route => route.fulfill({ path: new URL('song.wav', root).pathname, contentType: 'audio/wav' }));
  const metrics = await page.evaluate(async () => {
    const response = await fetch('./exports/rain-letter-v2/song.wav');
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
  await page.getByRole('button', { name: '选择雨巷来信 第二版 · Riff', exact: true }).click();
  await page.screenshot({ path: new URL('music-room.png', root).pathname, fullPage: true });
  // A separate shorter score verifies that the player/exporter has no three-
  // minute/single-composition dependency. Also exercise a fully muted export.
  const shortRender = await page.evaluate(async () => {
    const engine = window.musicRoom.engine, original = engine.score;
    engine.setScore({ ...original, duration: 4, bpm: 120, notes: original.notes.filter(n => n.beat < 6) });
    engine.mix.muted = new Set(['melody','piano','rhodes','pluck','flute','strings','bass','kick','snare','hat','cymbal']);
    const result = await engine.render();
    engine.setScore(original);
    return { duration: result.buffer.duration, peak: result.peak, bytes: result.wav.byteLength };
  });
  assert.deepEqual(shortRender, { duration: 4, peak: 0, bytes: 705644 });
  await writeFile(new URL('verification.json', root), JSON.stringify({ songId: 'rain-letter-v2', ...metrics, browserErrors: errors, shortRender, functionalChecks: ['playback','pause','seek','mute routing','solo routing','instrument selection','version switching stops prior playback','version switching resets mixer','independent MIDI export','WAV snapshot survives switching','180-second WAV export','short-score muted export'] }, null, 2));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: new URL('music-room-mobile.png', root).pathname, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'mobile page must not overflow');
  assert.deepEqual(errors, []);
  process.stdout.write(JSON.stringify({ duration: metrics.duration, peak: metrics.peak, rms: metrics.rms, clips: metrics.clips, errors }) + '\n');
} finally { await browser.close(); }
