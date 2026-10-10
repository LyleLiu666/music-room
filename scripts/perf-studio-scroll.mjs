// Scroll performance probe for the studio UI.
// Boots the real service + page, drives real wheel gestures and reports main-thread work
// (tracing), rAF frame pacing and frames actually presented by the compositor.
//   npm run perf:studio-scroll                      # current build
//   ENGINE=webkit npm run perf:studio-scroll        # WebKit/Safari-like engine
//   SCALE=2 ...                                     # Retina-like raster density
//   LEGACY=local|blur|1 ...                         # re-inject the old modal CSS to A/B it
import {mkdtemp, readFile, writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {chromium, webkit} from 'playwright';
import {MusicService} from '../src/service/service.ts';
import {serveHttp} from '../src/server/http.ts';
import {encodeWav} from '../src/wav.ts';
import {readBuiltinVoices} from '../src/service/tts/presets.ts';

const wav = Buffer.from(encodeWav([Float32Array.from({length: 22050 * 4}, (_, i) => Math.sin(i * .1) * .2)], 22050));
const unused = {unsupported: () => undefined, installed: () => false, chooseDirectory: async () => undefined, prepare: async () => {}, launch: async () => { throw Error('unused'); }};

const INTERESTING = ['RunTask', 'Paint', 'PrePaint', 'UpdateLayerTree', 'Layout', 'ScrollLayer', 'HitTest', 'FunctionCall', 'EventDispatch', 'MajorGC', 'MinorGC', 'ParseHTML', 'RasterTask', 'ImageDecodeTask', 'CompositeLayers', 'DrawFrame', 'BeginFrame', 'ActivateLayerTree', 'UpdateLayer', 'Commit', 'ProxyMain::BeginMainFrame'];
const TRACE_CATEGORIES = 'devtools.timeline,disabled-by-default-devtools.timeline,blink.user_timing';

function summarizeTracks(events) {
  const counts = {}, micros = {};
  for (const event of events) {
    if (event.ph !== 'X' || !INTERESTING.includes(event.name)) continue;
    counts[event.name] = (counts[event.name] ?? 0) + 1;
    micros[event.name] = (micros[event.name] ?? 0) + (event.dur ?? 0);
  }
  const out = {};
  for (const name of INTERESTING) if (counts[name]) out[name] = {count: counts[name], ms: +(micros[name] / 1000).toFixed(1)};
  return out;
}

// Presented-frame counter straight from the compositor (how many frames actually made it to the screen).
async function screencastFrames(page, run) {
  const cdp = await page.context().newCDPSession(page);
  let frames = 0;
  cdp.on('Page.screencastFrame', async ({sessionId}) => { frames++; await cdp.send('Page.screencastFrameAck', {sessionId}).catch(() => undefined); });
  await cdp.send('Page.startScreencast', {format: 'jpeg', quality: 20, maxWidth: 320, maxHeight: 180, everyNthFrame: 1});
  await run();
  await cdp.send('Page.stopScreencast');
  await cdp.detach();
  return frames;
}

async function trace(cdp, run) {
  const events = [];
  const complete = new Promise(resolveComplete => cdp.on('Tracing.tracingComplete', resolveComplete));
  cdp.on('Tracing.dataCollected', ({value}) => events.push(...value));
  await cdp.send('Tracing.start', {categories: TRACE_CATEGORIES, transferMode: 'ReportEvents'});
  await run();
  await cdp.send('Tracing.end');
  await complete;
  return summarizeTracks(events);
}

// Wheel-gesture scroll of the element under (x, y) for `ms`, sampling rAF pacing in-page.
async function wheelScroll(page, {x, y, ms, scroller, step = 140, pause = 16}) {
  await page.evaluate(() => {
    window.__frames = [];
    window.__longTasks = 0;
    window.__longTaskMs = 0;
    if (!window.__longTaskObserver && 'PerformanceObserver' in window) {
      try { new PerformanceObserver(list => { for (const e of list.getEntries()) { window.__longTasks++; window.__longTaskMs += e.duration; } }).observe({entryTypes: ['longtask']}); window.__longTaskObserver = true; } catch {}
    }
    let last = performance.now();
    window.__sampling = true;
    const tick = now => { window.__frames.push(now - last); last = now; if (window.__sampling) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.mouse.move(x, y);
  const deadline = Date.now() + ms;
  let lastReset = Date.now();
  while (Date.now() < deadline) {
    await page.mouse.wheel(0, step);
    // Snap back to the top once per second so the gesture never pins against an end.
    if (Date.now() - lastReset > 1000) {
      lastReset = Date.now();
      await page.evaluate(sel => { (sel ? document.querySelector(sel) : document.scrollingElement).scrollTop = 0; }, scroller ?? null);
    }
    await page.waitForTimeout(pause);
  }
  return page.evaluate(() => {
    window.__sampling = false;
    const frames = window.__frames.slice(1).sort((a, b) => a - b);
    if (!frames.length) return {frames: 0};
    const at = q => +frames[Math.min(frames.length - 1, Math.floor(frames.length * q))].toFixed(1);
    return {frames: frames.length, p50: at(.5), p95: at(.95), max: +frames[frames.length - 1].toFixed(1), over24ms: frames.filter(f => f > 24).length, longTasks: window.__longTasks, longTaskMs: +window.__longTaskMs.toFixed(1)};
  });
}

// One measurement = main-thread trace + compositor-measured frame pacing + presented frames.
async function measure(cdp, page, gesture) {
  let frames;
  const tracks = await trace(cdp, async () => { frames = await wheelScroll(page, gesture); });
  const presented = await screencastFrames(page, () => wheelScroll(page, gesture));
  return {...tracks, frames, presentedFrames: presented, presentedFPS: +(presented / (gesture.ms / 1000)).toFixed(1)};
}

const root = await mkdtemp(join(tmpdir(), 'studio-perf-'));
const driver = {installed: () => true, prepare: async () => {}, cleanReference: async (_, req) => { await writeFile(req.outputPath, wav); }, generate: async (_, req, ctx) => { await new Promise((resolveJob, reject) => { const timer = setTimeout(resolveJob, 300); ctx.signal.addEventListener('abort', () => { clearTimeout(timer); reject(Error('cancelled')); }, {once: true}); }); await writeFile(req.outputPath, wav); }};
const renderer = ({composition}) => ({result: Promise.resolve({wav: new Uint8Array(encodeWav([Float32Array.from({length: Math.round(composition.score.duration * 44100)}, (_, i) => Math.sin(i * .1) * .2)], 44100)), peak: .2, rms: .1, attenuation: 1, engine: 'test-pcm'}), cancel: () => {}});
const service = await MusicService.open(root, renderer, p => readFile(resolve('dist', p)), false, unused, driver);
const http = await serveHttp(service, {read: p => readFile(resolve('dist', p)), has: p => existsSync(resolve('dist', p)), embedded: false});
await readBuiltinVoices(resolve('dist')).catch(() => undefined);

const engine = process.env.ENGINE ?? 'chrome';
const scale = Number(process.env.SCALE ?? 1);
const browser = engine === 'webkit'
  ? await webkit.launch()
  : await chromium.launch({channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required']});
const page = await browser.newPage({viewport: {width: 1280, height: 720}, deviceScaleFactor: scale});
// LEGACY=blur|local|1 replays the pre-fix modal rules (individually or together) so each
// suspect can be measured in an otherwise identical environment.
const LEGACY_CSS = {
  blur: `dialog::backdrop { backdrop-filter: blur(6px) saturate(0.9); }`,
  local: `.dialog-body {
    background:
      linear-gradient(var(--dialog) 30%, color-mix(in srgb, var(--dialog), transparent)) top / 100% 18px no-repeat local,
      linear-gradient(color-mix(in srgb, var(--dialog), transparent), var(--dialog) 70%) bottom / 100% 18px no-repeat local,
      radial-gradient(farthest-side at 50% 0, rgba(20, 30, 20, 0.12), transparent) top / 100% 8px no-repeat scroll,
      radial-gradient(farthest-side at 50% 100%, rgba(20, 30, 20, 0.12), transparent) bottom / 100% 8px no-repeat scroll;
  }`,
};
const report = {};
try {
  await page.goto(http.runtime.url);
  await page.getByRole('button', {name: '＋ 新建项目', exact: true}).first().click();
  await page.fill('#project-name', '滚动性能');
  await page.locator('#project-form button').click();
  await page.locator('[name="kind"][value="speech"]').check();
  await page.fill('#sound-title', '旁白');
  await page.locator('#sound-form button').click();
  await page.locator('.reference-upload summary').click();
  await page.fill('#voice-name', '我的声音');
  await page.locator('#voice-file').setInputFiles({name: 'reference.wav', mimeType: 'audio/wav', buffer: wav});
  await page.locator('[data-action="upload-voice"]').click();
  await page.waitForFunction(() => document.querySelector('#voice')?.selectedOptions[0]?.textContent === '我的声音');

  const cdp = await page.context().newCDPSession(page);
  const legacy = process.env.LEGACY;
  if (legacy && legacy !== '0') {
    const parts = legacy === '1' ? Object.values(LEGACY_CSS) : [LEGACY_CSS[legacy]].filter(Boolean);
    await page.addStyleTag({content: parts.join('\n')});
    report.legacyCss = legacy;
  }
  report.scale = scale;
  await page.waitForTimeout(600); // let the 1.8s polling settle before measuring

  // --- dialog body scroll ---
  if (!await page.evaluate(() => !!document.querySelector('dialog')?.open)) await page.locator('[data-action="compose"]').first().click();
  await page.waitForSelector('dialog[open] .dialog-body');
  const box = await page.locator('dialog[open] .dialog-body').boundingBox();
  const overflow = await page.evaluate(() => { const el = document.querySelector('dialog[open] .dialog-body'); return {scrollHeight: el.scrollHeight, clientHeight: el.clientHeight}; });
  report.dialogOverflow = {...overflow, overflowing: overflow.scrollHeight > overflow.clientHeight};
  report.dialog = await measure(cdp, page, {x: box.x + box.width / 2, y: box.y + box.height / 2, ms: 2600, scroller: 'dialog[open] .dialog-body'});

  // Generate one version so the page grows and there is real audio to play while scrolling.
  await page.fill('#creation-text', '第一版开场旁白');
  await page.click('#generate');
  await page.waitForFunction(() => !document.querySelector('dialog').open);
  await page.locator('#version-audio').waitFor();
  await page.waitForFunction(() => !!document.querySelector('#version-audio')?.src);
  await page.waitForTimeout(400);
  const pageScrollable = await page.evaluate(() => document.scrollingElement.scrollHeight > innerHeight + 40);
  report.pageScrollable = pageScrollable;
  if (pageScrollable) report.page = await measure(cdp, page, {x: 800, y: 400, ms: 2600});
  const playing = await page.evaluate(() => { const a = document.querySelector('#version-audio'); a.loop = true; return a.play().then(() => !a.paused); });
  report.audioPlaying = playing;
  if (pageScrollable && playing) report.pagePlaying = await measure(cdp, page, {x: 800, y: 400, ms: 2600});
} finally {
  await browser.close();
  await http.close?.();
  await service.close?.();
}
console.log(JSON.stringify(report, null, 2));
